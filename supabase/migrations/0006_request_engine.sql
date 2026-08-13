-- =============================================================================
-- 0006 — The generic request engine (spec §3).
--
-- ONE engine for every approval workflow in the club: money, design, IT
-- tickets, sponsorship, meeting requests. Adding a new kind of request is
-- INSERTing configuration rows — a type, its statuses, its allowed
-- transitions. No new table, no new screen, no new code.
--
-- Nothing in this file knows what a calendar is. The only way the engine
-- reaches outside itself is the named on-approval hook at the bottom.
-- =============================================================================

create type request_target_kind as enum ('team', 'project', 'presidency');

-- Who is allowed to perform a given transition.
--   requester        — only the person who submitted it
--   target_approver  — whoever may act for the team/project/Presidency it was
--                      routed to (resolved from the permission map, not roles)
--   permission       — anyone holding the transition's required_permission
create type request_actor_rule as enum ('requester', 'target_approver', 'permission');

-- -----------------------------------------------------------------------------
-- Hook registry: name -> function. This is the dispatcher from spec §3.
-- -----------------------------------------------------------------------------

create table request_hooks (
  name             text primary key,
  function_schema  text not null,
  function_name    text not null,
  description      text
);

comment on table request_hooks is
  'Named actions a request type can fire when it reaches an approved status.
   The engine looks the name up here; it never imports the target module.';

-- -----------------------------------------------------------------------------
-- Configuration: a request type is pure data
-- -----------------------------------------------------------------------------

create table request_types (
  id                uuid primary key default gen_random_uuid(),
  key               text not null unique,
  name_en           text not null,
  name_ar           text not null,
  description_en    text,
  description_ar    text,

  -- The team that owns this workflow (money -> Finance, design -> Design…).
  -- NULL for types that are not owned by a single team, like meeting requests.
  owning_team_id    uuid references teams (id),

  -- The custom form. An array of field definitions:
  --   [{"key":"amount","type":"number","label_en":"Amount","label_ar":"المبلغ",
  --     "required":true}]
  -- Rendered dynamically by the UI, so a new type needs no new form component.
  field_schema      jsonb not null default '[]'::jsonb,

  on_approval_hook  text references request_hooks (name),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table request_statuses (
  request_type_id  uuid not null references request_types (id) on delete cascade,
  key              text not null,
  name_en          text not null,
  name_ar          text not null,
  is_initial       boolean not null default false,
  is_terminal      boolean not null default false,
  is_approved      boolean not null default false,
  sort_order       integer not null default 100,
  primary key (request_type_id, key)
);

-- Exactly one starting status per type.
create unique index request_statuses_one_initial
  on request_statuses (request_type_id)
  where is_initial;

-- The allowed status flow. Loops are just rows pointing backwards, which is
-- what makes the Meeting Request counter-offer negotiation (spec §3)
-- expressible as configuration instead of special-cased code.
create table request_transitions (
  id                   uuid primary key default gen_random_uuid(),
  request_type_id      uuid not null references request_types (id) on delete cascade,
  from_status          text not null,
  to_status            text not null,
  actor_rule           request_actor_rule not null,
  required_permission  text references permissions (key),
  label_en             text not null,
  label_ar             text not null,
  sort_order           integer not null default 100,

  unique (request_type_id, from_status, to_status),

  foreign key (request_type_id, from_status)
    references request_statuses (request_type_id, key) on delete cascade,
  foreign key (request_type_id, to_status)
    references request_statuses (request_type_id, key) on delete cascade,

  constraint request_transitions_permission_present check (
    actor_rule <> 'permission' or required_permission is not null
  )
);

-- -----------------------------------------------------------------------------
-- Instances
-- -----------------------------------------------------------------------------

create table requests (
  id                 uuid primary key default gen_random_uuid(),
  request_type_id    uuid not null references request_types (id),
  submitted_by       uuid not null references members (id),

  target_kind        request_target_kind not null,
  target_team_id     uuid references teams (id),
  target_project_id  uuid references projects (id),

  status             text not null,

  -- Answers to the type's custom fields, plus per-transition extras the
  -- history trigger picks up (transition_note, proposed_start, proposed_end).
  data               jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A request can only ever hold a status its own type defines.
  foreign key (request_type_id, status)
    references request_statuses (request_type_id, key),

  constraint requests_target_shape check (
    (target_kind = 'team'       and target_team_id is not null and target_project_id is null)
    or (target_kind = 'project' and target_project_id is not null and target_team_id is null)
    or (target_kind = 'presidency' and target_team_id is null and target_project_id is null)
  )
);

create index requests_status_idx       on requests (request_type_id, status);
create index requests_submitted_by_idx on requests (submitted_by);
create index requests_target_team_idx  on requests (target_team_id);

-- Full history, written by a trigger so no code path can skip it (spec §3).
create table request_status_history (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references requests (id) on delete cascade,
  from_status     text,
  to_status       text not null,
  changed_by      uuid references members (id),
  note            text,
  proposed_start  timestamptz,
  proposed_end    timestamptz,
  created_at      timestamptz not null default now()
);

create index request_status_history_request_idx
  on request_status_history (request_id, created_at);

create trigger requests_touch_updated_at
  before update on requests
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Who may act on a request?
--
-- Spec §3 states three rules by target: any one Director of the target team,
-- any one of the target project's Project Managers, or the President or VP for
-- Presidency. All three fall straight out of the permission map — a Director's
-- `requests.approve` scope is own_team, a PM's is own_projects, and Presidency
-- holds `all`. So this function names no roles at all.
-- -----------------------------------------------------------------------------

create or replace function app.can_act_on_request(
  p_target_team    uuid,
  p_target_project uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.can('requests.approve', p_team => p_target_team, p_project => p_target_project)
$$;

-- -----------------------------------------------------------------------------
-- Trigger 1 — transitions must be legal, and made by the right person.
-- Rejected loudly (spec §3: "a clear error, not a silent no-op").
-- -----------------------------------------------------------------------------

create or replace function app.validate_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule request_actor_rule;
  v_perm text;
  v_me   uuid;
begin
  if new.status is not distinct from old.status then
    return new;      -- editing the payload, not moving the request
  end if;

  if new.request_type_id is distinct from old.request_type_id then
    raise exception 'A request cannot change its type' using errcode = '22023';
  end if;

  select t.actor_rule, t.required_permission
    into v_rule, v_perm
  from request_transitions t
  where t.request_type_id = new.request_type_id
    and t.from_status = old.status
    and t.to_status   = new.status;

  if not found then
    raise exception
      'Status change % -> % is not allowed for this request type',
      old.status, new.status
      using errcode = '22023';
  end if;

  v_me := app.current_member_id();

  if v_rule = 'requester' then
    if v_me is null or new.submitted_by is distinct from v_me then
      raise exception 'Only the person who submitted this request may do that'
        using errcode = '42501';
    end if;

  elsif v_rule = 'target_approver' then
    if not app.can_act_on_request(new.target_team_id, new.target_project_id) then
      raise exception 'You are not an approver for this request''s target'
        using errcode = '42501';
    end if;

  elsif v_rule = 'permission' then
    if not app.can(v_perm,
                   p_team    => new.target_team_id,
                   p_project => new.target_project_id,
                   p_owner   => new.submitted_by) then
      raise exception 'That change requires the % permission', v_perm
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger requests_validate_transition
  before update on requests
  for each row execute function app.validate_request_transition();

-- -----------------------------------------------------------------------------
-- Trigger 2 — history, always.
--
-- Written at the lowest layer we control, so a future code path physically
-- cannot forget to log a status change (spec §3, §10).
-- Trigger names matter here: AFTER triggers fire in alphabetical order, and
-- `requests_history_write` sorts before `requests_hook_on_approval`, so the
-- history row exists before any hook runs.
-- -----------------------------------------------------------------------------

create or replace function app.write_request_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into request_status_history
      (request_id, from_status, to_status, changed_by, note,
       proposed_start, proposed_end)
    values
      (new.id, null, new.status, new.submitted_by,
       new.data ->> 'transition_note',
       (new.data ->> 'proposed_start')::timestamptz,
       (new.data ->> 'proposed_end')::timestamptz);

  elsif new.status is distinct from old.status then
    insert into request_status_history
      (request_id, from_status, to_status, changed_by, note,
       proposed_start, proposed_end)
    values
      (new.id, old.status, new.status, app.current_member_id(),
       new.data ->> 'transition_note',
       (new.data ->> 'proposed_start')::timestamptz,
       (new.data ->> 'proposed_end')::timestamptz);
  end if;

  return null;
end;
$$;

create trigger requests_history_write
  after insert or update on requests
  for each row execute function app.write_request_history();

-- -----------------------------------------------------------------------------
-- Trigger 3 — the on-approval hook.
--
-- When a request reaches a status flagged `is_approved`, look the type's hook
-- name up in the registry and call that function. The engine stays ignorant of
-- what the hook does.
-- -----------------------------------------------------------------------------

create or replace function app.run_request_approval_hook()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_approved boolean;
  v_hook        text;
  v_schema      text;
  v_function    text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  select rs.is_approved into v_is_approved
  from request_statuses rs
  where rs.request_type_id = new.request_type_id
    and rs.key = new.status;

  if not coalesce(v_is_approved, false) then
    return null;
  end if;

  select rt.on_approval_hook into v_hook
  from request_types rt
  where rt.id = new.request_type_id;

  if v_hook is null then
    return null;
  end if;

  select h.function_schema, h.function_name
    into v_schema, v_function
  from request_hooks h
  where h.name = v_hook;

  if v_function is null then
    raise exception 'Request type refers to unknown on-approval hook "%"', v_hook;
  end if;

  execute format('select %I.%I($1)', v_schema, v_function) using new.id;
  return null;
end;
$$;

create trigger requests_hook_on_approval
  after update on requests
  for each row execute function app.run_request_approval_hook();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table request_hooks           enable row level security;
alter table request_types           enable row level security;
alter table request_statuses        enable row level security;
alter table request_transitions     enable row level security;
alter table requests                enable row level security;
alter table request_status_history  enable row level security;

-- Configuration is readable (the UI renders forms and buttons from it) and
-- writable only by whoever may configure request types.

create policy request_hooks_select on request_hooks
  for select using ((select app.is_signed_in()));

create policy request_hooks_write on request_hooks
  for all
  using ((select app.can('request_types.configure')))
  with check ((select app.can('request_types.configure')));

create policy request_types_select on request_types
  for select using ((select app.is_signed_in()));

create policy request_types_write on request_types
  for all
  using ((select app.can('request_types.configure')))
  with check ((select app.can('request_types.configure')));

create policy request_statuses_select on request_statuses
  for select using ((select app.is_signed_in()));

create policy request_statuses_write on request_statuses
  for all
  using ((select app.can('request_types.configure')))
  with check ((select app.can('request_types.configure')));

create policy request_transitions_select on request_transitions
  for select using ((select app.is_signed_in()));

create policy request_transitions_write on request_transitions
  for all
  using ((select app.can('request_types.configure')))
  with check ((select app.can('request_types.configure')));

-- Instances: you see your own submissions, anything your role scope covers,
-- and anything routed to you for a decision.
create policy requests_select on requests
  for select using (
    submitted_by = (select app.current_member_id())
    or (select app.can('requests.view',
                       p_team    => target_team_id,
                       p_project => target_project_id,
                       p_owner   => submitted_by))
    or (select app.can_act_on_request(target_team_id, target_project_id))
  );

create policy requests_insert on requests
  for insert with check (
    submitted_by = (select app.current_member_id())
    and (select app.can('requests.submit'))
  );

-- Who may attempt an update; WHICH update is legal is the transition trigger's
-- job. Both layers have to pass.
create policy requests_update on requests
  for update
  using (
    submitted_by = (select app.current_member_id())
    or (select app.can_act_on_request(target_team_id, target_project_id))
  )
  with check (
    submitted_by = (select app.current_member_id())
    or (select app.can_act_on_request(target_team_id, target_project_id))
  );

-- No DELETE policy on purpose: requests and their history are the audit trail.

-- History is visible exactly when the request is — the sub-select below is
-- itself filtered by the policy above. There is no INSERT policy, so the only
-- writer is the SECURITY DEFINER trigger.
create policy request_status_history_select on request_status_history
  for select using (
    exists (select 1 from requests r where r.id = request_status_history.request_id)
  );

grant select, insert, update, delete on all tables in schema public to authenticated;
