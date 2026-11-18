-- =============================================================================
-- Quroosh database — 0006: guest accounts.
--
-- A guest is a member of the public who came to the Quroosh event. They
-- signed up in the club's Event attendance component (club 0075) and were
-- checked in at the gate. The first time that happens Quroosh makes them an
-- account here and emails them "complete creating your account". They open
-- the link, confirm, and the account is theirs: it is what the Quroosh
-- market (their quroosh, the challenges, the votes) will hang on.
--
-- These are NOT the invited guests of 0005 (speakers, `guest_invitations`),
-- and they are not club members: nothing here touches the club's login.
--
-- There are no passwords (the club's decision, 2026-11-19, and the Quroosh
-- design: "بدون كلمة مرور"). A person gets in with a one-time link sent to
-- their email:
--   complete  sent once, on their first check-in; good for seven days
--   signin    sent when they ask for one on the sign-in page; fifteen minutes
-- Opening a link shows a page with one button. Pressing it uses the link up,
-- completes the account if it was not yet, and starts a session on that
-- device (a cookie, thirty days). The link is not used up by being opened,
-- so a mail scanner that fetches it does not spend it.
--
-- Neither a link's token nor a session's is stored: only its SHA-256, made
-- by the app. Somebody who read this database could not sign in as anyone.
--
-- Tables:
--   accounts              one per attendee per project
--   account_tokens        the one-time links (hashes)
--   account_sessions      who is signed in where (hashes)
--   account_emails        the emails waiting to be sent
--   account_sync          how far each project has read the check-ins
--
-- As everywhere in this database: Row Level Security on and NO policies,
-- every function executable by service_role only, and this database never
-- checks identity. The app asks the club database whether a person manages
-- the project before calling a manager's function.
--
-- Nothing is deleted: an account is disabled (when the attendee's pass is
-- cancelled) with a flag. Safe to re-run.
-- =============================================================================

create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,                -- the club database's projects.id
  -- The club database's event_attendees.id. No foreign key across databases.
  attendee_id   uuid not null,
  -- Copied from the attendee when the account is made, and kept in step by
  -- the sync while the account exists.
  name          text not null
                  constraint accounts_name_shape check (char_length(btrim(name)) between 1 and 200),
  phone         text
                  constraint accounts_phone_shape check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Lower case. Two attendees may share one (a family's address): the
  -- sign-in page then sends a link for each, and each names its person.
  email         text not null
                  constraint accounts_email_shape
                  check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and email = lower(email)),
  locale        text not null default 'ar' check (locale in ('ar', 'en')),
  -- Their first check-in at the gate, which is why the account exists.
  checked_in_at timestamptz not null,
  created_at    timestamptz not null default now(),
  -- Set when they press "Create my account". Empty: emailed, not yet theirs.
  completed_at  timestamptz,
  -- Set while the attendee's pass is cancelled: no link or session works.
  disabled_at   timestamptz,
  constraint accounts_attendee_once unique (project_id, attendee_id)
);

comment on table accounts is
  'A guest''s Quroosh account (0006): a member of the public who was checked in at the event. Personal data: the app shows it to the project''s managers only.';

create index if not exists accounts_project_idx on accounts (project_id, created_at desc);
create index if not exists accounts_email_idx on accounts (project_id, email);

create table if not exists account_tokens (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts (id),
  kind        text not null check (kind in ('complete', 'signin')),
  -- SHA-256 of the link's token, hex. The token itself is only in the email.
  token_hash  text not null unique
                constraint account_tokens_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists account_tokens_account_idx on account_tokens (account_id, created_at desc);

create table if not exists account_sessions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts (id),
  -- SHA-256 of the cookie's value, hex.
  token_hash    text not null unique
                  constraint account_sessions_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  ended_at      timestamptz
);

create index if not exists account_sessions_account_idx on account_sessions (account_id);

create table if not exists account_emails (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts (id),
  kind         text not null check (kind in ('complete', 'signin')),
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  attempts     integer not null default 0,
  sent_at      timestamptz,
  provider_id  text,
  last_error   text
);

comment on table account_emails is
  'Account emails waiting to be sent (0006). The link''s token is made when the email is sent, not when it is queued, so nothing here can sign anyone in.';

create index if not exists account_emails_pending_idx on account_emails (created_at) where sent_at is null;
create index if not exists account_emails_account_idx on account_emails (account_id, created_at desc);

create table if not exists account_sync (
  project_id         uuid primary key,
  -- The latest change read from the club's check-ins and attendees.
  check_ins_cursor   timestamptz,
  attendees_cursor   timestamptz,
  synced_at          timestamptz not null default now()
);

-- Deny-all: RLS on, no policies. Only the secret key (service_role) gets in.
alter table accounts          enable row level security;
alter table account_tokens    enable row level security;
alter table account_sessions  enable row level security;
alter table account_emails    enable row level security;
alter table account_sync      enable row level security;

-- -----------------------------------------------------------------------------
-- Keeping in step with Event attendance
-- -----------------------------------------------------------------------------

-- Queues an account email unless one of that kind was queued for the account
-- in the last minute (pressing "send again" twice must not send two).
create or replace function app.queue_account_email(p_account uuid, p_kind text)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from account_emails e
              where e.account_id = p_account
                and e.kind = p_kind
                and e.created_at > now() - interval '1 minute') then
    return false;
  end if;
  insert into account_emails (account_id, kind) values (p_account, p_kind);
  return true;
end;
$$;

-- How far a project has read, so the app knows where to read from.
create or replace function public.account_sync_state(p_project uuid)
returns table (check_ins_cursor timestamptz, attendees_cursor timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.check_ins_cursor, s.attendees_cursor from account_sync s where s.project_id = p_project;
$$;

-- One pass of the sync, in one transaction.
--
--   p_arrivals  the people checked in since the last pass, as a JSON array of
--               { attendee_id, name, phone, email, locale, checked_in_at }.
--               Each gets an account if they have none, and the "complete
--               your account" email. Somebody without an email is skipped:
--               there is nowhere to send their link.
--   p_changes   attendees changed since the last pass, as a JSON array of
--               { attendee_id, name, phone, email, cancelled }. An existing
--               account follows: a cancelled pass disables it, a restored
--               one enables it, a corrected name or mobile is copied. The
--               email is copied only while the account is not completed
--               (after that it is how they sign in).
--
-- Running it twice with the same rows changes nothing the second time, which
-- is what lets the app read a little further back than its cursor each time.
-- Returns how many accounts were made.
create or replace function public.sync_accounts(
  p_project uuid,
  p_arrivals jsonb,
  p_changes jsonb,
  p_check_ins_cursor timestamptz,
  p_attendees_cursor timestamptz
)
returns integer
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_row     jsonb;
  v_id      uuid;
  v_email   text;
  v_made    integer := 0;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_arrivals, '[]'::jsonb)) loop
    v_email := nullif(lower(btrim(coalesce(v_row->>'email', ''))), '');
    continue when v_email is null;
    begin
      insert into accounts (project_id, attendee_id, name, phone, email, locale, checked_in_at)
      values (
        p_project,
        (v_row->>'attendee_id')::uuid,
        btrim(v_row->>'name'),
        nullif(btrim(coalesce(v_row->>'phone', '')), ''),
        v_email,
        case when v_row->>'locale' = 'en' then 'en' else 'ar' end,
        coalesce((v_row->>'checked_in_at')::timestamptz, now())
      )
      on conflict on constraint accounts_attendee_once do nothing
      returning id into v_id;
    exception
      -- One attendee whose details do not fit must not stop the others.
      when check_violation or not_null_violation or invalid_text_representation then
        v_id := null;
    end;
    if v_id is not null then
      v_made := v_made + 1;
      perform app.queue_account_email(v_id, 'complete');
    end if;
    v_id := null;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    begin
      update accounts a
         set disabled_at = case when coalesce((v_row->>'cancelled')::boolean, false)
                                then coalesce(a.disabled_at, now()) end,
             name  = coalesce(nullif(btrim(coalesce(v_row->>'name', '')), ''), a.name),
             phone = coalesce(nullif(btrim(coalesce(v_row->>'phone', '')), ''), a.phone),
             email = case when a.completed_at is null
                          then coalesce(nullif(lower(btrim(coalesce(v_row->>'email', ''))), ''), a.email)
                          else a.email end
       where a.project_id = p_project
         and a.attendee_id = (v_row->>'attendee_id')::uuid;
    exception
      when check_violation or invalid_text_representation then
        null;
    end;
  end loop;

  -- A disabled account's sessions end with it.
  update account_sessions s
     set ended_at = now()
    from accounts a
   where a.id = s.account_id
     and a.project_id = p_project
     and a.disabled_at is not null
     and s.ended_at is null;

  insert into account_sync (project_id, check_ins_cursor, attendees_cursor)
  values (p_project, p_check_ins_cursor, p_attendees_cursor)
  on conflict (project_id) do update
     set check_ins_cursor = greatest(account_sync.check_ins_cursor, excluded.check_ins_cursor),
         attendees_cursor = greatest(account_sync.attendees_cursor, excluded.attendees_cursor),
         synced_at = now();

  return v_made;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sending the emails
-- -----------------------------------------------------------------------------

-- Leases emails to send, with what each needs. A row leased two minutes ago
-- and still unsent is leased again; five attempts at most. A sign-in email
-- an hour old is no use to anyone and is left alone. Disabled accounts get
-- nothing.
create or replace function public.claim_account_emails(p_limit integer default 50)
returns table (
  id          uuid,
  account_id  uuid,
  kind        text,
  project_id  uuid,
  to_email    text,
  to_name     text,
  locale      text
)
language sql
volatile
set search_path = public, pg_temp
as $$
  with leased as (
    update account_emails e
       set claimed_at = now(), attempts = e.attempts + 1
     where e.id in (
       select x.id from account_emails x
        where x.sent_at is null
          and x.attempts < 5
          and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
          and (x.kind <> 'signin' or x.created_at > now() - interval '1 hour')
        order by x.created_at
        limit greatest(p_limit, 1)
        for update skip locked
     )
    returning e.id, e.account_id, e.kind
  )
  select l.id, a.id, l.kind, a.project_id, a.email, a.name, a.locale
    from leased l
    join accounts a on a.id = l.account_id
   where a.disabled_at is null;
$$;

-- Makes the one-time link for an email about to be sent. The app made the
-- token and passes its hash; how long the link lasts depends on its kind.
create or replace function public.issue_account_token(p_account uuid, p_kind text, p_token_hash text)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  if p_kind not in ('complete', 'signin') then
    perform app.refuse('invalid', 'Unknown kind of link.');
  end if;
  insert into account_tokens (account_id, kind, token_hash, expires_at)
  values (p_account, p_kind, p_token_hash,
          now() + case when p_kind = 'complete' then interval '7 days' else interval '15 minutes' end);
exception
  when check_violation or foreign_key_violation or unique_violation then
    perform app.refuse('invalid', 'The link could not be made: ' || sqlerrm);
end;
$$;

-- Records what became of one leased email: sent (p_provider_id) or not (p_error).
create or replace function public.account_email_result(p_id uuid, p_provider_id text, p_error text)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  update account_emails e
     set sent_at     = case when p_provider_id is not null then now() end,
         provider_id = p_provider_id,
         last_error  = case when p_provider_id is null then left(coalesce(p_error, 'unknown'), 500) end,
         claimed_at  = null
   where e.id = p_id;
$$;

-- -----------------------------------------------------------------------------
-- The guest: links and sessions
-- -----------------------------------------------------------------------------

-- What a link's page shows, by the hash of its token. No row: unknown link.
--   state  'valid', 'used', 'expired' or 'disabled'
create or replace function public.account_link(p_token_hash text)
returns table (
  state       text,
  kind        text,
  project_id  uuid,
  name        text,
  phone       text,
  email       text,
  completed   boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  select case
           when a.disabled_at is not null then 'disabled'
           when t.used_at is not null then 'used'
           when t.expires_at <= now() then 'expired'
           else 'valid'
         end,
         t.kind, a.project_id, a.name, a.phone, a.email, a.completed_at is not null
    from account_tokens t
    join accounts a on a.id = t.account_id
   where t.token_hash = p_token_hash;
$$;

-- The button on a link's page: uses the link up, completes the account if
-- it was not yet, and starts a session whose cookie hashes to
-- p_session_hash. Two presses race on the token row's lock; the second is
-- told the link was used.
create or replace function public.use_account_link(p_token_hash text, p_session_hash text)
returns table (account_id uuid, project_id uuid, newly_completed boolean)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_token   account_tokens;
  v_account accounts;
begin
  select * into v_token from account_tokens t where t.token_hash = p_token_hash for update;
  if not found then
    perform app.refuse('not_found', 'This link is not known.');
  end if;
  select * into v_account from accounts a where a.id = v_token.account_id for update;
  if v_account.disabled_at is not null then
    perform app.refuse('account_disabled', 'This account is not active.');
  end if;
  if v_token.used_at is not null then
    perform app.refuse('link_used', 'This link has already been used.');
  end if;
  if v_token.expires_at <= now() then
    perform app.refuse('link_expired', 'This link has expired.');
  end if;

  update account_tokens set used_at = now() where id = v_token.id;
  update accounts set completed_at = coalesce(completed_at, now()) where id = v_account.id;
  begin
    insert into account_sessions (account_id, token_hash, expires_at)
    values (v_account.id, p_session_hash, now() + interval '30 days');
  exception
    when check_violation or unique_violation then
      perform app.refuse('invalid', 'The session could not be started.');
  end;

  return query select v_account.id, v_account.project_id, v_account.completed_at is null;
end;
$$;

-- Who a session's cookie belongs to, by its hash; and notes they were seen.
-- No row: no such session, it ended or ran out, or the account is disabled
-- or not completed.
create or replace function public.account_session(p_session_hash text)
returns table (
  account_id   uuid,
  project_id   uuid,
  attendee_id  uuid,
  name         text,
  email        text,
  locale       text
)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_session uuid;
begin
  select s.id into v_session
    from account_sessions s
    join accounts a on a.id = s.account_id
   where s.token_hash = p_session_hash
     and s.ended_at is null
     and s.expires_at > now()
     and a.disabled_at is null
     and a.completed_at is not null;
  if v_session is null then
    return;
  end if;
  -- At most one write a minute per session: this runs on every page.
  update account_sessions s set last_seen_at = now()
   where s.id = v_session and s.last_seen_at < now() - interval '1 minute';
  return query
    select a.id, a.project_id, a.attendee_id, a.name, a.email, a.locale
      from account_sessions s
      join accounts a on a.id = s.account_id
     where s.id = v_session;
end;
$$;

-- Signing out: that device's session ends.
create or replace function public.end_account_session(p_session_hash text)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  update account_sessions s set ended_at = coalesce(s.ended_at, now()) where s.token_hash = p_session_hash;
$$;

-- "Send me a sign-in link." Queues a link for every active account of the
-- project with this email: a sign-in link for a completed one, the "complete
-- your account" link again for one that is not. Answers nothing, whatever it
-- found, so the page cannot be used to learn whose email is registered.
create or replace function public.request_account_signin(p_project uuid, p_email text)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_account accounts;
begin
  for v_account in
    select * from accounts a
     where a.project_id = p_project
       and a.email = lower(btrim(coalesce(p_email, '')))
       and a.disabled_at is null
     order by a.created_at
     limit 10
  loop
    perform app.queue_account_email(
      v_account.id,
      case when v_account.completed_at is null then 'complete' else 'signin' end);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Managers
-- -----------------------------------------------------------------------------

-- The accounts of a project, newest first, with what became of each one's
-- "complete your account" email.
create or replace function public.account_list(p_project uuid)
returns table (
  id             uuid,
  attendee_id    uuid,
  name           text,
  phone          text,
  email          text,
  checked_in_at  timestamptz,
  created_at     timestamptz,
  completed_at   timestamptz,
  disabled_at    timestamptz,
  emailed_at     timestamptz,
  email_error    text,
  last_seen_at   timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select a.id, a.attendee_id, a.name, a.phone, a.email, a.checked_in_at, a.created_at,
         a.completed_at, a.disabled_at,
         (select max(e.sent_at) from account_emails e where e.account_id = a.id),
         (select e.last_error from account_emails e
           where e.account_id = a.id and e.sent_at is null
           order by e.created_at desc limit 1),
         (select max(s.last_seen_at) from account_sessions s where s.account_id = a.id)
    from accounts a
   where a.project_id = p_project
   order by a.created_at desc;
$$;

-- Sends an account its link again: the "complete your account" one while it
-- is not completed, a sign-in link after. False: one was queued in the last
-- minute.
create or replace function public.resend_account_email(p_project uuid, p_account uuid)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_account accounts;
begin
  select * into v_account from accounts a where a.id = p_account and a.project_id = p_project;
  if not found then
    perform app.refuse('not_found', 'This account does not exist.');
  end if;
  if v_account.disabled_at is not null then
    perform app.refuse('account_disabled', 'This account is not active.');
  end if;
  return app.queue_account_email(
    v_account.id,
    case when v_account.completed_at is null then 'complete' else 'signin' end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Server only: nobody but the secret key runs these.
-- -----------------------------------------------------------------------------

revoke execute on function app.queue_account_email(uuid, text) from public, anon, authenticated;
revoke execute on function public.account_sync_state(uuid) from public, anon, authenticated;
revoke execute on function public.sync_accounts(uuid, jsonb, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_account_emails(integer) from public, anon, authenticated;
revoke execute on function public.issue_account_token(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.account_email_result(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.account_link(text) from public, anon, authenticated;
revoke execute on function public.use_account_link(text, text) from public, anon, authenticated;
revoke execute on function public.account_session(text) from public, anon, authenticated;
revoke execute on function public.end_account_session(text) from public, anon, authenticated;
revoke execute on function public.request_account_signin(uuid, text) from public, anon, authenticated;
revoke execute on function public.account_list(uuid) from public, anon, authenticated;
revoke execute on function public.resend_account_email(uuid, uuid) from public, anon, authenticated;

grant execute on function app.queue_account_email(uuid, text) to service_role;
grant execute on function public.account_sync_state(uuid) to service_role;
grant execute on function public.sync_accounts(uuid, jsonb, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_account_emails(integer) to service_role;
grant execute on function public.issue_account_token(uuid, text, text) to service_role;
grant execute on function public.account_email_result(uuid, text, text) to service_role;
grant execute on function public.account_link(text) to service_role;
grant execute on function public.use_account_link(text, text) to service_role;
grant execute on function public.account_session(text) to service_role;
grant execute on function public.end_account_session(text) to service_role;
grant execute on function public.request_account_signin(uuid, text) to service_role;
grant execute on function public.account_list(uuid) to service_role;
grant execute on function public.resend_account_email(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
