-- =============================================================================
-- Quroosh database — 0007: the wallet, the first part of the Quroosh market.
--
-- A guest (an account of 0006) collects quroosh during the event. This
-- migration is the ledger everything else in the market will write to, and
-- the first way to earn: being checked in at the gate, once a day.
--
--   wallet_settings   one row per project: how many quroosh a day's
--                     attendance is worth (5,000 until a manager says
--                     otherwise)
--   wallet_entries    the ledger: one row per thing that moved quroosh
--   wallet_sync       how far each project has read the check-ins
--
-- Two numbers come out of the ledger, and they are different on purpose
-- (the Quroosh design: "التصويت ما ينقص ترتيب الحاضر"):
--   balance   everything standing, plus and minus: what the guest can spend
--   earned    the plus entries only: what the guest is ranked by, so that
--             voting later never costs anyone their place
--
-- An entry is never deleted or edited. A check-in the gate undid has its
-- entry voided (`voided_at`), and a voided entry counts for nothing.
--
-- The kinds 'challenge', 'vote' and 'adjustment' are named here so the
-- ledger does not change shape when those parts are built; nothing writes
-- them yet.
--
-- As everywhere in this database: Row Level Security on and NO policies,
-- every function executable by service_role only, and this database never
-- checks identity. Safe to re-run.
-- =============================================================================

create table if not exists wallet_settings (
  project_id         uuid primary key,          -- the club database's projects.id
  attendance_points  integer not null default 5000
                       constraint wallet_settings_attendance_range check (attendance_points between 0 and 1000000),
  updated_at         timestamptz not null default now()
);

create table if not exists wallet_entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  account_id  uuid not null references accounts (id),
  kind        text not null check (kind in ('attendance', 'challenge', 'vote', 'adjustment')),
  -- Plus: earned. Minus: spent. Never zero.
  amount      integer not null constraint wallet_entries_amount_not_zero check (amount <> 0),
  -- The event day it belongs to, on the club's calendar, when it has one.
  day         date,
  -- What it came from, so the same thing is never paid twice. For
  -- attendance: the club database's event_check_ins.id.
  source_ref  text,
  created_at  timestamptz not null default now(),
  voided_at   timestamptz
);

comment on table wallet_entries is
  'The quroosh ledger (0007): one row per thing that moved quroosh for a guest. Never deleted or edited; an entry taken back is voided.';

-- The same source pays once.
create unique index if not exists wallet_entries_source_once
  on wallet_entries (account_id, kind, source_ref) where source_ref is not null;
-- One day's attendance pays once, whatever the gate did and undid.
create unique index if not exists wallet_entries_attendance_once
  on wallet_entries (account_id, day) where kind = 'attendance' and voided_at is null;
create index if not exists wallet_entries_account_idx on wallet_entries (account_id, created_at desc);
create index if not exists wallet_entries_project_idx on wallet_entries (project_id, created_at desc);

create table if not exists wallet_sync (
  project_id        uuid primary key,
  check_ins_cursor  timestamptz,
  synced_at         timestamptz not null default now()
);

alter table wallet_settings enable row level security;
alter table wallet_entries  enable row level security;
alter table wallet_sync     enable row level security;

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

create or replace function public.wallet_attendance_points(p_project uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.attendance_points from wallet_settings s where s.project_id = p_project), 5000);
$$;

-- Changes what a day's attendance is worth from now on. Entries already
-- written keep the amount they were written with.
create or replace function public.wallet_save_settings(p_project uuid, p_attendance_points integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_attendance_points is null or p_attendance_points < 0 or p_attendance_points > 1000000 then
    perform app.refuse('points_invalid', 'The quroosh for a day must be between 0 and 1,000,000.');
  end if;
  insert into wallet_settings (project_id, attendance_points)
  values (p_project, p_attendance_points)
  on conflict (project_id) do update
     set attendance_points = excluded.attendance_points, updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- Earning from attendance
-- -----------------------------------------------------------------------------

create or replace function public.wallet_sync_state(p_project uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.check_ins_cursor from wallet_sync s where s.project_id = p_project;
$$;

-- One pass over check-ins read from Event attendance, in one transaction.
--
--   p_check_ins  a JSON array of { id, attendee_id, day, undone }
--
-- A check-in the gate undid has its entry voided. A standing one pays its
-- attendee's account the day's quroosh, once: by check-in and by day. A
-- check-in of somebody with no account (no email on their pass) pays nobody.
-- The undone ones are handled first, so a check-in undone and made again on
-- the same day ends with one standing entry.
--
-- Running it twice with the same rows changes nothing the second time.
-- p_cursor null leaves the cursor where it is (a recount from the start).
-- Returns how many entries were written.
create or replace function public.sync_wallet(p_project uuid, p_check_ins jsonb, p_cursor timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      jsonb;
  v_account  uuid;
  v_points   integer := public.wallet_attendance_points(p_project);
  v_count    integer;
  v_written  integer := 0;
begin
  update wallet_entries e
     set voided_at = now()
   where e.project_id = p_project
     and e.kind = 'attendance'
     and e.voided_at is null
     and e.source_ref in (
       select x->>'id' from jsonb_array_elements(coalesce(p_check_ins, '[]'::jsonb)) x
        where coalesce((x->>'undone')::boolean, false)
     );

  if v_points > 0 then
    for v_row in
      select x from jsonb_array_elements(coalesce(p_check_ins, '[]'::jsonb)) x
       where not coalesce((x->>'undone')::boolean, false)
    loop
      begin
        select a.id into v_account from accounts a
         where a.project_id = p_project and a.attendee_id = (v_row->>'attendee_id')::uuid;
        continue when v_account is null;
        insert into wallet_entries (project_id, account_id, kind, amount, day, source_ref)
        values (p_project, v_account, 'attendance', v_points, (v_row->>'day')::date, v_row->>'id')
        on conflict do nothing;
        get diagnostics v_count = row_count;
        v_written := v_written + v_count;
      exception
        -- One row that does not fit must not stop the others.
        when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
          or not_null_violation or check_violation then
          null;
      end;
    end loop;
  end if;

  insert into wallet_sync (project_id, check_ins_cursor)
  values (p_project, p_cursor)
  on conflict (project_id) do update
     set check_ins_cursor = coalesce(greatest(wallet_sync.check_ins_cursor, excluded.check_ins_cursor),
                                     wallet_sync.check_ins_cursor, excluded.check_ins_cursor),
         synced_at = now();

  return v_written;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reading: the guest
-- -----------------------------------------------------------------------------

-- A guest's own numbers. `position` is their place among the project's
-- active accounts by what they earned (1 = most); `players` is how many
-- active accounts there are.
create or replace function public.wallet_overview(p_account uuid)
returns table (balance bigint, earned bigint, "position" bigint, players bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select a.id, a.project_id from accounts a where a.id = p_account
  ),
  totals as (
    select a.id,
           coalesce(sum(e.amount) filter (where e.amount > 0), 0) as earned,
           coalesce(sum(e.amount), 0) as balance
      from accounts a
      join me on me.project_id = a.project_id
      left join wallet_entries e on e.account_id = a.id and e.voided_at is null
     where a.disabled_at is null or a.id = p_account
     group by a.id
  )
  select mine.balance::bigint,
         mine.earned::bigint,
         (select count(*) from totals t where t.earned > mine.earned) + 1,
         (select count(*) from totals)
    from totals mine
   where mine.id = p_account;
$$;

-- A guest's own ledger, newest first. Voided entries are left out.
create or replace function public.wallet_entries_of(p_account uuid, p_limit integer default 50)
returns table (id uuid, kind text, amount integer, day date, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.kind, e.amount, e.day, e.created_at
    from wallet_entries e
   where e.account_id = p_account and e.voided_at is null
   order by e.created_at desc
   limit least(greatest(p_limit, 1), 500);
$$;

-- The top of a project's table: active accounts that earned something, most
-- first. Equal amounts share a place. Names are personal data: the app
-- shortens them before anyone but a manager sees them.
create or replace function public.wallet_leaderboard(p_project uuid, p_limit integer default 20)
returns table ("position" bigint, account_id uuid, name text, earned bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with totals as (
    select a.id, a.name, sum(e.amount)::bigint as earned
      from accounts a
      join wallet_entries e on e.account_id = a.id and e.voided_at is null and e.amount > 0
     where a.project_id = p_project and a.disabled_at is null
     group by a.id, a.name
  )
  select rank() over (order by t.earned desc), t.id, t.name, t.earned
    from totals t
   order by t.earned desc, t.name
   limit least(greatest(p_limit, 1), 200);
$$;

-- -----------------------------------------------------------------------------
-- Reading: managers
-- -----------------------------------------------------------------------------

create or replace function public.wallet_totals(p_project uuid)
returns table (distributed bigint, spent bigint, holders bigint, entries bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(e.amount) filter (where e.amount > 0), 0)::bigint,
         coalesce(-sum(e.amount) filter (where e.amount < 0), 0)::bigint,
         count(distinct e.account_id) filter (where e.amount > 0),
         count(*)
    from wallet_entries e
   where e.project_id = p_project and e.voided_at is null;
$$;

-- The project's ledger, newest first, voided entries included and marked.
create or replace function public.wallet_ledger(p_project uuid, p_limit integer default 200)
returns table (
  id          uuid,
  account_id  uuid,
  name        text,
  kind        text,
  amount      integer,
  day         date,
  created_at  timestamptz,
  voided_at   timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.account_id, a.name, e.kind, e.amount, e.day, e.created_at, e.voided_at
    from wallet_entries e
    join accounts a on a.id = e.account_id
   where e.project_id = p_project
   order by e.created_at desc
   limit least(greatest(p_limit, 1), 1000);
$$;

-- -----------------------------------------------------------------------------
-- Server only: nobody but the secret key runs these.
-- -----------------------------------------------------------------------------

revoke execute on function public.wallet_attendance_points(uuid) from public, anon, authenticated;
revoke execute on function public.wallet_save_settings(uuid, integer) from public, anon, authenticated;
revoke execute on function public.wallet_sync_state(uuid) from public, anon, authenticated;
revoke execute on function public.sync_wallet(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.wallet_overview(uuid) from public, anon, authenticated;
revoke execute on function public.wallet_entries_of(uuid, integer) from public, anon, authenticated;
revoke execute on function public.wallet_leaderboard(uuid, integer) from public, anon, authenticated;
revoke execute on function public.wallet_totals(uuid) from public, anon, authenticated;
revoke execute on function public.wallet_ledger(uuid, integer) from public, anon, authenticated;

grant execute on function public.wallet_attendance_points(uuid) to service_role;
grant execute on function public.wallet_save_settings(uuid, integer) to service_role;
grant execute on function public.wallet_sync_state(uuid) to service_role;
grant execute on function public.sync_wallet(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.wallet_overview(uuid) to service_role;
grant execute on function public.wallet_entries_of(uuid, integer) to service_role;
grant execute on function public.wallet_leaderboard(uuid, integer) to service_role;
grant execute on function public.wallet_totals(uuid) to service_role;
grant execute on function public.wallet_ledger(uuid, integer) to service_role;

notify pgrst, 'reload schema';
