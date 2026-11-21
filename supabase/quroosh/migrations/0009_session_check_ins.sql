-- =============================================================================
-- Quroosh database — 0009: checking in to the day's dialogue session.
--
-- The organizers show one QR code at the session (permanent, one per
-- project: /quroosh/checkin/<project id>). A signed-in guest (an account of
-- 0006) opens it, rates the session from one to five stars and checks in.
-- That is once per guest per day, on the club's calendar (Riyadh), and it
-- pays the guest's wallet (0007): 1,000 quroosh until a manager changes it.
--
--   session_check_ins   one row per account per day, with the rating
--   wallet_settings     gains session_points (what a check-in pays), which
--                       the managers change on the Wallet page
--   wallet_entries      gains the kind 'session'
--
-- The unique constraint on (account_id, day) is the claim: two presses, or
-- two tabs, race on it and the second is refused with `already_checked_in`.
-- The check-in and its wallet entry are written in one transaction.
--
-- As everywhere in this database: Row Level Security on and NO policies,
-- every function executable by service_role only, and this database never
-- checks identity (the app hands it the account of the session cookie).
-- Needs 0006, 0007 and 0008 (app.quroosh_today). Safe to re-run.
-- =============================================================================

-- The event's day on the club's clock (as in 0008; restated so this file
-- stands on its own when pasted into the SQL editor).
create or replace function app.quroosh_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;

-- A new kind on the ledger. The constraint is rebuilt with every kind 0007
-- named plus 'session'; no row changes.
alter table wallet_entries drop constraint if exists wallet_entries_kind_check;
alter table wallet_entries add constraint wallet_entries_kind_check
  check (kind in ('attendance', 'challenge', 'vote', 'adjustment', 'session'));

alter table wallet_settings
  add column if not exists session_points integer not null default 1000;
alter table wallet_settings drop constraint if exists wallet_settings_session_range;
alter table wallet_settings add constraint wallet_settings_session_range
  check (session_points between 0 and 1000000);

create table if not exists session_check_ins (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,                       -- the club database's projects.id
  account_id  uuid not null references accounts (id),
  -- The day on the club's calendar. A new day begins at 00:00 Riyadh.
  day         date not null default app.quroosh_today(),
  rating      smallint not null constraint session_check_ins_rating_range check (rating between 1 and 5),
  created_at  timestamptz not null default now(),
  constraint session_check_ins_once unique (account_id, day)
);

comment on table session_check_ins is
  'Dialogue session check-ins (0009): one per guest account per day, with a 1-5 star rating. Never deleted.';

create index if not exists session_check_ins_project_idx on session_check_ins (project_id, day);

alter table session_check_ins enable row level security;

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

create or replace function public.session_points(p_project uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.session_points from wallet_settings s where s.project_id = p_project), 1000);
$$;

-- Changes what a session check-in pays from now on (the managers' Wallet
-- page). Check-ins already paid keep the amount they were paid. 0 stops
-- paying; checking in still works.
create or replace function public.wallet_save_session_points(p_project uuid, p_session_points integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_session_points is null or p_session_points < 0 or p_session_points > 1000000 then
    perform app.refuse('points_invalid', 'The quroosh for a session check-in must be between 0 and 1,000,000.');
  end if;
  insert into wallet_settings (project_id, session_points)
  values (p_project, p_session_points)
  on conflict (project_id) do update
     set session_points = excluded.session_points, updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- The guest
-- -----------------------------------------------------------------------------

-- Today's check-in of an account, if it has one, with what it was paid.
-- No row: not checked in today.
create or replace function public.session_today(p_account uuid)
returns table (day date, rating smallint, points integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.day, c.rating, coalesce(e.amount, 0), c.created_at
    from session_check_ins c
    left join wallet_entries e
      on e.account_id = c.account_id and e.kind = 'session'
     and e.source_ref = c.id::text and e.voided_at is null
   where c.account_id = p_account and c.day = app.quroosh_today();
$$;

-- Checks an account in to today's session with its rating, and pays its
-- wallet the project's session_points (nothing when they are 0).
--
-- Refuses:
--   not_found           no such account, or it belongs to another project
--   account_disabled    the account was disabled (its pass was cancelled)
--   rating_invalid      the rating is not 1 to 5
--   already_checked_in  this account has checked in today already
create or replace function public.session_check_in(p_account uuid, p_project uuid, p_rating integer)
returns table (day date, points integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account  accounts;
  v_id       uuid;
  v_day      date := app.quroosh_today();
  v_points   integer := public.session_points(p_project);
begin
  select a.* into v_account from accounts a where a.id = p_account;
  if v_account.id is null or v_account.project_id <> p_project then
    perform app.refuse('not_found', 'This account is not known here.');
  end if;
  if v_account.disabled_at is not null then
    perform app.refuse('account_disabled', 'This account is not active.');
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    perform app.refuse('rating_invalid', 'The rating must be from 1 to 5 stars.');
  end if;

  insert into session_check_ins (project_id, account_id, day, rating)
  values (p_project, p_account, v_day, p_rating)
  on conflict on constraint session_check_ins_once do nothing
  returning id into v_id;

  if v_id is null then
    perform app.refuse('already_checked_in', 'This account has checked in to today''s session already.');
  end if;

  if v_points > 0 then
    insert into wallet_entries (project_id, account_id, kind, amount, day, source_ref)
    values (p_project, p_account, 'session', v_points, v_day, v_id::text)
    on conflict do nothing;
  end if;

  return query select v_day, v_points;
end;
$$;

-- -----------------------------------------------------------------------------
-- Managers and the HR team: counts and averages, no names.
-- -----------------------------------------------------------------------------

create or replace function public.session_summary(p_project uuid)
returns table (day date, check_ins bigint, average_rating numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.day, count(*), round(avg(c.rating), 2)
    from session_check_ins c
   where c.project_id = p_project
   group by c.day
   order by c.day desc;
$$;

-- -----------------------------------------------------------------------------
-- Server only: nobody but the secret key runs these.
-- -----------------------------------------------------------------------------

revoke execute on function public.session_points(uuid) from public, anon, authenticated;
revoke execute on function public.wallet_save_session_points(uuid, integer) from public, anon, authenticated;
revoke execute on function public.session_today(uuid) from public, anon, authenticated;
revoke execute on function public.session_check_in(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.session_summary(uuid) from public, anon, authenticated;

grant execute on function public.session_points(uuid) to service_role;
grant execute on function public.wallet_save_session_points(uuid, integer) to service_role;
grant execute on function public.session_today(uuid) to service_role;
grant execute on function public.session_check_in(uuid, uuid, integer) to service_role;
grant execute on function public.session_summary(uuid) to service_role;

notify pgrst, 'reload schema';
