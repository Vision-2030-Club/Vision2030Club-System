-- =============================================================================
-- Quroosh database — 0014: the Final Wave (الحفل الختامي).
--
-- The last part of the Quroosh market. The managers list the projects that
-- pitch at the closing ceremony (a name and a short brief each). Guests open
-- the Final Wave tab of their wallet, read the projects and give them
-- quroosh from their balance, in steps of 250. The projects that collected
-- the most are the ceremony's leaderboard.
--
--   final_settings  one row per project: whether guests see the Final Wave
--                   ('hidden', the default), may give ('open'), or see the
--                   results only ('closed')
--   final_projects  the projects on stage. Never deleted, only hidden.
--   final_gifts     one row per gift: who gave, to which project, how much
--
-- A gift is paid out of the guest's wallet (0007) in the same transaction:
-- one 'vote' entry on the ledger, minus the amount, with the gift's id as
-- its source_ref. So giving lowers the guest's BALANCE and never what they
-- EARNED, and their place on the guests' leaderboard does not move (the
-- Quroosh design: "التصويت ما ينقص ترتيب الحاضر").
--
-- A guest's FIRST gift is at most 75% of their balance at that moment,
-- rounded down to a step of 250 (the club's decision, 2026-11-25), so nobody
-- spends everything on the first project they see. After that, any gift up
-- to the whole balance.
--
-- The balance check is made after locking the account's row (`for update`),
-- the same lock sync_wallet (0010) takes, so two gifts sent at once from two
-- tabs cannot both spend the same quroosh, and cannot both count as the
-- first gift.
--
-- As everywhere in this database: Row Level Security on and NO policies,
-- every function executable by service_role only, and this database never
-- checks identity (the app hands it the account of the session cookie, or
-- asks the club database whether a person manages the project first).
-- Needs 0006 and 0007. Safe to re-run.
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

create table if not exists final_settings (
  project_id  uuid primary key,                       -- the club database's projects.id
  status      text not null default 'hidden'
                constraint final_settings_status_check check (status in ('hidden', 'open', 'closed')),
  updated_at  timestamptz not null default now()
);

create table if not exists final_projects (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,                          -- the club database's projects.id
  name        text not null constraint final_projects_name_length check (char_length(btrim(name)) between 1 and 120),
  brief       text constraint final_projects_brief_length check (brief is null or char_length(brief) <= 1000),
  position    integer not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table final_projects is
  'The Final Wave (0014): the projects guests give quroosh to at the closing ceremony. Never deleted; hidden instead.';

create index if not exists final_projects_project_idx on final_projects (project_id, position);

create table if not exists final_gifts (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,                    -- the club database's projects.id
  account_id        uuid not null references accounts (id),
  final_project_id  uuid not null references final_projects (id),
  -- Steps of 250, never nothing.
  amount            integer not null
                      constraint final_gifts_amount_step check (amount > 0 and amount % 250 = 0),
  created_at        timestamptz not null default now()
);

comment on table final_gifts is
  'The Final Wave (0014): one row per gift of quroosh from a guest to a project. Each has a matching vote entry on the wallet ledger.';

create index if not exists final_gifts_final_project_idx on final_gifts (final_project_id);
create index if not exists final_gifts_account_idx on final_gifts (account_id);

alter table final_settings enable row level security;
alter table final_projects enable row level security;
alter table final_gifts    enable row level security;

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

create or replace function public.final_status(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.status from final_settings s where s.project_id = p_project), 'hidden');
$$;

-- hidden: guests do not see it. open: guests give. closed: guests see the
-- results and give nothing more.
create or replace function public.final_save_status(p_project uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status is null or p_status not in ('hidden', 'open', 'closed') then
    perform app.refuse('status_invalid', 'Choose hidden, open or closed.');
  end if;
  insert into final_settings (project_id, status)
  values (p_project, p_status)
  on conflict (project_id) do update
     set status = excluded.status, updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- Managers: the projects on stage
-- -----------------------------------------------------------------------------

-- Adds a project (p_id null; it goes last) or rewrites one. Returns its id.
create or replace function public.final_project_save(p_project uuid, p_id uuid, p_name text, p_brief text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_name   text := btrim(coalesce(p_name, ''));
  v_brief  text := nullif(btrim(coalesce(p_brief, '')), '');
begin
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    perform app.refuse('name_invalid', 'Write the project''s name (at most 120 characters).');
  end if;
  if v_brief is not null and char_length(v_brief) > 1000 then
    perform app.refuse('brief_invalid', 'The brief is at most 1,000 characters.');
  end if;

  if p_id is null then
    insert into final_projects (project_id, name, brief, position)
    values (
      p_project, v_name, v_brief,
      coalesce((select max(f.position) from final_projects f where f.project_id = p_project), 0) + 1
    )
    returning id into v_id;
  else
    update final_projects f
       set name = v_name, brief = v_brief, updated_at = now()
     where f.id = p_id and f.project_id = p_project
    returning f.id into v_id;
    if v_id is null then
      perform app.refuse('not_found', 'This project is not on the list.');
    end if;
  end if;
  return v_id;
end;
$$;

-- Takes a project off the guests' list, or puts it back. Its gifts stay.
create or replace function public.final_project_hide(p_project uuid, p_id uuid, p_hidden boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update final_projects f
     set hidden = coalesce(p_hidden, false), updated_at = now()
   where f.id = p_id and f.project_id = p_project;
  if not found then
    perform app.refuse('not_found', 'This project is not on the list.');
  end if;
end;
$$;

-- Every project with what it collected, how many gifts and from how many guests.
create or replace function public.final_projects_admin(p_project uuid)
returns table (
  id        uuid,
  name      text,
  brief     text,
  "position" integer,
  hidden    boolean,
  received  bigint,
  gifts     bigint,
  givers    bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.id, f.name, f.brief, f.position, f.hidden,
         coalesce(sum(g.amount), 0)::bigint,
         count(g.id),
         count(distinct g.account_id)
    from final_projects f
    left join final_gifts g on g.final_project_id = f.id
   where f.project_id = p_project
   group by f.id
   order by f.position, f.created_at;
$$;

-- -----------------------------------------------------------------------------
-- Everyone: the ceremony's leaderboard
-- -----------------------------------------------------------------------------

-- The projects on the guests' list that collected something, most first.
-- Equal amounts share a place.
create or replace function public.final_board(p_project uuid, p_limit integer default 10)
returns table ("position" bigint, id uuid, name text, received bigint, givers bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with totals as (
    select f.id, f.name, sum(g.amount)::bigint as received, count(distinct g.account_id) as givers
      from final_projects f
      join final_gifts g on g.final_project_id = f.id
     where f.project_id = p_project and not f.hidden
     group by f.id, f.name
  )
  select rank() over (order by t.received desc), t.id, t.name, t.received, t.givers
    from totals t
   order by t.received desc, t.name
   limit least(greatest(p_limit, 1), 100);
$$;

-- -----------------------------------------------------------------------------
-- The guest
-- -----------------------------------------------------------------------------

-- The projects on the guests' list, in the managers' order, with what each
-- collected and what this account gave it.
create or replace function public.final_for_account(p_account uuid)
returns table (id uuid, name text, brief text, received bigint, mine bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.id, f.name, f.brief,
         coalesce(sum(g.amount), 0)::bigint,
         coalesce(sum(g.amount) filter (where g.account_id = p_account), 0)::bigint
    from accounts a
    join final_projects f on f.project_id = a.project_id and not f.hidden
    left join final_gifts g on g.final_project_id = f.id
   where a.id = p_account
   group by f.id
   order by f.position, f.created_at;
$$;

-- Whether an account has given anything yet: its next gift is its first
-- (capped at 75%) until it has.
create or replace function public.final_has_given(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from final_gifts g where g.account_id = p_account);
$$;

-- Gives a project quroosh from an account's balance, in steps of 250, and
-- writes the matching 'vote' entry on the ledger in the same transaction.
-- The account's first gift is at most 75% of its balance, down to a step.
-- Returns the account's balance after the gift.
--
-- Refuses:
--   not_found          no such account, or it belongs to another project
--   account_disabled   the account was disabled (its pass was cancelled)
--   final_closed       the Final Wave is not open for giving
--   project_not_found  no such project on the guests' list
--   amount_invalid     not a positive multiple of 250
--   not_enough         the balance is less than the amount
--   first_gift_cap     a first gift above 75% of the balance
create or replace function public.final_give(p_account uuid, p_project uuid, p_final_project uuid, p_amount integer)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account  accounts;
  v_balance  bigint;
  v_gift     uuid;
begin
  -- The lock comes first: the balance read below cannot change under us.
  select a.* into v_account from accounts a where a.id = p_account for update;
  if v_account.id is null or v_account.project_id <> p_project then
    perform app.refuse('not_found', 'This account is not known here.');
  end if;
  if v_account.disabled_at is not null then
    perform app.refuse('account_disabled', 'This account is not active.');
  end if;
  if public.final_status(p_project) <> 'open' then
    perform app.refuse('final_closed', 'The Final Wave is not open for giving.');
  end if;
  if not exists (
    select 1 from final_projects f
     where f.id = p_final_project and f.project_id = p_project and not f.hidden
  ) then
    perform app.refuse('project_not_found', 'This project is not on the list.');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount % 250 <> 0 or p_amount > 10000000 then
    perform app.refuse('amount_invalid', 'Give in steps of 250 quroosh.');
  end if;

  select coalesce(sum(e.amount), 0) into v_balance
    from wallet_entries e
   where e.account_id = p_account and e.voided_at is null;
  if v_balance < p_amount then
    perform app.refuse('not_enough', 'Your balance is less than this amount.');
  end if;
  -- The first gift: 75% of the balance at most, down to a whole step. The
  -- account's row is locked, so a second gift sent at the same moment waits
  -- and then sees this one.
  if not exists (select 1 from final_gifts g where g.account_id = p_account)
     and p_amount > (v_balance * 3 / 4) / 250 * 250 then
    perform app.refuse('first_gift_cap', 'Your first gift can be at most 75% of your balance.');
  end if;

  insert into final_gifts (project_id, account_id, final_project_id, amount)
  values (p_project, p_account, p_final_project, p_amount)
  returning id into v_gift;

  insert into wallet_entries (project_id, account_id, kind, amount, day, source_ref)
  values (p_project, p_account, 'vote', -p_amount, app.quroosh_today(), v_gift::text);

  return v_balance - p_amount;
end;
$$;

-- -----------------------------------------------------------------------------
-- Server only: nobody but the secret key runs these.
-- -----------------------------------------------------------------------------

revoke execute on function public.final_status(uuid) from public, anon, authenticated;
revoke execute on function public.final_save_status(uuid, text) from public, anon, authenticated;
revoke execute on function public.final_project_save(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.final_project_hide(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.final_projects_admin(uuid) from public, anon, authenticated;
revoke execute on function public.final_board(uuid, integer) from public, anon, authenticated;
revoke execute on function public.final_for_account(uuid) from public, anon, authenticated;
revoke execute on function public.final_give(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.final_has_given(uuid) from public, anon, authenticated;

grant execute on function public.final_status(uuid) to service_role;
grant execute on function public.final_save_status(uuid, text) to service_role;
grant execute on function public.final_project_save(uuid, uuid, text, text) to service_role;
grant execute on function public.final_project_hide(uuid, uuid, boolean) to service_role;
grant execute on function public.final_projects_admin(uuid) to service_role;
grant execute on function public.final_board(uuid, integer) to service_role;
grant execute on function public.final_for_account(uuid) to service_role;
grant execute on function public.final_give(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.final_has_given(uuid) to service_role;

notify pgrst, 'reload schema';
