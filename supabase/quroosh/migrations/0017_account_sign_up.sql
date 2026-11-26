-- =============================================================================
-- Quroosh database — 0017: guests make their own account.
--
-- The club's decision of 2026-11-26: a guest no longer needs a pass scanned
-- at the gate, or an email to confirm, to get a Quroosh account. They type
-- their name, mobile and email on the account page (opened from one QR code
-- or the event's sign-up link), the account is made and signed in on that
-- device at once, and the sign-up bonus is paid into their wallet.
--
--   accounts.origin   new: 'gate' (made by sync_accounts after a check-in,
--                     every row before this) or 'signup' (made here)
--   account_sign_up   makes the account, its session and the bonus, in one
--                     transaction
--   account_email_taken   whether an active account already uses an email,
--                     so the app can say "sign in instead" before it
--                     registers anyone
--
-- The app first registers the person in the club database's Event attendance
-- (one attendee per mobile, as the sign-up form always has, but no pass
-- email), then calls account_sign_up with that attendee's id. So a guest who
-- signs up and is later checked in at the gate keeps one account: the gate's
-- sync_accounts finds it by attendee and makes nothing (accounts_attendee_once),
-- and sync_wallet (0010) pays nothing more, because the account already has
-- its standing 'attendance' entry, the sign-up bonus.
--
-- Nobody takes over an existing account here: an email or an attendee that
-- already has an active account is refused (`account_exists`), and the
-- guest signs in with the emailed link as before. The session is only ever
-- started for the account this call made.
--
-- As everywhere in this database: no policies, functions executable by
-- service_role only, and this database never checks identity. Needs 0006
-- and 0007. Safe to re-run.
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

alter table accounts add column if not exists origin text not null default 'gate';
alter table accounts drop constraint if exists accounts_origin_check;
alter table accounts add constraint accounts_origin_check check (origin in ('gate', 'signup'));

comment on column accounts.checked_in_at is
  'Their first check-in at the gate (origin gate), or when they signed up themselves (origin signup, 0017).';

-- Whether an active account of the project already uses this email.
create or replace function public.account_email_taken(p_project uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from accounts a
     where a.project_id = p_project
       and a.email = lower(btrim(coalesce(p_email, '')))
       and a.disabled_at is null
  );
$$;

-- Makes a guest's own account for a club attendee, signs it in (the session
-- cookie's hash) and pays the sign-up bonus (wallet_attendance_points, as the
-- gate's first visit does). Returns the account and the bonus paid.
--
-- Refuses:
--   account_exists   the email, or the attendee, already has an account
--   invalid          a detail does not fit (name, mobile, email, session)
create or replace function public.account_sign_up(
  p_project       uuid,
  p_attendee      uuid,
  p_name          text,
  p_phone         text,
  p_email         text,
  p_locale        text,
  p_session_hash  text
)
returns table (account_id uuid, bonus integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_id      uuid;
  v_points  integer := public.wallet_attendance_points(p_project);
  v_paid    integer := 0;
begin
  if public.account_email_taken(p_project, v_email) then
    perform app.refuse('account_exists', 'This email already has an account.');
  end if;

  begin
    insert into accounts (project_id, attendee_id, name, phone, email, locale,
                          checked_in_at, completed_at, origin)
    values (
      p_project,
      p_attendee,
      btrim(coalesce(p_name, '')),
      nullif(btrim(coalesce(p_phone, '')), ''),
      v_email,
      case when p_locale = 'en' then 'en' else 'ar' end,
      now(),
      now(),
      'signup'
    )
    on conflict on constraint accounts_attendee_once do nothing
    returning id into v_id;
  exception
    when check_violation or not_null_violation then
      perform app.refuse('invalid', 'Some details are not valid: ' || sqlerrm);
  end;
  if v_id is null then
    perform app.refuse('account_exists', 'This person already has an account.');
  end if;

  begin
    insert into account_sessions (account_id, token_hash, expires_at)
    values (v_id, p_session_hash, now() + interval '30 days');
  exception
    when check_violation or unique_violation then
      perform app.refuse('invalid', 'The session could not be started.');
  end;

  if v_points > 0 then
    insert into wallet_entries (project_id, account_id, kind, amount, day, source_ref)
    values (p_project, v_id, 'attendance', v_points, app.quroosh_today(), 'signup:' || v_id::text)
    on conflict do nothing;
    v_paid := v_points;
  end if;

  return query select v_id, v_paid;
end;
$$;

revoke execute on function public.account_email_taken(uuid, text) from public, anon, authenticated;
revoke execute on function public.account_sign_up(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.account_email_taken(uuid, text) to service_role;
grant execute on function public.account_sign_up(uuid, uuid, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
