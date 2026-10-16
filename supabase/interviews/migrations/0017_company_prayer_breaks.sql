-- =============================================================================
-- 0017 — Each company chooses its prayer breaks: Asr and Maghrib separately.
--
-- 0012 left every room empty during both prayer breaks, 15:00–15:30 (Asr) and
-- 17:30–18:00 (Maghrib). Some companies have said they would rather keep
-- interviewing through one or both, so the breaks are now per company.
--
--   1. companies.asr_break and companies.maghrib_break, both TRUE by default,
--      so a company nobody touches keeps both breaks exactly as before.
--
--   2. app.prayer_breaks names each break (`key`: 'asr' / 'maghrib'), and
--      app.company_breaks gives only the ones a company keeps. The break
--      TIMES still live in app.prayer_breaks and in PRAYER_BREAKS in
--      src/lib/interviews/slotRules.ts; change both together.
--
--   3. create_session and extend_session skip only the company's own breaks.
--      Their bodies are 0012's, with the changes marked "0017".
--
--   4. set_company_prayer_breaks saves the choice and brings the company's
--      existing sessions in line with it, in one transaction:
--        - a break turned OFF: slots are added inside it, starting at the
--          break, while a 20-minute slot fits before the session's next slot.
--          A 30-minute break is not a whole number of slots, so 15:00 is
--          added before an existing 15:30 and 15:20–15:30 stays empty;
--          re-creating the assignment gives a seamless grid. A slot inside
--          the break that was closed earlier is reopened rather than doubled.
--        - a break turned ON: open slots inside it are CLOSED, not deleted,
--          unless someone holds them. Held ones are left for HR to move and
--          counted in the result (`held`).
--      Archived editions are refused (app.live_edition).
--
-- Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The two choices.
-- ---------------------------------------------------------------------------

alter table companies add column if not exists asr_break boolean not null default true;
alter table companies add column if not exists maghrib_break boolean not null default true;

comment on column companies.asr_break is
  'No slot is made across the Asr break (app.prayer_breaks) while true. 0017.';
comment on column companies.maghrib_break is
  'No slot is made across the Maghrib break (app.prayer_breaks) while true. 0017.';

-- ---------------------------------------------------------------------------
-- 2. The breaks, named, and the ones a company keeps.
-- ---------------------------------------------------------------------------

-- Dropped and recreated: `create or replace` cannot add an output column.
-- Its callers are plpgsql, so nothing holds a hard dependency on it.
drop function if exists app.prayer_breaks(uuid, date);

create function app.prayer_breaks(p_edition uuid, p_day date)
returns table (key text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.key,
         app.edition_time(p_edition, p_day, b.from_time),
         app.edition_time(p_edition, p_day, b.to_time)
    from (values ('asr',     '15:00', '15:30'),
                 ('maghrib', '17:30', '18:00')) as b (key, from_time, to_time)
$$;

create or replace function app.company_breaks(p_company uuid, p_day date)
returns table (key text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pb.key, pb.starts_at, pb.ends_at
    from companies c
    cross join lateral app.prayer_breaks(c.edition_id, p_day) pb
   where c.id = p_company
     and ((pb.key = 'asr' and c.asr_break) or (pb.key = 'maghrib' and c.maghrib_break))
$$;

-- 0012's app.next_slot_start(uuid, date, timestamptz, integer) is kept as it
-- is (every break). This one skips only the company's own.
create or replace function app.next_slot_start(
  p_edition uuid, p_day date, p_t timestamptz, p_len integer, p_company uuid
)
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
    select max(cb.ends_at) into v_end
      from app.company_breaks(p_company, p_day) cb
     where cb.starts_at < v_t + make_interval(mins => p_len)
       and cb.ends_at > v_t;
    exit when v_end is null;
    v_t := v_end;
  end loop;
  return v_t;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Making slots, with the company's own breaks.
-- ---------------------------------------------------------------------------

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

  -- 0017: the company's own breaks, not every break.
  v_t := app.next_slot_start(p_edition, v_day, v_starts, v_len, v_company);
  while v_t + make_interval(mins => v_len) <= v_ends loop
    insert into slots (edition_id, session_id, company_id, room_id, starts_at, ends_at)
    values (p_edition, v_session.id, v_company, v_room, v_t, v_t + make_interval(mins => v_len));
    v_n := v_n + 1;
    v_last := v_t + make_interval(mins => v_len);
    v_t := app.next_slot_start(p_edition, v_day, v_last, v_len, v_company);   -- 0017
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
  -- 0017: the company's own breaks, not every break.
  v_t := coalesce((select max(sl.ends_at) from slots sl where sl.session_id = s.id), s.starts_at);
  v_t := app.next_slot_start(s.edition_id, s.day, v_t, s.slot_minutes, s.company_id);
  v_last := s.ends_at;
  while v_t + make_interval(mins => s.slot_minutes) <= v_ends loop
    insert into slots (edition_id, session_id, company_id, room_id, starts_at, ends_at)
    values (s.edition_id, s.id, s.company_id, s.room_id, v_t, v_t + make_interval(mins => s.slot_minutes));
    v_n := v_n + 1;
    v_last := v_t + make_interval(mins => s.slot_minutes);
    v_t := app.next_slot_start(s.edition_id, s.day, v_last, s.slot_minutes, s.company_id);   -- 0017
  end loop;

  if v_n = 0 then
    perform app.refuse('no_slot_fits', 'No new slot fits before that time outside the prayer breaks.');
  end if;

  update sessions set ends_at = greatest(v_last, s.ends_at) where id = p_session;

  return jsonb_build_object('session_id', s.id, 'added', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Saving a company's choice, and bringing its sessions in line.
-- ---------------------------------------------------------------------------

-- Returns {asr, maghrib, slots_added, slots_closed, held}. NULL for either
-- choice leaves it as it is.
create or replace function public.set_company_prayer_breaks(
  p_edition  uuid,
  p_company  uuid,
  p_asr      boolean,
  p_maghrib  boolean,
  p_actor    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c         companies;
  s         sessions;
  b         record;
  v_keeps   boolean;
  v_len     integer;
  v_t       timestamptz;
  v_skip    timestamptz;
  v_n       integer;
  v_added   integer := 0;
  v_closed  integer := 0;
  v_held    integer := 0;
begin
  perform app.set_actor(p_actor);
  perform app.live_edition(p_edition);

  update companies
     set asr_break     = coalesce(p_asr, asr_break),
         maghrib_break = coalesce(p_maghrib, maghrib_break)
   where id = p_company and edition_id = p_edition
   returning * into c;

  if c.id is null then
    perform app.refuse('not_found', 'No such company.');
  end if;

  for s in select * from sessions where company_id = c.id order by starts_at loop
    v_len := s.slot_minutes;

    for b in
      select pb.key as k, pb.starts_at as b_from, pb.ends_at as b_to
        from app.prayer_breaks(s.edition_id, s.day) pb
       where pb.starts_at < s.ends_at and pb.ends_at > s.starts_at
    loop
      v_keeps := case b.k when 'asr' then c.asr_break else c.maghrib_break end;

      if v_keeps then
        -- ON: close the open, unheld slots inside the break.
        update slots sl
           set is_closed = true
         where sl.session_id = s.id
           and not sl.is_closed
           and sl.starts_at < b.b_to and sl.ends_at > b.b_from
           and not exists (
                 select 1 from bookings bk where bk.slot_id = sl.id and bk.cancelled_at is null
               );
        get diagnostics v_n = row_count;
        v_closed := v_closed + v_n;

        select count(*) into v_n
          from slots sl
         where sl.session_id = s.id
           and sl.starts_at < b.b_to and sl.ends_at > b.b_from
           and exists (
                 select 1 from bookings bk where bk.slot_id = sl.id and bk.cancelled_at is null
               );
        v_held := v_held + v_n;
      else
        -- OFF: reopen what an earlier ON closed, then fill what is empty.
        update slots sl
           set is_closed = false
         where sl.session_id = s.id
           and sl.is_closed
           and sl.starts_at >= b.b_from and sl.starts_at < b.b_to;
        get diagnostics v_n = row_count;
        v_added := v_added + v_n;

        v_t := greatest(b.b_from, s.starts_at);
        while v_t < b.b_to and v_t + make_interval(mins => v_len) <= s.ends_at loop
          -- Something already there (an earlier slot, or the one after the
          -- break): step past it.
          select max(sl.ends_at) into v_skip
            from slots sl
           where sl.session_id = s.id
             and sl.starts_at < v_t + make_interval(mins => v_len)
             and sl.ends_at > v_t;

          if v_skip is not null then
            v_t := v_skip;
            continue;
          end if;

          insert into slots (edition_id, session_id, company_id, room_id, starts_at, ends_at)
          values (s.edition_id, s.id, s.company_id, s.room_id, v_t, v_t + make_interval(mins => v_len));
          v_added := v_added + 1;
          v_t := v_t + make_interval(mins => v_len);
        end loop;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'asr', c.asr_break,
    'maghrib', c.maghrib_break,
    'slots_added', v_added,
    'slots_closed', v_closed,
    'held', v_held
  );
end;
$$;

-- 0004 revoked PUBLIC's default execute grant for future functions and gave
-- it to service_role; repeated here so this file stands on its own.
do $$
begin
  revoke all on function public.set_company_prayer_breaks(uuid, uuid, boolean, boolean, jsonb) from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_company_prayer_breaks(uuid, uuid, boolean, boolean, jsonb) to service_role;
    grant execute on function public.create_session(uuid, jsonb, jsonb) to service_role;
    grant execute on function public.extend_session(uuid, text, jsonb) to service_role;
  end if;
end
$$;

notify pgrst, 'reload schema';
