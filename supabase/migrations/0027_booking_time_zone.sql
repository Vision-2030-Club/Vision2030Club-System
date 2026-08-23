-- =============================================================================
-- 0027 — Room bookings run on the CLUB's clock, not the server's.
--
-- Found by `npm run db:rooms`: the database runs in UTC, the club is in
-- Asia/Riyadh, and 0026's trigger read the hour straight off the timestamp. So
-- a booking at 13:00 Riyadh arrived as 10:00 UTC and was refused for being
-- "before opening hours" — which would have rejected every real afternoon
-- booking in the club.
--
-- This is the timezone assumption HANDOFF.md has been carrying since the
-- calendar was built. It is harmless while dates are only being *displayed*.
-- It stops being harmless the moment a rule depends on what hour it is, which
-- is exactly what operating hours are.
--
-- The fix is to make the club's clock a setting rather than an accident of
-- where the database happens to run, and to say which clock we mean every time
-- we ask for an hour.
-- =============================================================================

alter table booking_settings
  add column if not exists time_zone text not null default 'Asia/Riyadh';

comment on column booking_settings.time_zone is
  'The clock the club books rooms on. Every hour comparison in
   app.validate_room_booking() is made in this zone, so the rules do not change
   if the database is moved or its own timezone setting is changed.';

-- A typo here would silently push every booking onto the wrong clock, so the
-- name has to be one Postgres actually recognises. This is a trigger rather
-- than a CHECK because checking it means reading `pg_timezone_names`, and a
-- CHECK constraint is not allowed to run a subquery.
create or replace function app.validate_booking_time_zone()
returns trigger
language plpgsql
as $$
begin
  -- Raises "time zone \"...\" not recognized" all by itself if the name is
  -- not real, which is a better message than anything we would write.
  perform now() at time zone new.time_zone;
  return new;
end;
$$;

drop trigger if exists booking_settings_validate_time_zone on booking_settings;

create trigger booking_settings_validate_time_zone
  before insert or update of time_zone on booking_settings
  for each row execute function app.validate_booking_time_zone();

create or replace function app.validate_room_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s            booking_settings%rowtype;
  v_start      timestamp;   -- wall-clock time in the club's zone
  v_end        timestamp;
  v_today      date;
  v_start_min  integer;
  v_end_min    integer;
begin
  select * into s from booking_settings where id;

  -- `at time zone` converts the stored instant into the wall-clock reading
  -- someone in Riyadh would see. Everything below is that reading, so the
  -- numbers mean the same thing as the ones on the booking screen.
  v_start := new.starts_at at time zone s.time_zone;
  v_end   := new.ends_at   at time zone s.time_zone;
  v_today := (now() at time zone s.time_zone)::date;

  v_start_min := extract(hour from v_start)::int * 60 + extract(minute from v_start)::int;
  v_end_min   := extract(hour from v_end)::int   * 60 + extract(minute from v_end)::int;

  -- A booking ending exactly at midnight reads as minute 0 of the NEXT day,
  -- which would otherwise look like it ends before it starts.
  if v_end_min = 0 then
    v_end_min := 1440;
  end if;

  if v_start::date <> (v_end - interval '1 minute')::date then
    raise exception 'A booking cannot run past midnight into the next day'
      using errcode = '22007';
  end if;

  if v_start_min < s.opens_minute or v_end_min > s.closes_minute then
    raise exception 'Rooms can only be booked between % and % (%)',
      app.minute_label(s.opens_minute),
      app.minute_label(s.closes_minute),
      s.time_zone
      using errcode = '22007';
  end if;

  -- IT blocks are maintenance and may be placed at any date; only the
  -- self-service window is capped.
  if new.status <> 'blocked' and v_start::date > (v_today + s.days_ahead) then
    raise exception 'Rooms can only be booked up to % days ahead', s.days_ahead
      using errcode = '22007';
  end if;

  return new;
end;
$$;
