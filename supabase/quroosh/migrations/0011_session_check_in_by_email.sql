-- =============================================================================
-- Quroosh database — 0011: checking in to the session with an email alone.
--
-- Until now a guest had to be signed in to check in to the day's dialogue
-- session (0009), and signing in means opening a link sent by email. At the
-- session that was too slow, and the link often opened in another browser
-- than the one that read the QR code. The club's decision (2026-11-22): at
-- the session check-in a guest only types the email on their pass.
--
-- This adds the one question the app needs for that: which account, if any,
-- has this email in this project. It answers the account's id and name and
-- nothing else, and only for an account that is not disabled. Two accounts
-- sharing an email: the older one.
--
-- An email is not proof of who is typing it, so the app uses the answer for
-- the session check-in only (`session_check_in`, 0009): it never signs the
-- device in, and the wallet and everything else still need the emailed link.
--
-- As everywhere in this database: executable by service_role only. Nothing
-- is changed in any table and nothing is deleted. Safe to re-run.
-- =============================================================================

create or replace function public.session_account_by_email(p_project uuid, p_email text)
returns table (account_id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.name
    from accounts a
   where a.project_id = p_project
     and a.email = lower(btrim(coalesce(p_email, '')))
     and a.disabled_at is null
   order by a.created_at
   limit 1;
$$;

revoke execute on function public.session_account_by_email(uuid, text) from public, anon, authenticated;
grant execute on function public.session_account_by_email(uuid, text) to service_role;

notify pgrst, 'reload schema';
