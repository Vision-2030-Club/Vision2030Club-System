-- =============================================================================
-- 0034 — Three generalisations the Design Request needs, and nothing about
--        design requests.
--
-- §7 asks for a workflow that (a) only Club Management may start, (b) creates
-- a real meeting at two points, and (c) carries on where it left off once that
-- meeting is agreed. None of those are design-specific ideas, so none of them
-- are built as design-specific code:
--
--   1. `request_types.submit_permission` — a type can require a permission to
--      be submitted at all. The RLS policy enforces it, so calling the API
--      directly is refused the same way the button is hidden.
--
--   2. `request_transitions.on_transition_hook` — a MOVE can fire a named
--      hook, exactly as an approval already can. "Require Meeting" is a
--      transition that creates a meeting; nothing about that is unique to
--      design work.
--
--   3. `request_types.on_meeting_confirmed_hook` — the Meetings component
--      tells whatever spawned a meeting that it is confirmed, WITHOUT knowing
--      what that thing is. It looks up the origin's type and runs whatever
--      that type registered. §1 is explicit: the component "has no
--      special-cased knowledge of what spawned the request".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Who may submit a given type
-- -----------------------------------------------------------------------------

alter table request_types
  add column if not exists submit_permission text references permissions (key);

comment on column request_types.submit_permission is
  'A permission required to submit THIS type, on top of requests.submit. NULL
   means anyone who may submit requests at all. Enforced by requests_insert,
   so the API refuses it too — not just the UI.';

drop policy if exists requests_insert on requests;

create policy requests_insert on requests
  for insert with check (
    submitted_by = (select app.current_member_id())
    and (select app.can('requests.submit'))
    and (
      -- The type's own gate, when it has one.
      select coalesce(
        (select app.can(t.submit_permission)
           from request_types t
          where t.id = requests.request_type_id
            and t.submit_permission is not null),
        true
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 2. A transition can fire a hook
--
-- Same registry, same dispatcher shape, same one-argument signature as the
-- on-approval hook — so a hook can be registered for either without being
-- written differently.
--
-- The trigger is named to sort AFTER `requests_history_write`, because a hook
-- that wants to know where the request came FROM reads the history row this
-- move just wrote. AFTER triggers on one event fire in alphabetical order, so
-- that ordering is the name, and renaming either one silently reorders them.
-- -----------------------------------------------------------------------------

alter table request_transitions
  add column if not exists on_transition_hook text references request_hooks (name);

comment on column request_transitions.on_transition_hook is
  'Named action fired when THIS move is made. Same registry as
   request_types.on_approval_hook.';

create or replace function app.run_request_transition_hook()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hook     text;
  v_schema   text;
  v_function text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  select t.on_transition_hook into v_hook
  from request_transitions t
  where t.request_type_id = new.request_type_id
    and t.from_status = old.status
    and t.to_status = new.status;

  if v_hook is null then
    return null;
  end if;

  select h.function_schema, h.function_name
    into v_schema, v_function
  from request_hooks h
  where h.name = v_hook;

  if v_function is null then
    raise exception 'Transition refers to unknown hook "%"', v_hook;
  end if;

  execute format('select %I.%I($1)', v_schema, v_function) using new.id;
  return null;
end;
$$;

create trigger requests_hook_on_transition
  after update on requests
  for each row execute function app.run_request_transition_hook();

-- -----------------------------------------------------------------------------
-- 3. Telling whatever spawned a meeting that it is confirmed
-- -----------------------------------------------------------------------------

alter table request_types
  add column if not exists on_meeting_confirmed_hook text references request_hooks (name);

comment on column request_types.on_meeting_confirmed_hook is
  'Run when a meeting this type spawned reaches Confirmed. The Meetings
   component calls it through meeting_details.origin_request_id and never
   learns what kind of request the origin is.';

create or replace function app.notify_meeting_confirmed(
  p_origin  uuid,
  p_meeting uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hook     text;
  v_schema   text;
  v_function text;
begin
  select t.on_meeting_confirmed_hook into v_hook
  from requests r
  join request_types t on t.id = r.request_type_id
  where r.id = p_origin;

  if v_hook is null then
    return;   -- the origin does not care; that is a normal answer
  end if;

  select h.function_schema, h.function_name
    into v_schema, v_function
  from request_hooks h
  where h.name = v_hook;

  if v_function is null then
    raise exception 'Request type refers to unknown meeting-confirmed hook "%"', v_hook;
  end if;

  execute format('select %I.%I($1, $2)', v_schema, v_function)
    using p_origin, p_meeting;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. A move the SYSTEM makes
--
-- A hook moving a request onward is not a person, so the actor rules do not
-- apply to it — but the transition must still be one the configuration allows.
-- This is the same trick 0012 uses for task scores: a transaction-local
-- setting that only these functions set, checked by the trigger.
--
-- Deliberately narrow. It waives WHO may move the request, never WHETHER the
-- move exists or whether the destination's required data is present.
-- -----------------------------------------------------------------------------

create or replace function app.validate_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule     request_actor_rule;
  v_perm     text;
  v_required text[];
  v_key      text;
  v_missing  text[] := '{}';
  v_system   boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select t.actor_rule, t.required_permission
    into v_rule, v_perm
  from request_transitions t
  where t.request_type_id = new.request_type_id
    and t.from_status = old.status
    and t.to_status = new.status;

  if not found then
    raise exception 'Status change % -> % is not allowed for this request type',
      old.status, new.status
      using errcode = '23514';
  end if;

  v_system := coalesce(current_setting('app.system_move', true), '') = 'on';

  if not v_system then
    if v_rule = 'requester' then
      if new.submitted_by is distinct from app.current_member_id() then
        raise exception 'Only the person who submitted this request can do that'
          using errcode = '42501';
      end if;

    elsif v_rule = 'target_approver' then
      if not app.can_act_on_request(new.target_team_id, new.target_project_id,
                                    new.target_member_id) then
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
  end if;

  -- Required data is checked for EVERYBODY, the system included. "In Progress
  -- needs both dates" is a fact about the request, not about who is asking.
  select s.required_data_keys into v_required
  from request_statuses s
  where s.request_type_id = new.request_type_id and s.key = new.status;

  if v_required is not null and array_length(v_required, 1) > 0 then
    foreach v_key in array v_required loop
      if nullif(btrim(coalesce(new.data ->> v_key, '')), '') is null then
        v_missing := v_missing || v_key;
      end if;
    end loop;

    if array_length(v_missing, 1) > 0 then
      raise exception 'This step needs: %', array_to_string(v_missing, ', ')
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

/**
 * Moves a request onward as the SYSTEM. The only caller should be a hook.
 */
create or replace function app.system_transition(p_request uuid, p_to_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.system_move', 'on', true);
  update requests set status = p_to_status where id = p_request;
  perform set_config('app.system_move', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Wire the callback into confirmation
--
-- One added block at the end of the hook from 0029. The Meetings component
-- still knows nothing about what spawned it — only that something did, and
-- that there is a generic way to say "it is agreed".
-- -----------------------------------------------------------------------------

create or replace function app.hook_confirm_meeting(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          requests%rowtype;
  d          meeting_details%rowtype;
  v_entry    uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_rows     integer;
begin
  select * into r from requests where id = p_request;
  select * into d from meeting_details where request_id = p_request;

  v_start := app.meeting_start(r.data);
  v_end   := app.meeting_end(r.data);

  if v_start is null then
    raise exception 'This meeting has no agreed time yet' using errcode = '23514';
  end if;

  -- --- the room ------------------------------------------------------------
  if app.meeting_is_in_person(r.data) then
    -- §2: if the room is gone, Confirm FAILS. It is never silently confirmed
    -- without the room it was agreed for.
    update room_bookings
       set status     = 'booked',
           other_kind = case r.target_kind
                          when 'team' then 'team'::booking_party_kind
                          when 'project' then 'project'::booking_party_kind
                          when 'presidency' then 'presidency'::booking_party_kind
                          else null
                        end,
           other_team_id    = r.target_team_id,
           other_project_id = r.target_project_id,
           other_member_id  = r.target_member_id
     where id = d.booking_id
       and status = 'held';

    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      raise exception
        'That room is no longer held for this meeting. Suggest another time, or start again with a different room.'
        using errcode = '55006';
    end if;
  end if;

  -- --- the Meet link -------------------------------------------------------
  if not app.meeting_is_in_person(r.data) then
    update meeting_details set meet_state = 'pending' where request_id = p_request;
  end if;

  -- --- the calendar entry --------------------------------------------------
  if not exists (select 1 from calendar_entries where source_request_id = r.id) then
    insert into calendar_entries (
      kind, title, description, starts_at, ends_at, all_day, location,
      category, color, created_by, source_request_id,
      meeting_scope_kind, meeting_scope_team_id, meeting_scope_project_id
    )
    values (
      'meeting',
      coalesce(nullif(r.data ->> 'title', ''), 'Meeting'),
      r.data ->> 'description',
      v_start,
      v_end,
      false,
      case when app.meeting_is_in_person(r.data)
           then (select coalesce(name_en, '') from rooms where id = app.meeting_room(r.data))
           else nullif(r.data ->> 'location', '') end,
      'meeting',
      '#007a8f',
      r.submitted_by,
      r.id,
      case when r.target_kind in ('team', 'project', 'presidency')
           then r.target_kind::text::meeting_scope_kind end,
      r.target_team_id,
      r.target_project_id
    )
    returning id into v_entry;

    insert into calendar_entry_audiences (entry_id, audience_kind, member_id)
    select v_entry, 'individual', rec.member_id
    from app.meeting_recipients(r.id) rec
    on conflict do nothing;
  end if;

  -- --- tell whatever asked for this meeting --------------------------------
  if d.origin_request_id is not null then
    perform app.notify_meeting_confirmed(d.origin_request_id, p_request);
  end if;
end;
$$;
