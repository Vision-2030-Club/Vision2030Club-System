-- =============================================================================
-- 0009 — Assets (spec §8) and attendance (spec §9).
-- =============================================================================

create type asset_status      as enum ('available', 'checked_out', 'maintenance', 'retired');
create type attendance_status as enum ('present', 'absent', 'excused', 'late');

create table assets (
  id           uuid primary key default gen_random_uuid(),
  tag          text unique,
  name_en      text not null,
  name_ar      text not null,
  description  text,
  status       asset_status not null default 'available',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table asset_checkouts (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references assets (id) on delete cascade,
  member_id       uuid not null references members (id),
  checked_out_at  timestamptz not null default now(),
  due_back_on     date,
  returned_at     timestamptz,
  checked_out_by  uuid references members (id),
  checked_in_by   uuid references members (id),
  note            text,

  constraint asset_checkouts_return_after_checkout
    check (returned_at is null or returned_at >= checked_out_at)
);

create index asset_checkouts_asset_idx on asset_checkouts (asset_id, checked_out_at desc);

-- Spec §8: at most one active checkout per asset, enforced at the DATA layer.
-- A partial unique index means two simultaneous checkouts cannot both commit —
-- one of them fails on the index, no matter what the application code does.
create unique index asset_checkouts_one_active
  on asset_checkouts (asset_id)
  where returned_at is null;

create trigger assets_touch_updated_at
  before update on assets
  for each row execute function app.touch_updated_at();

-- Checking in flips the asset back to available automatically (spec §8).
create or replace function app.sync_asset_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update assets set status = 'checked_out' where id = new.asset_id;
  elsif new.returned_at is not null and old.returned_at is null then
    update assets set status = 'available' where id = new.asset_id;
  end if;
  return null;
end;
$$;

create trigger asset_checkouts_sync_status
  after insert or update on asset_checkouts
  for each row execute function app.sync_asset_status();

-- -----------------------------------------------------------------------------
-- Attendance
-- -----------------------------------------------------------------------------

create table attendance_records (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members (id) on delete cascade,
  activity_name  text not null,
  occurred_at    timestamptz not null,
  status         attendance_status not null,
  note           text,
  recorded_by    uuid references members (id),

  -- Placeholder for a future Events module (spec §9). Deliberately a bare
  -- nullable column with NO foreign key, so an Events table can be added later
  -- and back-filled without migrating existing attendance data.
  event_id       uuid,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One record per person per activity.
  unique (member_id, activity_name, occurred_at)
);

create index attendance_records_member_idx on attendance_records (member_id, occurred_at desc);
create index attendance_records_event_idx  on attendance_records (event_id);

create trigger attendance_records_touch_updated_at
  before update on attendance_records
  for each row execute function app.touch_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table assets             enable row level security;
alter table asset_checkouts    enable row level security;
alter table attendance_records enable row level security;

create policy assets_select on assets
  for select using ((select app.can('assets.view')));

create policy assets_write on assets
  for all
  using ((select app.can('assets.manage')))
  with check ((select app.can('assets.manage')));

create policy asset_checkouts_select on asset_checkouts
  for select using (
    (select app.can('assets.view'))
    or member_id = (select app.current_member_id())
  );

create policy asset_checkouts_insert on asset_checkouts
  for insert with check (
    (select app.can('assets.manage'))
    or (member_id = (select app.current_member_id())
        and (select app.can('assets.checkout')))
  );

-- Returning an asset: the holder, or whoever manages assets.
create policy asset_checkouts_update on asset_checkouts
  for update
  using (
    (select app.can('assets.manage'))
    or member_id = (select app.current_member_id())
  )
  with check (
    (select app.can('assets.manage'))
    or member_id = (select app.current_member_id())
  );

-- -----------------------------------------------------------------------------
-- Attendance visibility (spec §9)
--
-- THE RESTRICTION LIVES HERE, and only here: the policy asks app.can() for
-- `attendance.view`. In the seeded configuration only HR's Directors and
-- leadership hold it, so everyone else sees nothing.
--
-- To let members see their own records later, no code changes — set the
-- `member` role's `attendance.view` scope to 'own':
--
--   update role_permissions set scope = 'own'
--   where permission_key = 'attendance.view'
--     and role_id = (select id from roles where key = 'member');
--
-- The `p_owner => member_id` argument below is what makes that one-line
-- change work.
-- -----------------------------------------------------------------------------

create policy attendance_records_select on attendance_records
  for select using ((select app.can('attendance.view', p_owner => member_id)));

create policy attendance_records_write on attendance_records
  for all
  using ((select app.can('attendance.manage', p_owner => member_id)))
  with check ((select app.can('attendance.manage', p_owner => member_id)));

grant select, insert, update, delete on all tables in schema public to authenticated;
