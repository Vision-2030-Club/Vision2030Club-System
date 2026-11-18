-- =============================================================================
-- 0075 — Event attendance (حضور الفعالية): a project component.
--
-- A project that runs an event with the public attaches this component. A
-- person signs up once (on the component's own public form, or because
-- another component registered them through the API) and gets a pass: a
-- personal link whose QR code is sent to them by email. At the gate the HR
-- team scans the QR code; that is one check-in for that day.
--
-- It is NOT the club's Attendance page (0009, `attendance_records`): that is
-- members at the club's activities. This is the public at a project's event.
--
-- Tables:
--   event_attendance_settings  one row per project: sign-up open or closed,
--                              the event's first and last day
--   event_attendees            one per mobile per project: name, mobile,
--                              email, the pass token, where they came from
--   event_check_ins            one per attendee per day (the club's calendar)
--   event_pass_outbox          the pass emails waiting to be sent
--
-- Who may do what:
--   manager  whoever holds projects.manage over the project: everything
--   scanner  every active member of the HR team (teams.key = 'HR'): the
--            scanner, finding an attendee by name or mobile, checking in and
--            undoing a check-in. They never get a list, an email or a full
--            mobile number.
--   the public and other components: through this server only, with the
--            service role (the sign-up form, the pass page, the API).
--
-- Personal data of the public sits in this database for the first time (the
-- club's decision, 2026-11-18). So Row Level Security is on with NO policies
-- on all four tables: nothing reads or writes them except the functions
-- below, each of which checks who is asking or is for the service role only.
--
-- Nothing is deleted: an attendee is cancelled, a check-in is undone, both
-- with a flag. Safe to re-run.
-- =============================================================================

-- A refusal the app can translate: the HINT names it (as in the interviews
-- and Quroosh databases).
create or replace function app.refuse(p_hint text, p_message text)
returns void
language plpgsql
as $$
begin
  raise exception '%', p_message using hint = p_hint, errcode = 'P0001';
end;
$$;

alter table project_components
  drop constraint if exists project_components_component_key_check;
alter table project_components
  add constraint project_components_component_key_check
  check (component_key in ('mock_interviews', 'outreach', 'quroosh', 'event_attendance'));

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists event_attendance_settings (
  project_id   uuid primary key references projects (id) on delete cascade,
  signup_open  boolean not null default false,
  -- The event's days, on the club's calendar. Empty: any day is an event day.
  first_day    date,
  last_day     date,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references members (id) on delete set null,
  constraint event_attendance_settings_days
    check ((first_day is null) = (last_day is null) and (first_day is null or last_day >= first_day))
);

comment on table event_attendance_settings is
  'One row per project carrying the Event attendance component (0075): whether sign-up is open, and the event''s days.';

create table if not exists event_attendees (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects (id) on delete cascade,
  -- The pass: /event/pass/<token>, and what the QR code holds. Made by the
  -- app (newToken), never by the database.
  token         text not null unique
                  constraint event_attendees_token_shape check (token ~ '^[0-9a-f]{32,128}$'),
  name          text not null
                  constraint event_attendees_name_shape check (char_length(btrim(name)) between 2 and 200),
  -- International (E.164): + and the country code, digits only.
  phone         text not null
                  constraint event_attendees_phone_shape check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Empty only for a person another component registered without one.
  email         text
                  constraint event_attendees_email_shape
                  check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  locale        text not null default 'ar' check (locale in ('ar', 'en')),
  -- Where they came from: 'form' is this component's own sign-up; anything
  -- else names the component that registered them, with its own record id.
  source        text not null default 'form'
                  constraint event_attendees_source_shape check (source ~ '^[a-z][a-z0-9_]{0,30}$'),
  source_ref    text
                  constraint event_attendees_source_ref_shape check (source_ref is null or char_length(source_ref) <= 200),
  created_at    timestamptz not null default now(),
  -- Moves on every change, so the API's "since" picks up a cancellation.
  updated_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references members (id) on delete set null,
  -- One pass per mobile per event.
  constraint event_attendees_phone_once unique (project_id, phone)
);

comment on table event_attendees is
  'A person signed up to a project''s event (0075). Personal data of the public: read only through the event_* functions.';

create index if not exists event_attendees_project_idx on event_attendees (project_id, created_at desc);
create index if not exists event_attendees_changed_idx on event_attendees (project_id, updated_at);

create table if not exists event_check_ins (
  id             uuid primary key default gen_random_uuid(),
  attendee_id    uuid not null references event_attendees (id) on delete cascade,
  project_id     uuid not null references projects (id) on delete cascade,
  -- The day on the club's calendar (booking_settings.time_zone), not UTC's.
  day            date not null,
  checked_in_at  timestamptz not null default now(),
  checked_in_by  uuid references members (id) on delete set null,
  -- 'scan': the QR code. 'manual': found by name or mobile.
  via            text not null default 'scan' check (via in ('scan', 'manual')),
  undone_at      timestamptz,
  undone_by      uuid references members (id) on delete set null,
  -- Moves when it is undone, so the API's "since" picks that up too.
  changed_at     timestamptz not null default now()
);

comment on table event_check_ins is
  'An attendee arriving at a project''s event on one day (0075). Undone with a flag, never deleted.';

-- One check-in per attendee per day: the claim itself. Two scanners reading
-- the same pass race on this index, and the second is told "already in".
create unique index if not exists event_check_ins_once
  on event_check_ins (attendee_id, day) where undone_at is null;
create index if not exists event_check_ins_project_day_idx on event_check_ins (project_id, day);
create index if not exists event_check_ins_changed_idx on event_check_ins (project_id, changed_at);

create table if not exists event_pass_outbox (
  id           uuid primary key default gen_random_uuid(),
  attendee_id  uuid not null references event_attendees (id) on delete cascade,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  attempts     integer not null default 0,
  sent_at      timestamptz,
  provider_id  text,
  last_error   text
);

comment on table event_pass_outbox is
  'Pass emails waiting to be sent (0075). A row waits, and nothing is lost, while email is not configured.';

create index if not exists event_pass_outbox_pending_idx on event_pass_outbox (created_at) where sent_at is null;
create index if not exists event_pass_outbox_attendee_idx on event_pass_outbox (attendee_id, created_at desc);

-- Deny-all: RLS on, no policies, no table grants. Only the functions below.
alter table event_attendance_settings enable row level security;
alter table event_attendees           enable row level security;
alter table event_check_ins           enable row level security;
alter table event_pass_outbox         enable row level security;

revoke all on event_attendance_settings, event_attendees, event_check_ins, event_pass_outbox
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Who is asking
-- -----------------------------------------------------------------------------

-- Today on the club's calendar. A check-in at 00:30 Riyadh time is the new
-- day's, though it is still yesterday in UTC.
create or replace function app.club_today()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone coalesce((select time_zone from booking_settings limit 1), 'Asia/Riyadh'))::date
$$;

create or replace function app.is_on_team(p_team_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from members m
    join teams t on t.id = m.team_id
    where m.auth_user_id = auth.uid()
      and m.status = 'active'
      and t.key = p_team_key
  )
$$;

-- The caller's role in a project's Event attendance, or null: no component
-- on the project, not signed in, or no business there.
create or replace function app.event_attendance_role(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_project is null or not app.is_signed_in() then null
    when not exists (select 1 from project_components pc
                      where pc.project_id = p_project
                        and pc.component_key = 'event_attendance') then null
    when app.can_manage_project(p_project) then 'manager'
    when app.is_on_team('HR') then 'scanner'
  end
$$;

-- The identity a project's public pages wear: Quroosh's or the interviews'
-- when the project carries that component too, otherwise the club's (null).
create or replace function app.event_theme(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from project_components pc
                  where pc.project_id = p_project and pc.component_key = 'quroosh') then 'quroosh'
    when exists (select 1 from project_components pc
                  where pc.project_id = p_project and pc.component_key = 'mock_interviews') then 'interviews'
  end
$$;

-- Queues the pass email, unless the attendee has no email or one was queued
-- in the last ten minutes (signing up again must not flood an inbox).
create or replace function app.event_queue_pass(p_attendee uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from event_attendees a
                  where a.id = p_attendee and a.email is not null and a.cancelled_at is null) then
    return false;
  end if;
  if exists (select 1 from event_pass_outbox o
              where o.attendee_id = p_attendee
                and o.created_at > now() - interval '10 minutes') then
    return false;
  end if;
  insert into event_pass_outbox (attendee_id) values (p_attendee);
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- my_component_access: 0074's, plus the Event attendance scanner
-- -----------------------------------------------------------------------------

create or replace function public.my_component_access()
returns table (
  project_id     uuid,
  name_en        text,
  name_ar        text,
  component_key  text,
  external_ref   text,
  role           text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select
      pc.project_id, p.name_en, p.name_ar, pc.component_key, pc.external_ref,
      case
        when app.can('projects.manage', p_team => p.owning_team_id, p_project => p.id)
          then 'manager'
        -- Mock Interviews: HR and organizers, as 0062 defined them.
        when pc.component_key = 'mock_interviews'
         and (app.effective_scope('members.manage') = 'all'
              or exists (select 1 from project_component_people x
                          where x.project_id = pc.project_id
                            and x.member_id = app.current_member_id()
                            and x.role = 'hr'))
          then 'hr'
        when pc.component_key = 'mock_interviews'
         and exists (select 1 from project_component_people x
                      where x.project_id = pc.project_id
                        and x.member_id = app.current_member_id()
                        and x.role = 'organizer')
          then 'organizer'
        -- 0069: receptionists.
        when pc.component_key = 'mock_interviews'
         and exists (select 1 from project_component_people x
                      where x.project_id = pc.project_id
                        and x.member_id = app.current_member_id()
                        and x.role = 'reception')
          then 'reception'
        -- 0072: the Development team reads the visitor ratings.
        when pc.component_key = 'mock_interviews'
         and exists (select 1 from members m join teams t on t.id = m.team_id
                      where m.id = app.current_member_id()
                        and t.key = 'DEVELOPMENT')
          then 'viewer'
        -- Outreach: everyone on the project works it; KPI viewers read it.
        when pc.component_key = 'outreach' and app.is_on_project(pc.project_id)
          then 'member'
        when pc.component_key = 'outreach' and app.can_view_kpi_for_project(pc.project_id)
          then 'viewer'
        -- 0074 Quroosh: the same as Outreach until its own roles are decided.
        when pc.component_key = 'quroosh' and app.is_on_project(pc.project_id)
          then 'member'
        when pc.component_key = 'quroosh' and app.can_view_kpi_for_project(pc.project_id)
          then 'viewer'
        -- 0075 Event attendance: the HR team works the gate.
        when pc.component_key = 'event_attendance' and app.is_on_team('HR')
          then 'scanner'
      end as role
    from project_components pc
    join projects p on p.id = pc.project_id
    where app.is_signed_in()
  )
  select * from mine where role is not null
  order by name_en
$$;

-- -----------------------------------------------------------------------------
-- Members: the managers' pages
-- -----------------------------------------------------------------------------

-- The numbers on the component's first page. No personal data, so the
-- scanners read it too.
create or replace function public.event_attendance_summary(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := app.event_attendance_role(p_project);
  v_settings event_attendance_settings;
begin
  if v_role is null then
    perform app.refuse('forbidden', 'You may not open this event''s attendance.');
  end if;
  select * into v_settings from event_attendance_settings s where s.project_id = p_project;

  return jsonb_build_object(
    'role', v_role,
    'signup_open', coalesce(v_settings.signup_open, false),
    'first_day', v_settings.first_day,
    'last_day', v_settings.last_day,
    'today', app.club_today(),
    'attendees', (select count(*) from event_attendees a
                   where a.project_id = p_project and a.cancelled_at is null),
    'cancelled', (select count(*) from event_attendees a
                   where a.project_id = p_project and a.cancelled_at is not null),
    'checked_in_today', (select count(*) from event_check_ins c
                          where c.project_id = p_project and c.day = app.club_today() and c.undone_at is null),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
                        from (select c.day, count(*) as n from event_check_ins c
                               where c.project_id = p_project and c.undone_at is null
                               group by c.day) d), '[]'::jsonb),
    'passes_waiting', (select count(*) from event_pass_outbox o
                         join event_attendees a on a.id = o.attendee_id
                        where a.project_id = p_project and o.sent_at is null)
  );
end;
$$;

create or replace function public.event_save_settings(
  p_project uuid,
  p_signup_open boolean,
  p_first_day date,
  p_last_day date
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if app.event_attendance_role(p_project) is distinct from 'manager' then
    perform app.refuse('forbidden', 'Only the project''s managers can change this.');
  end if;
  if p_signup_open is null then
    perform app.refuse('invalid', 'Say whether sign-up is open.');
  end if;
  if (p_first_day is null) <> (p_last_day is null) then
    perform app.refuse('days_invalid', 'Give both the first and the last day, or neither.');
  end if;
  if p_first_day is not null and p_last_day < p_first_day then
    perform app.refuse('days_invalid', 'The last day is before the first.');
  end if;

  insert into event_attendance_settings (project_id, signup_open, first_day, last_day, updated_by)
  values (p_project, p_signup_open, p_first_day, p_last_day, app.current_member_id())
  on conflict (project_id) do update
     set signup_open = excluded.signup_open,
         first_day   = excluded.first_day,
         last_day    = excluded.last_day,
         updated_at  = now(),
         updated_by  = excluded.updated_by;
end;
$$;

-- The managers' list: everyone signed up, newest first, with the days they
-- came and whether their pass email went out. The token is not returned.
create or replace function public.event_attendee_list(p_project uuid)
returns table (
  id            uuid,
  name          text,
  phone         text,
  email         text,
  source        text,
  source_ref    text,
  created_at    timestamptz,
  cancelled_at  timestamptz,
  days          date[],
  pass_sent_at  timestamptz,
  pass_error    text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if app.event_attendance_role(p_project) is distinct from 'manager' then
    perform app.refuse('forbidden', 'Only the project''s managers can read the attendees.');
  end if;
  return query
    select a.id, a.name, a.phone, a.email, a.source, a.source_ref, a.created_at, a.cancelled_at,
           coalesce((select array_agg(c.day order by c.day) from event_check_ins c
                      where c.attendee_id = a.id and c.undone_at is null), '{}'::date[]),
           (select max(o.sent_at) from event_pass_outbox o where o.attendee_id = a.id),
           (select o.last_error from event_pass_outbox o
             where o.attendee_id = a.id and o.sent_at is null
             order by o.created_at desc limit 1)
      from event_attendees a
     where a.project_id = p_project
     order by a.created_at desc;
end;
$$;

-- Cancels an attendee (their pass stops working at the gate) or brings them
-- back. Their check-ins stay.
create or replace function public.event_set_attendee_cancelled(
  p_project uuid,
  p_attendee uuid,
  p_cancelled boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if app.event_attendance_role(p_project) is distinct from 'manager' then
    perform app.refuse('forbidden', 'Only the project''s managers can change this.');
  end if;
  update event_attendees a
     set cancelled_at = case when coalesce(p_cancelled, true) then coalesce(a.cancelled_at, now()) end,
         cancelled_by = case when coalesce(p_cancelled, true) then coalesce(a.cancelled_by, app.current_member_id()) end,
         updated_at   = now()
   where a.id = p_attendee and a.project_id = p_project;
  if not found then
    perform app.refuse('not_found', 'This attendee does not exist.');
  end if;
end;
$$;

-- Queues the pass email again. False: no email on file, or one was queued in
-- the last ten minutes.
create or replace function public.event_resend_pass(p_project uuid, p_attendee uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if app.event_attendance_role(p_project) is distinct from 'manager' then
    perform app.refuse('forbidden', 'Only the project''s managers can send a pass again.');
  end if;
  if not exists (select 1 from event_attendees a where a.id = p_attendee and a.project_id = p_project) then
    perform app.refuse('not_found', 'This attendee does not exist.');
  end if;
  return app.event_queue_pass(p_attendee);
end;
$$;

-- -----------------------------------------------------------------------------
-- Members: the gate (managers and the HR team)
-- -----------------------------------------------------------------------------

-- Checks an attendee in for today, by the pass's token (the QR code) or by
-- their id (found by name or mobile). Answers what the scanner shows:
--   result  'checked_in' or 'already' (then `at` is the first check-in)
create or replace function public.event_check_in(
  p_project uuid,
  p_token text default null,
  p_attendee uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_attendee event_attendees;
  v_settings event_attendance_settings;
  v_today    date := app.club_today();
  v_at       timestamptz;
  v_new      boolean := false;
begin
  if app.event_attendance_role(p_project) is null then
    perform app.refuse('forbidden', 'You may not check people in to this event.');
  end if;

  if p_token is not null then
    select * into v_attendee from event_attendees a where a.token = p_token;
  elsif p_attendee is not null then
    select * into v_attendee from event_attendees a where a.id = p_attendee;
  end if;
  if v_attendee.id is null then
    perform app.refuse('not_found', 'This pass is not known.');
  end if;
  if v_attendee.project_id <> p_project then
    perform app.refuse('wrong_event', 'This pass is for another event.');
  end if;
  if v_attendee.cancelled_at is not null then
    perform app.refuse('attendee_cancelled', 'This pass was cancelled.');
  end if;

  select * into v_settings from event_attendance_settings s where s.project_id = p_project;
  if v_settings.first_day is not null and (v_today < v_settings.first_day or v_today > v_settings.last_day) then
    perform app.refuse('not_an_event_day', 'Today is not one of the event''s days.');
  end if;

  -- The claim: the unique index decides, nothing checks first.
  insert into event_check_ins (attendee_id, project_id, day, checked_in_by, via)
  values (v_attendee.id, p_project, v_today, app.current_member_id(),
          case when p_token is not null then 'scan' else 'manual' end)
  on conflict (attendee_id, day) where undone_at is null do nothing
  returning checked_in_at into v_at;

  if v_at is not null then
    v_new := true;
  else
    select c.checked_in_at into v_at from event_check_ins c
     where c.attendee_id = v_attendee.id and c.day = v_today and c.undone_at is null;
  end if;

  return jsonb_build_object(
    'result', case when v_new then 'checked_in' else 'already' end,
    'attendee_id', v_attendee.id,
    'name', v_attendee.name,
    'day', v_today,
    'at', v_at
  );
end;
$$;

-- Undoes today's check-in (the wrong person's pass was read).
create or replace function public.event_undo_check_in(p_project uuid, p_attendee uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if app.event_attendance_role(p_project) is null then
    perform app.refuse('forbidden', 'You may not change check-ins for this event.');
  end if;
  update event_check_ins c
     set undone_at = now(), undone_by = app.current_member_id(), changed_at = now()
   where c.attendee_id = p_attendee
     and c.project_id = p_project
     and c.day = app.club_today()
     and c.undone_at is null;
  if not found then
    perform app.refuse('not_checked_in', 'This attendee is not checked in today.');
  end if;
end;
$$;

-- Finds attendees by part of a name or the end of a mobile number, for
-- someone at the gate without their pass. At most twenty, and only the last
-- four digits of the mobile.
create or replace function public.event_find_attendees(p_project uuid, p_query text)
returns table (
  id                uuid,
  name              text,
  phone_tail        text,
  cancelled         boolean,
  checked_in_today  boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query  text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  if app.event_attendance_role(p_project) is null then
    perform app.refuse('forbidden', 'You may not search this event''s attendees.');
  end if;
  if char_length(v_query) < 3 then
    return;
  end if;
  return query
    select a.id, a.name, right(a.phone, 4), a.cancelled_at is not null,
           exists (select 1 from event_check_ins c
                    where c.attendee_id = a.id and c.day = app.club_today() and c.undone_at is null)
      from event_attendees a
     where a.project_id = p_project
       and (position(lower(v_query) in lower(a.name)) > 0
            or (char_length(v_digits) >= 4 and right(a.phone, char_length(v_digits)) = v_digits))
     order by a.name
     limit 20;
end;
$$;

-- -----------------------------------------------------------------------------
-- Server only: the public pages
-- -----------------------------------------------------------------------------

-- What the sign-up page needs. No row: the project has no Event attendance.
create or replace function public.event_public(p_project uuid)
returns table (
  name_en      text,
  name_ar      text,
  signup_open  boolean,
  first_day    date,
  last_day     date,
  theme        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.name_en, p.name_ar, coalesce(s.signup_open, false), s.first_day, s.last_day,
         app.event_theme(p.id)
    from projects p
    join project_components pc on pc.project_id = p.id and pc.component_key = 'event_attendance'
    left join event_attendance_settings s on s.project_id = p.id
   where p.id = p_project
$$;

-- Registers a person, from the sign-up form (p_require_open) or from another
-- component through the API. A mobile already registered answers with that
-- attendee and created = false: the caller decides what to show (the form
-- never shows somebody's pass to whoever typed their number).
create or replace function public.event_register(
  p_project uuid,
  p_token text,
  p_name text,
  p_phone text,
  p_email text default null,
  p_locale text default 'ar',
  p_source text default 'form',
  p_source_ref text default null,
  p_require_open boolean default true,
  p_send_pass boolean default true
)
returns table (attendee_id uuid, token text, created boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     event_attendees;
  v_created boolean := true;
begin
  if not exists (select 1 from project_components pc
                  where pc.project_id = p_project and pc.component_key = 'event_attendance') then
    perform app.refuse('not_found', 'This event does not exist.');
  end if;
  if p_require_open and not coalesce(
       (select s.signup_open from event_attendance_settings s where s.project_id = p_project), false) then
    perform app.refuse('signup_closed', 'Sign-up for this event is closed.');
  end if;

  begin
    insert into event_attendees (project_id, token, name, phone, email, locale, source, source_ref)
    values (
      p_project,
      p_token,
      btrim(coalesce(p_name, '')),
      btrim(coalesce(p_phone, '')),
      nullif(lower(btrim(coalesce(p_email, ''))), ''),
      case when p_locale = 'en' then 'en' else 'ar' end,
      coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'form'),
      nullif(btrim(coalesce(p_source_ref, '')), '')
    )
    on conflict on constraint event_attendees_phone_once do nothing
    returning * into v_row;
  exception
    when check_violation or not_null_violation then
      perform app.refuse('invalid', 'Some details are missing or not valid: ' || sqlerrm);
  end;

  if v_row.id is null then
    v_created := false;
    select * into v_row from event_attendees a
     where a.project_id = p_project and a.phone = btrim(coalesce(p_phone, ''));
    if v_row.id is null then
      -- The token collided, which 192 random bits do not do: say so plainly.
      perform app.refuse('invalid', 'The pass could not be made. Try again.');
    end if;
    if v_row.cancelled_at is not null then
      perform app.refuse('attendee_cancelled', 'This registration was cancelled.');
    end if;
  end if;

  if p_send_pass then
    perform app.event_queue_pass(v_row.id);
  end if;

  return query select v_row.id, v_row.token, v_created;
end;
$$;

-- What a pass page shows, by its token. No row: the link is unknown.
create or replace function public.event_pass(p_token text)
returns table (
  attendee_id  uuid,
  project_id   uuid,
  name         text,
  name_en      text,
  name_ar      text,
  cancelled    boolean,
  first_day    date,
  last_day     date,
  days         date[],
  theme        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.project_id, a.name, p.name_en, p.name_ar, a.cancelled_at is not null,
         s.first_day, s.last_day,
         coalesce((select array_agg(c.day order by c.day) from event_check_ins c
                    where c.attendee_id = a.id and c.undone_at is null), '{}'::date[]),
         app.event_theme(a.project_id)
    from event_attendees a
    join projects p on p.id = a.project_id
    left join event_attendance_settings s on s.project_id = a.project_id
   where a.token = p_token
$$;

-- -----------------------------------------------------------------------------
-- Server only: sending the passes
-- -----------------------------------------------------------------------------

-- Leases pass emails to send, with what the email needs. A row leased two
-- minutes ago and still unsent is leased again; five attempts at most.
create or replace function public.event_claim_passes(p_limit integer default 50)
returns table (
  id          uuid,
  to_email    text,
  to_name     text,
  locale      text,
  token       text,
  project_id  uuid,
  name_en     text,
  name_ar     text,
  first_day   date,
  last_day    date
)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with leased as (
    update event_pass_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
     where o.id in (
       select x.id from event_pass_outbox x
        where x.sent_at is null
          and x.attempts < 5
          and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
        order by x.created_at
        limit greatest(p_limit, 1)
        for update skip locked
     )
    returning o.id, o.attendee_id
  )
  select l.id, a.email, a.name, a.locale, a.token, a.project_id, p.name_en, p.name_ar,
         s.first_day, s.last_day
    from leased l
    join event_attendees a on a.id = l.attendee_id
    join projects p on p.id = a.project_id
    left join event_attendance_settings s on s.project_id = a.project_id
   where a.email is not null and a.cancelled_at is null
$$;

-- Records what became of one leased email: sent (p_provider_id) or not (p_error).
create or replace function public.event_pass_result(p_id uuid, p_provider_id text, p_error text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update event_pass_outbox o
     set sent_at     = case when p_provider_id is not null then now() end,
         provider_id = p_provider_id,
         last_error  = case when p_provider_id is null then left(coalesce(p_error, 'unknown'), 500) end,
         claimed_at  = null
   where o.id = p_id
$$;

-- -----------------------------------------------------------------------------
-- Server only: the API other components read
-- -----------------------------------------------------------------------------

-- Attendees changed after p_since (all of them when it is null), oldest
-- change first. The token is included: the caller is a trusted component.
create or replace function public.event_api_attendees(p_project uuid, p_since timestamptz default null)
returns table (
  id            uuid,
  token         text,
  name          text,
  phone         text,
  email         text,
  locale        text,
  source        text,
  source_ref    text,
  created_at    timestamptz,
  updated_at    timestamptz,
  cancelled_at  timestamptz,
  days          date[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.token, a.name, a.phone, a.email, a.locale, a.source, a.source_ref,
         a.created_at, a.updated_at, a.cancelled_at,
         coalesce((select array_agg(c.day order by c.day) from event_check_ins c
                    where c.attendee_id = a.id and c.undone_at is null), '{}'::date[])
    from event_attendees a
   where a.project_id = p_project
     and (p_since is null or a.updated_at > p_since)
   order by a.updated_at, a.id
   limit 5000
$$;

-- Check-ins made or undone after p_since, oldest change first. An undone one
-- comes back with undone_at set, so a component that awarded something for
-- it can take it away.
create or replace function public.event_api_check_ins(p_project uuid, p_since timestamptz default null)
returns table (
  id             uuid,
  attendee_id    uuid,
  day            date,
  checked_in_at  timestamptz,
  via            text,
  undone_at      timestamptz,
  changed_at     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.attendee_id, c.day, c.checked_in_at, c.via, c.undone_at, c.changed_at
    from event_check_ins c
   where c.project_id = p_project
     and (p_since is null or c.changed_at > p_since)
   order by c.changed_at, c.id
   limit 5000
$$;

-- -----------------------------------------------------------------------------
-- Who may call what
-- -----------------------------------------------------------------------------

revoke execute on function public.event_attendance_summary(uuid) from public, anon;
revoke execute on function public.event_save_settings(uuid, boolean, date, date) from public, anon;
revoke execute on function public.event_attendee_list(uuid) from public, anon;
revoke execute on function public.event_set_attendee_cancelled(uuid, uuid, boolean) from public, anon;
revoke execute on function public.event_resend_pass(uuid, uuid) from public, anon;
revoke execute on function public.event_check_in(uuid, text, uuid) from public, anon;
revoke execute on function public.event_undo_check_in(uuid, uuid) from public, anon;
revoke execute on function public.event_find_attendees(uuid, text) from public, anon;

grant execute on function public.event_attendance_summary(uuid) to authenticated;
grant execute on function public.event_save_settings(uuid, boolean, date, date) to authenticated;
grant execute on function public.event_attendee_list(uuid) to authenticated;
grant execute on function public.event_set_attendee_cancelled(uuid, uuid, boolean) to authenticated;
grant execute on function public.event_resend_pass(uuid, uuid) to authenticated;
grant execute on function public.event_check_in(uuid, text, uuid) to authenticated;
grant execute on function public.event_undo_check_in(uuid, uuid) to authenticated;
grant execute on function public.event_find_attendees(uuid, text) to authenticated;

-- The service role only: nobody signed in, and nobody anonymous, runs these.
revoke execute on function public.event_public(uuid) from public, anon, authenticated;
revoke execute on function public.event_register(uuid, text, text, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.event_pass(text) from public, anon, authenticated;
revoke execute on function public.event_claim_passes(integer) from public, anon, authenticated;
revoke execute on function public.event_pass_result(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.event_api_attendees(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.event_api_check_ins(uuid, timestamptz) from public, anon, authenticated;
-- 0002 grants every function in `app` to everyone; this one writes.
revoke execute on function app.event_queue_pass(uuid) from public, anon, authenticated;

grant execute on function public.event_public(uuid) to service_role;
grant execute on function public.event_register(uuid, text, text, text, text, text, text, text, boolean, boolean) to service_role;
grant execute on function public.event_pass(text) to service_role;
grant execute on function public.event_claim_passes(integer) to service_role;
grant execute on function public.event_pass_result(uuid, text, text) to service_role;
grant execute on function public.event_api_attendees(uuid, timestamptz) to service_role;
grant execute on function public.event_api_check_ins(uuid, timestamptz) to service_role;

grant execute on function public.my_component_access() to authenticated;
grant execute on function app.refuse(text, text) to anon, authenticated, service_role;
grant execute on function app.club_today() to anon, authenticated, service_role;
grant execute on function app.is_on_team(text) to anon, authenticated, service_role;
grant execute on function app.event_attendance_role(uuid) to anon, authenticated, service_role;
grant execute on function app.event_theme(uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
