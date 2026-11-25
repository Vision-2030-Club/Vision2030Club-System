-- =============================================================================
-- Quroosh database — 0015: the Final Wave's first gift is at most 75% of the
-- balance.
--
-- The club's decision of 2026-11-25: a guest's FIRST gift to the Final Wave
-- (0014) is at most 75% of their balance at that moment, rounded down to a
-- step of 250, so nobody spends everything on the first project they see.
-- After that, any gift up to the whole balance, as before.
--
--   final_has_given   new: whether an account has given yet, so the page
--                     offers only what final_give will accept
--   final_give        replaced: 0014's function plus the first-gift check,
--                     refused with `first_gift_cap`
--
-- The check runs after final_give has locked the account's row (0014), so
-- two gifts sent at once cannot both count as the first one.
--
-- Gifts already made are not touched. A guest who gave before this is
-- applied has had their first gift; the limit does not apply to them.
--
-- As everywhere in this database: no policies, functions executable by
-- service_role only. Needs 0014. Safe to re-run.
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

revoke execute on function public.final_has_given(uuid) from public, anon, authenticated;
revoke execute on function public.final_give(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.final_has_given(uuid) to service_role;
grant execute on function public.final_give(uuid, uuid, uuid, integer) to service_role;

notify pgrst, 'reload schema';
