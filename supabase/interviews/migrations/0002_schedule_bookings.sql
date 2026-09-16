-- =============================================================================
-- 0002 — Sessions, slots, bookings, and the five stages.
--
-- A SESSION is what a manager creates: "Qiddiya, Room 11, Tuesday 14:00–17:00,
-- 20-minute slots". The slots are generated from it. A BOOKING is a student
-- holding one slot; on the day it moves scheduled → arrived → in_interview →
-- done, with no_show as the way out.
--
-- The guarantees are constraints, not code:
--   bookings_one_per_slot     a slot is taken once, however many tap it at once
--   bookings_one_per_company  a student holds one slot per company
--   bookings_no_overlap       a student is never booked in two places at once
--   sessions_room_no_overlap  a room hosts one company at a time
-- Cancelled bookings drop out of all four (they are partial), so a cancelled
-- slot is free again without the history being deleted.
-- =============================================================================

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  edition_id    uuid not null references editions (id) on delete cascade,
  company_id    uuid not null references companies (id) on delete cascade,
  room_id       uuid not null references rooms (id),
  day           date not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  slot_minutes  integer not null check (slot_minutes between 5 and 60 and mod(slot_minutes, 5) = 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sessions_ends_after_start check (ends_at > starts_at),
  constraint sessions_room_no_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create index sessions_edition_day_idx on sessions (edition_id, day);
create index sessions_company_idx on sessions (company_id, starts_at);

create trigger sessions_touch before update on sessions
  for each row execute function app.touch_updated_at();
create trigger sessions_audit after insert or update or delete on sessions
  for each row execute function app.audit_row();

create table slots (
  id          uuid primary key default gen_random_uuid(),
  edition_id  uuid not null references editions (id) on delete cascade,
  session_id  uuid not null references sessions (id) on delete cascade,
  -- Copied from the session so the busiest queries need no join.
  company_id  uuid not null references companies (id) on delete cascade,
  room_id     uuid not null references rooms (id),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  -- Withdrawn from booking (an interviewer's break) without being deleted.
  is_closed   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (session_id, starts_at),
  constraint slots_ends_after_start check (ends_at > starts_at)
);

create index slots_company_time_idx on slots (company_id, starts_at);
create index slots_edition_time_idx on slots (edition_id, starts_at);

create trigger slots_audit after insert or update or delete on slots
  for each row execute function app.audit_row();

create table bookings (
  id                 uuid primary key default gen_random_uuid(),
  edition_id         uuid not null references editions (id) on delete cascade,
  slot_id            uuid not null references slots (id) on delete cascade,
  application_id     uuid not null references applications (id) on delete cascade,
  company_id         uuid not null references companies (id) on delete cascade,
  -- Copied from the slot: the overlap constraint needs them on this row, and
  -- a moved booking simply gets new ones.
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,

  stage              text not null default 'scheduled'
                     check (stage in ('scheduled', 'arrived', 'in_interview', 'done', 'no_show')),
  arrived_at         timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  stage_changed_at   timestamptz,
  stage_changed_by   text,

  booked_at          timestamptz not null default now(),
  booked_by_kind     text not null default 'student' check (booked_by_kind in ('student', 'staff')),
  cancelled_at       timestamptz,
  cancelled_by_kind  text check (cancelled_by_kind in ('student', 'staff')),
  cancel_reason      text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint bookings_ends_after_start check (ends_at > starts_at)
);

create unique index bookings_one_per_slot
  on bookings (slot_id) where cancelled_at is null;
create unique index bookings_one_per_company
  on bookings (application_id, company_id) where cancelled_at is null;
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    application_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (cancelled_at is null);

create index bookings_company_time_idx on bookings (company_id, starts_at) where cancelled_at is null;
create index bookings_edition_time_idx on bookings (edition_id, starts_at) where cancelled_at is null;
create index bookings_application_idx on bookings (application_id);

create trigger bookings_touch before update on bookings
  for each row execute function app.touch_updated_at();
create trigger bookings_audit after insert or update or delete on bookings
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Reads the pages share
-- -----------------------------------------------------------------------------

-- Every slot with whoever holds it. The student page, the floor board, the
-- interviewer page and the schedule all read this.
create view slot_status as
  select
    s.id, s.edition_id, s.session_id, s.company_id, s.room_id,
    s.starts_at, s.ends_at, s.is_closed,
    b.id            as booking_id,
    b.application_id,
    b.stage,
    b.arrived_at,
    b.stage_changed_at,
    a.name          as student_name,
    a.phone         as student_phone
  from slots s
  left join bookings b on b.slot_id = s.id and b.cancelled_at is null
  left join applications a on a.id = b.application_id;

-- Accepted-vs-slots per company, for HR's counters (no hard cap).
create view company_counters as
  select
    c.id as company_id,
    c.edition_id,
    count(ap.id) filter (where ap.decision = 'accepted') as accepted,
    count(ap.id) filter (where ap.decision = 'rejected') as rejected,
    count(ap.id) filter (where ap.decision = 'pending')  as pending,
    (select count(*) from slots s where s.company_id = c.id and not s.is_closed) as slots_total,
    (select count(*) from bookings b where b.company_id = c.id and b.cancelled_at is null) as slots_booked
  from companies c
  left join application_preferences ap on ap.company_id = c.id
  group by c.id, c.edition_id;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- "2026-04-21" + "14:00" on the edition's clock, as an instant.
create or replace function app.edition_time(p_edition uuid, p_day date, p_time text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone text;
begin
  if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    perform app.refuse('bad_time', 'Times must look like 14:30.');
  end if;
  select time_zone into v_zone from editions where id = p_edition;
  return (p_day::text || ' ' || p_time)::timestamp at time zone coalesce(v_zone, 'Asia/Riyadh');
end;
$$;

create or replace function app.live_edition(p_edition uuid)
returns editions
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  e editions;
begin
  select * into e from editions where id = p_edition;
  if e.id is null then
    perform app.refuse('not_found', 'No such edition.');
  end if;
  if e.status = 'archived' then
    perform app.refuse('archived', 'This edition is archived and read-only.');
  end if;
  return e;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sessions and slots
-- -----------------------------------------------------------------------------

-- p_payload: company_id, room_id, day (YYYY-MM-DD), start_time, end_time
-- (HH:MM), slot_minutes. Generates the slots; returns the session and count.
create or replace function public.create_session(p_edition uuid, p_payload jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e          editions;
  v_company  uuid := (p_payload ->> 'company_id')::uuid;
  v_room     uuid := (p_payload ->> 'room_id')::uuid;
  v_day      date := (p_payload ->> 'day')::date;
  v_len      integer := (p_payload ->> 'slot_minutes')::integer;
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_session  sessions;
  v_t        timestamptz;
  v_n        integer := 0;
begin
  perform app.set_actor(p_actor);
  e := app.live_edition(p_edition);

  if not exists (select 1 from companies c where c.id = v_company and c.edition_id = p_edition) then
    perform app.refuse('not_found', 'No such company in this edition.');
  end if;
  if not exists (select 1 from rooms r where r.id = v_room and r.edition_id = p_edition and r.is_active) then
    perform app.refuse('not_found', 'No such active room in this edition.');
  end if;
  if v_len is null or v_len < 5 or v_len > 60 or mod(v_len, 5) <> 0 then
    perform app.refuse('bad_slot_length', 'Slot length must be 5 to 60 minutes, in steps of 5.');
  end if;

  v_starts := app.edition_time(p_edition, v_day, p_payload ->> 'start_time');
  v_ends   := app.edition_time(p_edition, v_day, p_payload ->> 'end_time');

  if v_ends <= v_starts then
    perform app.refuse('end_before_start', 'The end time must be after the start time.');
  end if;
  if mod(extract(epoch from (v_ends - v_starts))::integer, v_len * 60) <> 0 then
    perform app.refuse('not_whole_slots',
      format('From %s to %s is not a whole number of %s-minute slots.',
             p_payload ->> 'start_time', p_payload ->> 'end_time', v_len));
  end if;

  begin
    insert into sessions (edition_id, company_id, room_id, day, starts_at, ends_at, slot_minutes)
    values (p_edition, v_company, v_room, v_day, v_starts, v_ends, v_len)
    returning * into v_session;
  exception
    when exclusion_violation then
      perform app.refuse('room_busy', 'That room is already in use for part of that time.');
  end;

  v_t := v_starts;
  while v_t < v_ends loop
    insert into slots (edition_id, session_id, company_id, room_id, starts_at, ends_at)
    values (p_edition, v_session.id, v_company, v_room, v_t, v_t + make_interval(mins => v_len));
    v_n := v_n + 1;
    v_t := v_t + make_interval(mins => v_len);
  end loop;

  return jsonb_build_object('session_id', v_session.id, 'slots', v_n);
end;
$$;

-- Adds slots after the current end. A session with bookings is never
-- regenerated; it only grows.
create or replace function public.extend_session(p_session uuid, p_end_time text, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s        sessions;
  v_ends   timestamptz;
  v_t      timestamptz;
  v_n      integer := 0;
begin
  perform app.set_actor(p_actor);

  select * into s from sessions where id = p_session;
  if s.id is null then
    perform app.refuse('not_found', 'No such session.');
  end if;
  perform app.live_edition(s.edition_id);

  v_ends := app.edition_time(s.edition_id, s.day, p_end_time);
  if v_ends <= s.ends_at then
    perform app.refuse('not_later', 'The new end must be after the current end.');
  end if;
  if mod(extract(epoch from (v_ends - s.ends_at))::integer, s.slot_minutes * 60) <> 0 then
    perform app.refuse('not_whole_slots', 'The extension is not a whole number of slots.');
  end if;

  begin
    update sessions set ends_at = v_ends where id = p_session;
  exception
    when exclusion_violation then
      perform app.refuse('room_busy', 'That room is already in use for part of that time.');
  end;

  v_t := s.ends_at;
  while v_t < v_ends loop
    insert into slots (edition_id, session_id, company_id, room_id, starts_at, ends_at)
    values (s.edition_id, s.id, s.company_id, s.room_id, v_t, v_t + make_interval(mins => s.slot_minutes));
    v_n := v_n + 1;
    v_t := v_t + make_interval(mins => s.slot_minutes);
  end loop;

  return jsonb_build_object('session_id', s.id, 'added', v_n);
end;
$$;

-- Only while nobody holds any of its slots. Cancelled bookings do not count.
create or replace function public.delete_session(p_session uuid, p_actor jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s sessions;
begin
  perform app.set_actor(p_actor);
  select * into s from sessions where id = p_session;
  if s.id is null then
    perform app.refuse('not_found', 'No such session.');
  end if;
  perform app.live_edition(s.edition_id);

  if exists (select 1 from bookings b join slots sl on sl.id = b.slot_id
              where sl.session_id = p_session and b.cancelled_at is null) then
    perform app.refuse('session_booked', 'Students hold slots in this session. Move or cancel them first.');
  end if;

  delete from slots where session_id = p_session;
  delete from sessions where id = p_session;
end;
$$;

-- Closing a slot that somebody holds is refused: move or cancel them first.
create or replace function public.set_slot_closed(p_slot uuid, p_closed boolean, p_actor jsonb)
returns slots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v slots;
begin
  perform app.set_actor(p_actor);
  select * into v from slots where id = p_slot;
  if v.id is null then
    perform app.refuse('not_found', 'No such slot.');
  end if;
  perform app.live_edition(v.edition_id);

  if p_closed and exists (select 1 from bookings b where b.slot_id = p_slot and b.cancelled_at is null) then
    perform app.refuse('slot_booked', 'A student holds this slot. Move or cancel the booking first.');
  end if;

  update slots set is_closed = p_closed where id = p_slot returning * into v;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Booking
--
-- The student's versions resolve the personal token and enforce the edition's
-- booking window and change cutoff. The staff versions take an actor and skip
-- the window, because a manager fixing a booking at the reception desk is
-- exactly who the window is not for. Both go through the same three helpers.
-- -----------------------------------------------------------------------------

create or replace function app.booking_open(e editions)
returns void
language plpgsql
stable
as $$
begin
  if e.status <> 'active'
     or e.booking_opens_at is null or e.booking_closes_at is null
     or now() < e.booking_opens_at or now() >= e.booking_closes_at then
    perform app.refuse('booking_closed', 'Booking is closed.');
  end if;
end;
$$;

create or replace function app.within_cutoff(e editions, p_starts_at timestamptz)
returns void
language plpgsql
stable
as $$
declare
  v_hours integer := coalesce((app.edition_settings(e.id) ->> 'change_cutoff_hours')::integer, 12);
begin
  if p_starts_at - now() < make_interval(hours => v_hours) then
    perform app.refuse('too_late',
      format('Changes close %s hours before the interview. Contact the club.', v_hours));
  end if;
end;
$$;

create or replace function app.student_by_token(p_token text)
returns applications
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a applications;
begin
  select * into a from applications where personal_token = p_token;
  if a.id is null then
    perform app.refuse('bad_link', 'This link is not recognised.');
  end if;
  return a;
end;
$$;

-- The insert, with the constraint violations turned into sentences.
create or replace function app.do_book(
  p_app   applications,
  p_slot  uuid,
  p_kind  text
)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sl            slots;
  b             bookings;
  v_constraint  text;
begin
  select * into sl from slots where id = p_slot;
  if sl.id is null or sl.edition_id <> p_app.edition_id then
    perform app.refuse('not_found', 'That slot does not exist.');
  end if;
  if sl.is_closed then
    perform app.refuse('slot_closed', 'That slot is not available.');
  end if;
  if not exists (select 1 from application_preferences ap
                  where ap.application_id = p_app.id
                    and ap.company_id = sl.company_id
                    and ap.decision = 'accepted') then
    perform app.refuse('not_accepted', 'You were not accepted for this company.');
  end if;

  begin
    insert into bookings
      (edition_id, slot_id, application_id, company_id, starts_at, ends_at, booked_by_kind)
    values
      (sl.edition_id, sl.id, p_app.id, sl.company_id, sl.starts_at, sl.ends_at, p_kind)
    returning * into b;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'bookings_one_per_slot' then
        perform app.refuse('slot_taken', 'Someone took that slot first. Pick another one.');
      end if;
      perform app.refuse('already_booked', 'You already hold a slot with this company. Move it instead.');
    when exclusion_violation then
      perform app.refuse('overlap', 'That time overlaps another of your interviews.');
  end;

  perform app.enqueue_email(
    b.edition_id, b.application_id, 'booking_confirmed',
    app.booking_payload(b.id),
    'booked:' || b.id::text);

  return b;
end;
$$;

-- What an email about a booking needs, captured at the moment it is queued.
create or replace function app.booking_payload(p_booking uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'booking_id',      b.id,
    'company_id',      c.id,
    'company_name_en', c.name_en,
    'company_name_ar', c.name_ar,
    'room',            r.name,
    'starts_at',       b.starts_at,
    'ends_at',         b.ends_at,
    'time_zone',       e.time_zone
  )
  from bookings b
  join companies c on c.id = b.company_id
  join slots s on s.id = b.slot_id
  join rooms r on r.id = s.room_id
  join editions e on e.id = b.edition_id
  where b.id = p_booking
$$;

create or replace function app.do_move(
  p_booking  bookings,
  p_slot     uuid,
  p_kind     text
)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sl            slots;
  b             bookings;
  v_old         jsonb := app.booking_payload(p_booking.id);
  v_constraint  text;
begin
  if p_booking.stage <> 'scheduled' then
    perform app.refuse('not_scheduled', 'This interview has already started; it cannot be moved.');
  end if;

  select * into sl from slots where id = p_slot;
  if sl.id is null or sl.edition_id <> p_booking.edition_id then
    perform app.refuse('not_found', 'That slot does not exist.');
  end if;
  if sl.company_id <> p_booking.company_id then
    perform app.refuse('other_company', 'That slot belongs to another company.');
  end if;
  if sl.is_closed then
    perform app.refuse('slot_closed', 'That slot is not available.');
  end if;
  if sl.id = p_booking.slot_id then
    return p_booking;
  end if;

  begin
    update bookings
       set slot_id = sl.id, starts_at = sl.starts_at, ends_at = sl.ends_at,
           booked_at = now(), booked_by_kind = p_kind
     where id = p_booking.id
     returning * into b;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'bookings_one_per_slot' then
        perform app.refuse('slot_taken', 'Someone took that slot first. Pick another one.');
      end if;
      raise;
    when exclusion_violation then
      perform app.refuse('overlap', 'That time overlaps another of your interviews.');
  end;

  perform app.enqueue_email(
    b.edition_id, b.application_id, 'booking_moved',
    app.booking_payload(b.id) || jsonb_build_object('previous', v_old),
    'moved:' || b.id::text || ':' || sl.id::text);

  return b;
end;
$$;

create or replace function app.do_cancel(
  p_booking  bookings,
  p_reason   text,
  p_kind     text
)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b bookings;
  v_payload jsonb := app.booking_payload(p_booking.id);
begin
  update bookings
     set cancelled_at = now(), cancelled_by_kind = p_kind, cancel_reason = nullif(p_reason, '')
   where id = p_booking.id and cancelled_at is null
   returning * into b;

  if b.id is null then
    perform app.refuse('already_cancelled', 'That booking was already cancelled.');
  end if;

  perform app.enqueue_email(
    b.edition_id, b.application_id, 'booking_cancelled',
    v_payload || jsonb_build_object('reason', nullif(p_reason, '')),
    'cancelled:' || b.id::text);

  return b;
end;
$$;

-- The student's own three.

create or replace function public.book_slot(p_token text, p_slot uuid)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a  applications;
  e  editions;
  sl slots;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));

  select * into sl from slots where id = p_slot;
  if sl.id is not null and sl.starts_at <= now() then
    perform app.refuse('slot_past', 'That time has already passed.');
  end if;

  return app.do_book(a, p_slot, 'student');
end;
$$;

create or replace function public.move_booking(p_token text, p_booking uuid, p_slot uuid)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a  applications;
  e  editions;
  b  bookings;
  sl slots;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));

  select * into b from bookings where id = p_booking and application_id = a.id and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'That booking is not yours, or was cancelled.');
  end if;
  perform app.within_cutoff(e, b.starts_at);

  select * into sl from slots where id = p_slot;
  if sl.id is not null and sl.starts_at <= now() then
    perform app.refuse('slot_past', 'That time has already passed.');
  end if;

  return app.do_move(b, p_slot, 'student');
end;
$$;

create or replace function public.cancel_booking(p_token text, p_booking uuid, p_reason text default null)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a applications;
  e editions;
  b bookings;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));

  select * into b from bookings where id = p_booking and application_id = a.id and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'That booking is not yours, or was cancelled.');
  end if;
  if b.stage <> 'scheduled' then
    perform app.refuse('not_scheduled', 'This interview has already started; it cannot be cancelled.');
  end if;
  perform app.within_cutoff(e, b.starts_at);

  return app.do_cancel(b, p_reason, 'student');
end;
$$;

-- The staff versions: an organizer or manager acting for a student.

create or replace function public.staff_book_slot(p_application uuid, p_slot uuid, p_actor jsonb)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a applications;
begin
  perform app.set_actor(p_actor);
  select * into a from applications where id = p_application;
  if a.id is null then
    perform app.refuse('not_found', 'No such applicant.');
  end if;
  perform app.live_edition(a.edition_id);
  return app.do_book(a, p_slot, 'staff');
end;
$$;

create or replace function public.staff_move_booking(p_booking uuid, p_slot uuid, p_actor jsonb)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b bookings;
begin
  perform app.set_actor(p_actor);
  select * into b from bookings where id = p_booking and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'No such active booking.');
  end if;
  perform app.live_edition(b.edition_id);
  return app.do_move(b, p_slot, 'staff');
end;
$$;

create or replace function public.staff_cancel_booking(p_booking uuid, p_reason text, p_actor jsonb)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b bookings;
begin
  perform app.set_actor(p_actor);
  select * into b from bookings where id = p_booking and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'No such active booking.');
  end if;
  perform app.live_edition(b.edition_id);
  if b.stage in ('in_interview', 'done') then
    perform app.refuse('not_scheduled', 'This interview has happened; it cannot be cancelled.');
  end if;
  return app.do_cancel(b, p_reason, 'staff');
end;
$$;

-- -----------------------------------------------------------------------------
-- The stages
--
-- An organizer moves one step forward, or one step back to undo a mistaken
-- tap, and can mark a no-show from scheduled or arrived. A manager may set any
-- stage. Every move updates this one row; the audit trigger keeps the trail.
-- -----------------------------------------------------------------------------

create or replace function public.advance_stage(
  p_booking     uuid,
  p_to          text,
  p_actor       jsonb,
  p_as_manager  boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b        bookings;
  v_from   text;
  v_name   text := coalesce(p_actor ->> 'name', 'system');
begin
  perform app.set_actor(p_actor);

  if p_to not in ('scheduled', 'arrived', 'in_interview', 'done', 'no_show') then
    perform app.refuse('bad_stage', 'Unknown stage.');
  end if;

  select * into b from bookings where id = p_booking and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'No such active booking.');
  end if;
  perform app.live_edition(b.edition_id);

  v_from := b.stage;
  if v_from = p_to then
    return b;
  end if;

  if not p_as_manager and not (
       (v_from, p_to) in (
         ('scheduled', 'arrived'), ('arrived', 'in_interview'), ('in_interview', 'done'),
         ('scheduled', 'no_show'), ('arrived', 'no_show'),
         ('arrived', 'scheduled'), ('in_interview', 'arrived'), ('done', 'in_interview'),
         ('no_show', 'scheduled')
       )) then
    perform app.refuse('bad_transition', format('Cannot move from %s to %s.', v_from, p_to));
  end if;

  update bookings
     set stage            = p_to,
         stage_changed_at = now(),
         stage_changed_by = v_name,
         arrived_at  = case when p_to = 'arrived'      then coalesce(arrived_at, now())
                            when p_to = 'scheduled'    then null
                            else arrived_at end,
         started_at  = case when p_to = 'in_interview' then now()
                            when p_to in ('scheduled', 'arrived', 'no_show') then null
                            else started_at end,
         finished_at = case when p_to = 'done'         then now()
                            else null end
   where id = p_booking
   returning * into b;

  return b;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS: on, no policies
-- -----------------------------------------------------------------------------

alter table sessions enable row level security;
alter table slots    enable row level security;
alter table bookings enable row level security;
