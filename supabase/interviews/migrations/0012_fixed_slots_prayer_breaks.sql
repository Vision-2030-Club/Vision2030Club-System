-- =============================================================================
-- 0012 — Every slot is 20 minutes, prayer breaks are left empty, and a past
-- time can be booked.
--
--   1. create_session makes 20-minute slots whatever slot_minutes it is sent.
--      Letting each assignment pick its own length put a 20-minute room and a
--      30-minute room of the same company side by side on the student's
--      page, and the picker filled with near-identical overlapping times.
--      The column stays (old sessions keep the length they were made with,
--      and extend_session grows a session at its own length).
--
--   2. No slot is made across a prayer break: 15:00–15:30 and 17:30–18:00 on
--      the edition's clock. Slots run up to the break and pick up again when
--      it ends (14:00 … 14:40, then 15:30 … 17:10, then 18:00 …). The break
--      times live in app.prayer_breaks below and in PRAYER_BREAKS in
--      src/lib/interviews/slotRules.ts (the floor grid); change both together.
--      Because a break moves the grid by ten minutes, an assignment's end no
--      longer has to be a whole number of slots: slots are made while one
--      fits, and the session's end is trimmed to its last slot.
--
--   3. book_slot and move_booking no longer refuse a time that has passed,
--      in any edition. 0009 brought that rule back for active editions; the
--      team books on the students' behalf and decided it only got in the way
--      (a room for tomorrow with today's test slots beside it refused the
--      wrong click). Everything else booking enforces is untouched.
--
--   4. Slots already made inside a prayer break are CLOSED (is_closed), not
--      deleted, unless someone holds them; a held one is left for HR to move.
--      Archived editions are not touched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1–2. The slot rules, in one place.
-- ---------------------------------------------------------------------------

create or replace function app.slot_minutes()
returns integer
language sql
immutable
as $$
  select 20
$$;

-- The prayer breaks on p_day, as instants on the edition's clock.
create or replace function app.prayer_breaks(p_edition uuid, p_day date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.edition_time(p_edition, p_day, b.from_time),
         app.edition_time(p_edition, p_day, b.to_time)
    from (values ('15:00', '15:30'),
                 ('17:30', '18:00')) as b (from_time, to_time)
$$;

-- The first start at or after p_t whose p_len-minute slot misses every break.
create or replace function app.next_slot_start(p_edition uuid, p_day date, p_t timestamptz, p_len integer)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_t    timestamptz := p_t;
  v_end  timestamptz;
begin
  loop
    select max(pb.ends_at) into v_end
      from app.prayer_breaks(p_edition, p_day) pb
     where pb.starts_at < v_t + make_interval(mins => p_len)
       and pb.ends_at > v_t;
    exit when v_end is null;
    v_t := v_end;
  end loop;
  return v_t;
end;
$$;

-- p_payload: company_id, room_id, day (YYYY-MM-DD), start_time, end_time
-- (HH:MM). slot_minutes is ignored (app.slot_minutes). Returns the session
-- and how many slots were made.
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
  v_len      integer := app.slot_minutes();
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_session  sessions;
  v_t        timestamptz;
  v_last     timestamptz;
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

  v_starts := app.edition_time(p_edition, v_day, p_payload ->> 'start_time');
  v_ends   := app.edition_time(p_edition, v_day, p_payload ->> 'end_time');

  if v_ends <= v_starts then
    perform app.refuse('end_before_start', 'The end time must be after the start time.');
  end if;

  begin
    insert into sessions (edition_id, company_id, room_id, day, starts_at, ends_at, slot_minutes)
    values (p_edition, v_company, v_room, v_day, v_starts, v_ends, v_len)
    returning * into v_session;
  exception
    when exclusion_violation then
      perform app.refuse('room_busy', 'That room is already in use for part of that time.');
  end;

  v_t := app.next_slot_start(p_edition, v_day, v_starts, v_len);
  while v_t + make_interval(mins => v_len) <= v_ends loop
    insert into slots (edition_id, session_id, company_id, room_id, starts_at, ends_at)
    values (p_edition, v_session.id, v_company, v_room, v_t, v_t + make_interval(mins => v_len));
    v_n := v_n + 1;
    v_last := v_t + make_interval(mins => v_len);
    v_t := app.next_slot_start(p_edition, v_day, v_last, v_len);
  end loop;

  if v_n = 0 then
    perform app.refuse('no_slot_fits',
      format('No %s-minute slot fits between %s and %s outside the prayer breaks.',
             v_len, p_payload ->> 'start_time', p_payload ->> 'end_time'));
  end if;

  -- Shrinking cannot collide with another session, so this never fails.
  update sessions set ends_at = v_last where id = v_session.id and ends_at <> v_last;

  return jsonb_build_object('session_id', v_session.id, 'slots', v_n);
end;
$$;

-- Adds slots after the session's last one. A session with bookings is never
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
  v_last   timestamptz;
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

  begin
    update sessions set ends_at = v_ends where id = p_session;
  exception
    when exclusion_violation then
      perform app.refuse('room_busy', 'That room is already in use for part of that time.');
  end;

  -- Sessions made before 0012 can end past their last slot; start after it.
  v_t := coalesce((select max(sl.ends_at) from slots sl where sl.session_id = s.id), s.starts_at);
  v_t := app.next_slot_start(s.edition_id, s.day, v_t, s.slot_minutes);
  v_last := s.ends_at;
  while v_t + make_interval(mins => s.slot_minutes) <= v_ends loop
    insert into slots (edition_id, session_id, company_id, room_id, starts_at, ends_at)
    values (s.edition_id, s.id, s.company_id, s.room_id, v_t, v_t + make_interval(mins => s.slot_minutes));
    v_n := v_n + 1;
    v_last := v_t + make_interval(mins => s.slot_minutes);
    v_t := app.next_slot_start(s.edition_id, s.day, v_last, s.slot_minutes);
  end loop;

  if v_n = 0 then
    perform app.refuse('no_slot_fits', 'No new slot fits before that time outside the prayer breaks.');
  end if;

  update sessions set ends_at = greatest(v_last, s.ends_at) where id = p_session;

  return jsonb_build_object('session_id', s.id, 'added', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A past time can be booked, in every edition.
-- ---------------------------------------------------------------------------

create or replace function public.book_slot(p_token text, p_slot uuid)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a  applications;
  e  editions;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));

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

  return app.do_move(b, p_slot, 'student');
end;
$$;

-- Nothing calls it any more.
drop function if exists app.refuse_past_slot(editions, uuid);

-- ---------------------------------------------------------------------------
-- 4. Slots already inside a prayer break, closed unless someone holds them.
-- ---------------------------------------------------------------------------

select app.set_actor('{"kind":"system","name":"0012 prayer breaks"}'::jsonb);

update slots sl
   set is_closed = true
  from sessions se
  join editions e on e.id = se.edition_id
 where se.id = sl.session_id
   and e.status <> 'archived'
   and not sl.is_closed
   and not exists (
         select 1 from bookings b where b.slot_id = sl.id and b.cancelled_at is null
       )
   and exists (
         select 1 from app.prayer_breaks(se.edition_id, se.day) pb
          where pb.starts_at < sl.ends_at and pb.ends_at > sl.starts_at
       );
