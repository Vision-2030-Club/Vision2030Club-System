-- =============================================================================
-- 0007 — Calendar (spec §6).
--
-- Two concepts that must never be conflated, kept as separate columns with
-- separate logic:
--
--   MEETING SCOPE      who the meeting is convened WITH.
--                      Decides whether it can be added directly or needs a
--                      Meeting Request. Stored on calendar_entries.
--
--   CALENDAR VISIBILITY who can SEE it afterwards.
--                      Chosen freely by the creator, never approved by anyone.
--                      Stored in calendar_entry_audiences.
--
-- Widening visibility is not the same as scheduling time with someone.
-- =============================================================================

create type calendar_entry_kind   as enum ('club', 'meeting');
create type meeting_scope_kind    as enum ('team', 'project', 'presidency');
create type calendar_audience_kind as enum (
  'presidency',       -- President + VP
  'directors',        -- Presidency + all Team Directors
  'club_management',  -- Presidency + Team Directors + Project Managers
  'team',             -- one specific team
  'project',          -- one specific project
  'all_members',      -- everyone signed in
  'individual'        -- one specific person
);

create table calendar_entries (
  id           uuid primary key default gen_random_uuid(),
  kind         calendar_entry_kind not null,

  title        text not null,
  description  text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  all_day      boolean not null default false,
  location     text,

  -- Free text, not a fixed list (spec §6).
  category     text,
  color        text,

  created_by   uuid references members (id),

  -- Set when the entry was created by an approved Meeting Request, which is
  -- the ONLY way a cross-boundary meeting can reach the calendar.
  source_request_id uuid references requests (id),

  meeting_scope_kind        meeting_scope_kind,
  meeting_scope_team_id     uuid references teams (id),
  meeting_scope_project_id  uuid references projects (id),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint calendar_entries_time_order check (ends_at >= starts_at),

  constraint calendar_entries_scope_shape check (
    (kind = 'club'
      and meeting_scope_kind is null
      and meeting_scope_team_id is null
      and meeting_scope_project_id is null)
    or (kind = 'meeting' and meeting_scope_kind = 'team'
      and meeting_scope_team_id is not null
      and meeting_scope_project_id is null)
    or (kind = 'meeting' and meeting_scope_kind = 'project'
      and meeting_scope_project_id is not null
      and meeting_scope_team_id is null)
    or (kind = 'meeting' and meeting_scope_kind = 'presidency'
      and meeting_scope_team_id is null
      and meeting_scope_project_id is null)
  )
);

create index calendar_entries_span_idx on calendar_entries (starts_at, ends_at);

-- One approved request produces exactly one entry, even if the approval
-- trigger were somehow to fire twice.
create unique index calendar_entries_one_per_request
  on calendar_entries (source_request_id)
  where source_request_id is not null;

-- The seven audience options. They are NOT mutually exclusive — several rows
-- per entry is the normal case ("the IT team" + "one person outside it").
create table calendar_entry_audiences (
  id             uuid primary key default gen_random_uuid(),
  entry_id       uuid not null references calendar_entries (id) on delete cascade,
  audience_kind  calendar_audience_kind not null,
  team_id        uuid references teams (id),
  project_id     uuid references projects (id),
  member_id      uuid references members (id),

  constraint calendar_audience_shape check (
    (audience_kind = 'team'       and team_id is not null and project_id is null and member_id is null)
    or (audience_kind = 'project' and project_id is not null and team_id is null and member_id is null)
    or (audience_kind = 'individual' and member_id is not null and team_id is null and project_id is null)
    or (audience_kind in ('presidency', 'directors', 'club_management', 'all_members')
        and team_id is null and project_id is null and member_id is null)
  )
);

create index calendar_entry_audiences_entry_idx
  on calendar_entry_audiences (entry_id);

-- The three role-group audiences are defined here as DATA, so "who counts as
-- Club Management" is a row change rather than a code change.
create table calendar_audience_roles (
  audience_kind  calendar_audience_kind not null,
  role_id        uuid not null references roles (id) on delete cascade,
  primary key (audience_kind, role_id)
);

insert into calendar_audience_roles (audience_kind, role_id)
select g.audience_kind::calendar_audience_kind, r.id
from (values
  ('presidency',      'president'),
  ('presidency',      'vice_president'),
  ('directors',       'president'),
  ('directors',       'vice_president'),
  ('directors',       'team_director'),
  ('club_management', 'president'),
  ('club_management', 'vice_president'),
  ('club_management', 'team_director'),
  ('club_management', 'project_manager')
) as g (audience_kind, role_key)
join roles r on r.key = g.role_key
on conflict do nothing;

create trigger calendar_entries_touch_updated_at
  before update on calendar_entries
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Does one audience row include the current user?
-- -----------------------------------------------------------------------------

create or replace function app.audience_matches(
  p_kind     calendar_audience_kind,
  p_team     uuid,
  p_project  uuid,
  p_member   uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid;
begin
  v_me := app.current_member_id();
  if v_me is null then
    return false;
  end if;

  if p_kind = 'all_members' then
    return true;
  elsif p_kind = 'team' then
    return p_team = app.current_team_id();
  elsif p_kind = 'project' then
    return app.is_on_project(p_project);
  elsif p_kind = 'individual' then
    return p_member = v_me;
  end if;

  -- presidency / directors / club_management come from the table above.
  return exists (
    select 1
    from calendar_audience_roles car
    join members m on m.role_id = car.role_id
    where car.audience_kind = p_kind
      and m.id = v_me
  );
end;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table calendar_entries          enable row level security;
alter table calendar_entry_audiences  enable row level security;
alter table calendar_audience_roles   enable row level security;

-- Reading: club entries are visible to every signed-in role, Guest included,
-- and never to anonymous visitors. Meetings are visible to their audience.
create policy calendar_entries_select on calendar_entries
  for select using (
    (select app.is_signed_in())
    and (
      kind = 'club'
      or created_by = (select app.current_member_id())
      or (select app.can('calendar.view_all'))
      or exists (
        select 1
        from calendar_entry_audiences a
        where a.entry_id = calendar_entries.id
          and app.audience_matches(a.audience_kind, a.team_id, a.project_id, a.member_id)
      )
    )
  );

-- Writing: this single check is the whole of spec §6's direct-add rule.
--
--   Director + own team      -> calendar.manage scope own_team matches
--   Director + another team  -> no match, must file a Meeting Request
--   PM + own project         -> scope own_projects matches
--   PM + another project     -> no match
--   anyone -> Presidency     -> scope is null-team, no match
--   Presidency + anything    -> scope 'all' matches
--   club-wide entries        -> only 'all' holders (President/VP/Super Admin)
--
-- Cross-boundary meetings never take this path: the approved Meeting Request's
-- hook inserts them as the table owner, which is not subject to these policies.
create policy calendar_entries_insert on calendar_entries
  for insert with check (
    created_by = (select app.current_member_id())
    and (select app.can('calendar.manage',
                        p_team    => meeting_scope_team_id,
                        p_project => meeting_scope_project_id))
  );

create policy calendar_entries_update on calendar_entries
  for update
  using (
    created_by = (select app.current_member_id())
    or (select app.can('calendar.manage',
                       p_team    => meeting_scope_team_id,
                       p_project => meeting_scope_project_id))
  )
  with check (
    created_by = (select app.current_member_id())
    or (select app.can('calendar.manage',
                       p_team    => meeting_scope_team_id,
                       p_project => meeting_scope_project_id))
  );

create policy calendar_entries_delete on calendar_entries
  for delete using (
    created_by = (select app.current_member_id())
    or (select app.can('calendar.manage',
                       p_team    => meeting_scope_team_id,
                       p_project => meeting_scope_project_id))
  );

-- Audiences follow their entry. Choosing them needs nobody's approval, so the
-- only question is whether you may manage the entry itself.
create policy calendar_entry_audiences_select on calendar_entry_audiences
  for select using (
    exists (select 1 from calendar_entries e where e.id = calendar_entry_audiences.entry_id)
  );

create policy calendar_entry_audiences_write on calendar_entry_audiences
  for all
  using (
    exists (
      select 1 from calendar_entries e
      where e.id = calendar_entry_audiences.entry_id
        and (e.created_by = (select app.current_member_id())
             or (select app.can('calendar.manage',
                                p_team    => e.meeting_scope_team_id,
                                p_project => e.meeting_scope_project_id)))
    )
  )
  with check (
    exists (
      select 1 from calendar_entries e
      where e.id = calendar_entry_audiences.entry_id
        and (e.created_by = (select app.current_member_id())
             or (select app.can('calendar.manage',
                                p_team    => e.meeting_scope_team_id,
                                p_project => e.meeting_scope_project_id)))
    )
  );

create policy calendar_audience_roles_select on calendar_audience_roles
  for select using ((select app.is_signed_in()));

create policy calendar_audience_roles_write on calendar_audience_roles
  for all
  using ((select app.can('roles.configure')))
  with check ((select app.can('roles.configure')));

-- =============================================================================
-- The on-approval hook (spec §3)
--
-- Registered by name so the request engine can find it without knowing
-- anything about calendars.
-- =============================================================================

create or replace function app.hook_create_calendar_entry(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        requests%rowtype;
  v_entry  uuid;
  v_start  timestamptz;
  v_end    timestamptz;
begin
  select * into r from requests where id = p_request;

  if exists (select 1 from calendar_entries where source_request_id = r.id) then
    return;   -- already scheduled; nothing to do
  end if;

  v_start := (r.data ->> 'proposed_start')::timestamptz;
  v_end   := coalesce((r.data ->> 'proposed_end')::timestamptz,
                      v_start + interval '1 hour');

  if v_start is null then
    raise exception 'Meeting request % has no proposed start time', r.id;
  end if;

  insert into calendar_entries (
    kind, title, description, starts_at, ends_at, all_day, location,
    category, color, created_by, source_request_id,
    meeting_scope_kind, meeting_scope_team_id, meeting_scope_project_id
  )
  values (
    'meeting',
    coalesce(r.data ->> 'title', 'Meeting'),
    r.data ->> 'description',
    v_start,
    v_end,
    false,
    r.data ->> 'location',
    'meeting',
    '#007a8f',
    r.submitted_by,
    r.id,
    r.target_kind::text::meeting_scope_kind,
    r.target_team_id,
    r.target_project_id
  )
  returning id into v_entry;

  -- Sensible starting visibility: the requester, plus the side they asked to
  -- meet. The creator can widen or narrow this afterwards without approval.
  insert into calendar_entry_audiences (entry_id, audience_kind, member_id)
  values (v_entry, 'individual', r.submitted_by);

  if r.target_kind = 'team' then
    insert into calendar_entry_audiences (entry_id, audience_kind, team_id)
    values (v_entry, 'team', r.target_team_id);
  elsif r.target_kind = 'project' then
    insert into calendar_entry_audiences (entry_id, audience_kind, project_id)
    values (v_entry, 'project', r.target_project_id);
  else
    insert into calendar_entry_audiences (entry_id, audience_kind)
    values (v_entry, 'presidency');
  end if;
end;
$$;

insert into request_hooks (name, function_schema, function_name, description)
values (
  'create_calendar_entry',
  'app',
  'hook_create_calendar_entry',
  'Creates the Calendar Entry for an approved Meeting Request (spec §3/§6).'
)
on conflict (name) do update
  set function_schema = excluded.function_schema,
      function_name   = excluded.function_name,
      description     = excluded.description;

grant select, insert, update, delete on all tables in schema public to authenticated;
