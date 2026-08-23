-- =============================================================================
-- 0026 — Rooms, the global booking window, and bookings.
--
-- Step 1 of the Meetings build. This file is only about ROOMS: who owns them,
-- when they can be booked, and the guarantee that two people can never end up
-- holding the same room at the same time. Meetings come later, and will simply
-- write rows into `room_bookings` like everybody else.
--
-- The one idea to take away: a HOLD (a meeting still being negotiated), a real
-- BOOKING, and an IT maintenance BLOCK are all the same thing as far as a room
-- is concerned — the slot is taken. Keeping all three in one table is what lets
-- a single constraint cover every one of them, instead of three separate rules
-- that then have to be kept in agreement by hand.
-- =============================================================================

-- Lets one GiST index mix a plain equality column (room_id) with a range
-- overlap test. Without it the exclusion constraint below cannot be created.
create extension if not exists btree_gist;

create type booking_status as enum (
  'held',     -- a meeting request is being negotiated for this slot
  'booked',   -- confirmed
  'blocked'   -- IT has taken the room out of service for this stretch
);

-- Who a booking is for. 'block' is IT's own reservation and is the only kind
-- with no team or project attached — `title` carries their stated reason.
create type booking_party_kind as enum ('team', 'project', 'presidency', 'block');

-- -----------------------------------------------------------------------------
-- Rooms
-- -----------------------------------------------------------------------------

create table rooms (
  id          uuid primary key default gen_random_uuid(),
  name_en     text not null,
  name_ar     text not null,
  -- Retired, never deleted: §4 requires past bookings to stay on record. There
  -- is deliberately no delete policy for this table further down.
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger rooms_touch_updated_at
  before update on rooms
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- The booking window — ONE row, for every room (§4: not configurable per room)
--
-- `id` is a boolean pinned to true by a CHECK, which is the simplest way to
-- make "there can only ever be one row here" a rule the database enforces
-- rather than something we have to remember.
--
-- Times are minutes from midnight rather than `time` values, because closing
-- time is midnight: as a `time` that wraps to 00:00 and reads as "closes
-- before it opens". As minutes the default is plainly 720 -> 1440, and closing
-- is simply the larger number.
-- -----------------------------------------------------------------------------

create table booking_settings (
  id             boolean primary key default true check (id),
  opens_minute   integer not null default 720  check (opens_minute >= 0 and opens_minute < 1440),
  closes_minute  integer not null default 1440 check (closes_minute > 0 and closes_minute <= 1440),
  days_ahead     integer not null default 14   check (days_ahead >= 1 and days_ahead <= 365),
  updated_at     timestamptz not null default now(),

  constraint booking_settings_window check (closes_minute > opens_minute),

  -- Half-hour blocks (§4), so the window has to land on the same grid.
  constraint booking_settings_half_hour check (
    mod(opens_minute, 30) = 0 and mod(closes_minute, 30) = 0
  )
);

insert into booking_settings (id) values (true) on conflict (id) do nothing;

create trigger booking_settings_touch_updated_at
  before update on booking_settings
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Bookings
-- -----------------------------------------------------------------------------

create table room_bookings (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms (id),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      booking_status not null default 'booked',

  -- Who it is for.
  party_kind  booking_party_kind not null,
  team_id     uuid references teams (id),
  project_id  uuid references projects (id),

  -- The second party, set ONLY by a confirmed meeting. §4 is explicit that an
  -- ordinary self-service booking is never a combined one, and leaving these
  -- null is how that stays true rather than being a rule someone must recall.
  other_kind        booking_party_kind,
  other_team_id     uuid references teams (id),
  other_project_id  uuid references projects (id),
  other_member_id   uuid references members (id),

  -- Shown to everyone who can see the schedule (§4), not only to IT.
  booked_by   uuid not null references members (id),
  title       text not null,

  created_at  timestamptz not null default now(),

  constraint room_bookings_ends_after_start check (ends_at > starts_at),

  -- The party columns must agree with the party kind.
  constraint room_bookings_party_shape check (
    (party_kind = 'team' and team_id is not null and project_id is null)
    or (party_kind = 'project' and project_id is not null and team_id is null)
    or (party_kind = 'presidency' and team_id is null and project_id is null)
    or (party_kind = 'block' and team_id is null and project_id is null)
  ),

  -- Same again for the optional second party.
  constraint room_bookings_other_shape check (
    other_kind is null
    or (other_kind = 'team' and other_team_id is not null
        and other_project_id is null and other_member_id is null)
    or (other_kind = 'project' and other_project_id is not null
        and other_team_id is null and other_member_id is null)
    or (other_kind = 'presidency' and other_team_id is null
        and other_project_id is null and other_member_id is null)
  ),

  -- The half-hour grid (§4). `extract(epoch ...)` is seconds since 1970, so a
  -- time landing exactly on :00 or :30 divides evenly by 1800.
  constraint room_bookings_half_hour check (
    mod(extract(epoch from starts_at)::bigint, 1800) = 0
    and mod(extract(epoch from ends_at)::bigint, 1800) = 0
  )
);

-- =============================================================================
-- THE GUARANTEE — §4: "cannot be double-booked, under any circumstances"
--
-- An exclusion constraint is a unique index that understands "overlaps"
-- instead of only "equals". Read the three lines as: no two rows may share a
-- room AND have overlapping times.
--
-- Because it is an index, it holds however many people tap the same slot at
-- the same instant — the second writer gets an error rather than a second row.
-- Same reasoning as `asset_checkouts_one_active` in 0009: let the database
-- refuse the loser; never look first and hope.
--
-- '[)' makes each range half-open, so a booking ending at 14:00 and one
-- starting at 14:00 do NOT overlap. Without it, back-to-back slots would be
-- impossible to book.
--
-- Holds, bookings and IT blocks all live in this table, so this one constraint
-- covers every combination of them.
-- =============================================================================

alter table room_bookings add constraint room_bookings_no_overlap
  exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  );

create index room_bookings_room_day_idx on room_bookings (room_id, starts_at);
create index room_bookings_booked_by_idx on room_bookings (booked_by);

-- -----------------------------------------------------------------------------
-- The rules a CHECK cannot express
--
-- Operating hours and the booking window live in another table, and a CHECK
-- constraint is not allowed to read one. So they go in a BEFORE trigger, which
-- runs on every insert and update no matter which screen made it.
-- -----------------------------------------------------------------------------

-- "720" is not a time anybody recognises, so error messages say "12:00".
create or replace function app.minute_label(p_minute integer)
returns text
language sql
immutable
as $$
  select lpad((p_minute / 60)::text, 2, '0') || ':' || lpad((p_minute % 60)::text, 2, '0')
$$;

create or replace function app.validate_room_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s            booking_settings%rowtype;
  v_start_min  integer;
  v_end_min    integer;
begin
  select * into s from booking_settings where id;

  -- Minutes from midnight, on the server's clock — the same clock the booking
  -- screen shows. (See the timezone note in HANDOFF.md.)
  v_start_min := extract(hour from new.starts_at)::int * 60
               + extract(minute from new.starts_at)::int;
  v_end_min   := extract(hour from new.ends_at)::int * 60
               + extract(minute from new.ends_at)::int;

  -- A booking ending exactly at midnight reads as minute 0 of the NEXT day,
  -- which would otherwise look like it ends before it starts.
  if v_end_min = 0 then
    v_end_min := 1440;
  end if;

  if new.starts_at::date <> (new.ends_at - interval '1 minute')::date then
    raise exception 'A booking cannot run past midnight into the next day'
      using errcode = '22007';
  end if;

  if v_start_min < s.opens_minute or v_end_min > s.closes_minute then
    raise exception 'Rooms can only be booked between % and %',
      app.minute_label(s.opens_minute),
      app.minute_label(s.closes_minute)
      using errcode = '22007';
  end if;

  -- IT blocks are maintenance and may be placed at any date; only the
  -- self-service window is capped.
  if new.status <> 'blocked'
     and new.starts_at::date > (current_date + s.days_ahead) then
    raise exception 'Rooms can only be booked up to % days ahead', s.days_ahead
      using errcode = '22007';
  end if;

  return new;
end;
$$;

create trigger room_bookings_validate
  before insert or update on room_bookings
  for each row execute function app.validate_room_booking();

-- -----------------------------------------------------------------------------
-- Permissions (§4)
--
-- Two new permissions, and no new concept: "may book as X" is just
-- app.can('rooms.book', ...) run through the scope machinery already in 0002 —
--
--   Team Director    scope own_team      -> p_team must be their own team
--   Project Manager  scope own_projects  -> must actually manage that project
--   President / VP   scope all           -> may book as Presidency
--   Member / Guest   scope none          -> cannot book, cannot see the schedule
--
-- That is exactly §4's rule ("only as a team you actually direct...") with no
-- role name appearing anywhere in a policy or in the app.
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('rooms.book',
   'Book a room and see the room schedule',
   'حجز القاعات والاطلاع على جدولها'),
  ('rooms.manage',
   'Add and retire rooms, block off time, and remove any booking',
   'إضافة القاعات وإيقافها وحجب الأوقات وحذف أي حجز')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

-- Deny for every role first, then grant. Anything forgotten stays denied.
insert into role_permissions (role_id, permission_key, scope)
select r.id, p.key, 'none'::permission_scope
from roles r
cross join (values ('rooms.book'), ('rooms.manage')) as p (key)
on conflict (role_id, permission_key) do nothing;

update role_permissions rp
set scope = grants.scope::permission_scope
from (values
  ('super_admin',     'rooms.book',   'all'),
  ('super_admin',     'rooms.manage', 'all'),
  ('president',       'rooms.book',   'all'),
  ('vice_president',  'rooms.book',   'all'),
  ('team_director',   'rooms.book',   'own_team'),
  ('project_manager', 'rooms.book',   'own_projects')
  -- Members and Guests stay 'none' (§4: plain Members cannot book at all).
) as grants (role_key, permission_key, scope)
where rp.role_id = (select id from roles where key = grants.role_key)
  and rp.permission_key = grants.permission_key;

-- §4: rooms are IT's to set up. An override, exactly like HR's member powers —
-- so moving room admin to another team later is one row, not a code change.
insert into role_permission_team_overrides (role_id, permission_key, team_id, scope)
select
  (select id from roles where key = 'team_director'),
  'rooms.manage',
  (select id from teams where key = 'IT'),
  'all'::permission_scope
on conflict (role_id, permission_key, team_id) do update
  set scope = excluded.scope;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table rooms            enable row level security;
alter table booking_settings enable row level security;
alter table room_bookings    enable row level security;

-- §6: the schedule is Club Management's. Holding rooms.book at ANY scope is
-- what "may see the schedule" means — the same population that may book.
-- `effective_scope` rather than `app.can` because this asks "do you have this
-- permission at all", not "may you use it on this particular row".
create policy rooms_select on rooms
  for select using ((select app.effective_scope('rooms.book')) <> 'none');

create policy rooms_write on rooms
  for all
  using ((select app.can('rooms.manage')))
  with check ((select app.can('rooms.manage')));

create policy booking_settings_select on booking_settings
  for select using ((select app.effective_scope('rooms.book')) <> 'none');

create policy booking_settings_update on booking_settings
  for update
  using ((select app.can('rooms.manage')))
  with check ((select app.can('rooms.manage')));

-- §4: everyone who can see the schedule sees the full detail — who booked it,
-- which group it is for, and the title. There is no IT-only layer on top; IT's
-- extra power is deleting and blocking, which is the two policies below.
create policy room_bookings_select on room_bookings
  for select using ((select app.effective_scope('rooms.book')) <> 'none');

create policy room_bookings_insert on room_bookings
  for insert with check (
    booked_by = (select app.current_member_id())
    and (
      -- IT blocking time out for maintenance.
      (party_kind = 'block' and (select app.can('rooms.manage')))
      -- Or booking as a group you genuinely belong to.
      or (
        party_kind <> 'block'
        and (select app.can('rooms.book', p_team => team_id, p_project => project_id))
      )
    )
  );

-- §4: cancel your own at any time, no approval. IT can remove anyone's.
create policy room_bookings_delete on room_bookings
  for delete using (
    booked_by = (select app.current_member_id())
    or (select app.can('rooms.manage'))
  );

-- Only IT edits a booking in place. Everyone else cancels and rebooks, which
-- keeps "who booked this" honest.
create policy room_bookings_update on room_bookings
  for update
  using ((select app.can('rooms.manage')))
  with check ((select app.can('rooms.manage')));

grant select, insert, update, delete on all tables in schema public to authenticated;

-- The blanket grant above re-grants DELETE on task_scores, which 0015 exists to
-- take away. Every file repeating that line has to repeat this one.
revoke delete on task_scores from authenticated;

-- Rooms are retired, never deleted (§4), and there is deliberately no DELETE
-- policy for `rooms` above. Taking the privilege away too means an attempt
-- fails outright instead of silently matching no rows.
revoke delete on rooms from authenticated;
revoke delete, insert on booking_settings from authenticated;
