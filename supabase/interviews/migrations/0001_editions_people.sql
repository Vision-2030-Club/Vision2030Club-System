-- =============================================================================
-- 0001 — The Mock Interviews database: editions, people, and the audit log.
--
-- This is a SEPARATE Supabase project from the club's. Nothing here knows a
-- club role or a club permission: the club database decides WHO may enter the
-- interviews system (public.my_component_access there), and this database is
-- only ever reached by the application server holding the service role.
--
-- Three rules shape every file in this folder:
--
--   1. NOBODY BUT THE SERVER READS OR WRITES. Row Level Security is enabled on
--      every table with no policies at all, and the anon/authenticated roles
--      are stripped of their privileges (0004). A leaked anon key exposes
--      nothing. The server is the only door.
--
--   2. EVERY WRITE IS A FUNCTION THAT NAMES ITS ACTOR. The server passes
--      p_actor — {kind: member|student|company|system, id, name} — and the
--      function sets it for the transaction, so the audit trigger on every
--      table records who did what. Public pages resolve a token to a student
--      or a company and the function sets the actor itself.
--
--   3. A CHANGE TOUCHES THE ROWS IT IS ABOUT, AND NO OTHERS. The previous tool
--      rewrote the whole dataset on every edit and lost data under load. Here
--      adding a student inserts one row, checking someone in updates one row,
--      and the guarantees that matter (a slot is taken once, a student is
--      never in two places) are constraints, so they hold under concurrency
--      without anyone looking first.
-- =============================================================================

create extension if not exists citext;
create extension if not exists btree_gist;

-- Helper functions live here; nothing in `app` is exposed through the API.
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- The actor
--
-- A transaction-local setting. Functions call app.set_actor(...) first; the
-- audit trigger reads it back. Anything that writes without setting it is
-- recorded as 'system' rather than lost.
-- -----------------------------------------------------------------------------

create or replace function app.set_actor(p_actor jsonb)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'app.actor',
    coalesce(p_actor, '{"kind":"system"}'::jsonb)::text,
    true
  );
end;
$$;

create or replace function app.actor()
returns jsonb
language plpgsql
stable
as $$
declare
  v text;
begin
  v := current_setting('app.actor', true);
  if v is null or v = '' then
    return '{"kind":"system"}'::jsonb;
  end if;
  return v::jsonb;
exception
  when others then
    return '{"kind":"system"}'::jsonb;
end;
$$;

-- -----------------------------------------------------------------------------
-- The audit log — written by a trigger, so no code path can skip it
-- -----------------------------------------------------------------------------

create table audit_log (
  id          bigserial primary key,
  edition_id  uuid,
  at          timestamptz not null default now(),
  actor_kind  text not null,
  actor_id    text,
  actor_name  text,
  -- insert / update / delete from the trigger; anything else is a note
  -- written by a function (e.g. 'feedback_released').
  action      text not null,
  table_name  text not null,
  row_id      text,
  before      jsonb,
  after       jsonb
);

create index audit_log_edition_idx on audit_log (edition_id, at desc);
create index audit_log_row_idx on audit_log (table_name, row_id);

comment on table audit_log is
  'Every insert, update and delete on every event table, with the actor that
   made it. Never pruned: "a log of every change anyone has made" is a
   requirement, and the earlier versions of a re-submitted application live
   here too.';

create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a         jsonb := app.actor();
  v_before  jsonb;
  v_after   jsonb;
  v_edition uuid;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- A save that changed nothing is not a change.
    if v_before = v_after then
      return null;
    end if;
  else
    v_before := to_jsonb(old);
  end if;

  if tg_table_name = 'editions' then
    v_edition := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
  else
    v_edition := coalesce(v_after ->> 'edition_id', v_before ->> 'edition_id')::uuid;
  end if;

  insert into audit_log
    (edition_id, actor_kind, actor_id, actor_name, action, table_name, row_id, before, after)
  values
    (v_edition,
     coalesce(a ->> 'kind', 'system'), a ->> 'id', a ->> 'name',
     lower(tg_op), tg_table_name,
     coalesce(v_after ->> 'id', v_before ->> 'id'),
     v_before, v_after);

  return null;
end;
$$;

-- A note that is not a row change: 'feedback_released', 'export_taken', …
create or replace function app.note(
  p_edition  uuid,
  p_action   text,
  p_table    text,
  p_row_id   text,
  p_detail   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a jsonb := app.actor();
begin
  insert into audit_log
    (edition_id, actor_kind, actor_id, actor_name, action, table_name, row_id, after)
  values
    (p_edition, coalesce(a ->> 'kind', 'system'), a ->> 'id', a ->> 'name',
     p_action, p_table, p_row_id, p_detail);
end;
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Raise with a machine-readable hint the application can translate, and a
-- sentence that reads well if it cannot.
create or replace function app.refuse(p_hint text, p_message text)
returns void
language plpgsql
as $$
begin
  raise exception '%', p_message using hint = p_hint, errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Editions — one per interview week. Nothing is ever wiped to start the next.
-- -----------------------------------------------------------------------------

create table editions (
  id                 uuid primary key default gen_random_uuid(),
  name_en            text not null,
  name_ar            text not null,
  -- Public identifier in the apply-form URL: /interviews/apply/<slug>.
  public_slug        text not null unique check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  -- The club project this edition is the component of (a uuid in the OTHER
  -- database; there is nothing here to reference). One edition per project.
  club_project_id    uuid unique,
  status             text not null default 'draft' check (status in ('draft', 'active', 'archived')),

  -- The gates. NULL means closed. The status only has to be 'active'.
  apply_opens_at     timestamptz,
  apply_closes_at    timestamptz,
  booking_opens_at   timestamptz,
  booking_closes_at  timestamptz,

  time_zone          text not null default 'Asia/Riyadh',
  -- The waiting-area screen's link. Generated by the server (48 hex chars).
  tv_token           text unique,
  -- max_preferences, change_cutoff_hours, tv_call_minutes, rating_labels,
  -- feedback_email_mode — read through app.edition_settings, which fills in
  -- the defaults, so a missing key never breaks a page.
  settings           jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger editions_touch before update on editions
  for each row execute function app.touch_updated_at();
create trigger editions_audit after insert or update or delete on editions
  for each row execute function app.audit_row();

create or replace function app.edition_settings(p_edition uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'max_preferences',     4,
           'change_cutoff_hours', 12,
           'tv_call_minutes',     5,
           'feedback_email_mode', 'on_release',
           'rating_labels',       jsonb_build_array(
             jsonb_build_object('key', 'communication', 'en', 'Communication',       'ar', 'التواصل'),
             jsonb_build_object('key', 'technical',     'en', 'Technical knowledge', 'ar', 'المعرفة التقنية'),
             jsonb_build_object('key', 'cv',            'en', 'CV',                  'ar', 'السيرة الذاتية'),
             jsonb_build_object('key', 'presentation',  'en', 'Presentation',        'ar', 'الحضور والمظهر')
           )
         ) || coalesce((select settings from editions where id = p_edition), '{}'::jsonb)
$$;

-- The same, callable by the server (the `app` schema is not exposed).
create or replace function public.edition_settings(p_edition uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.edition_settings(p_edition)
$$;

-- -----------------------------------------------------------------------------
-- Rooms — the venue's, per edition. The club's own rooms are not involved.
-- -----------------------------------------------------------------------------

create table rooms (
  id          uuid primary key default gen_random_uuid(),
  edition_id  uuid not null references editions (id) on delete cascade,
  name        text not null,
  note        text,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (edition_id, name)
);

create trigger rooms_touch before update on rooms
  for each row execute function app.touch_updated_at();
create trigger rooms_audit after insert or update or delete on rooms
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Companies — per edition, each with the interviewer's secret link
-- -----------------------------------------------------------------------------

create table companies (
  id                uuid primary key default gen_random_uuid(),
  edition_id        uuid not null references editions (id) on delete cascade,
  name_en           text not null,
  name_ar           text not null,
  logo_url          text,
  desc_en           text,
  desc_ar           text,
  -- Hidden from the apply form (a company that pulled out, or one added for
  -- staff only); still shown wherever it has slots or bookings.
  is_hidden         boolean not null default false,
  sort_order        integer not null default 100,
  -- The interviewer page: /interviews/c/<access_token>, optionally behind a
  -- short PIN. Regenerating the token is how a leaked link is revoked.
  access_token      text not null unique,
  access_pin        text check (access_pin is null or access_pin ~ '^[0-9]{4,8}$'),
  token_rotated_at  timestamptz,
  -- The id the old tool used, so an import can be re-run without doubling.
  import_ref        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (edition_id, import_ref)
);

create index companies_edition_idx on companies (edition_id, sort_order, name_en);

create trigger companies_touch before update on companies
  for each row execute function app.touch_updated_at();
create trigger companies_audit after insert or update or delete on companies
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Applications — one per student per edition, keyed by email
-- -----------------------------------------------------------------------------

create table applications (
  id                uuid primary key default gen_random_uuid(),
  edition_id        uuid not null references editions (id) on delete cascade,
  email             citext not null,
  phone             text,
  name              text not null,
  is_club_member    boolean,
  university        text,
  university_other  text,
  level             text,
  college           text,
  major             text,
  gpa               text,
  english_level     text,
  why_first         text,
  -- The language the form was filled in; every email to this person uses it.
  locale            text not null default 'ar' check (locale in ('ar', 'en')),

  -- The CV: an object path in the private `cvs` bucket, never a URL. The two
  -- other columns only exist for the imported April 2026 edition, whose files
  -- were not in the export.
  cv_path           text,
  cv_external_url   text,
  cv_import_ref     text,

  -- The student's own page: /interviews/s/<personal_token>.
  personal_token    text not null unique,
  source            text not null default 'form' check (source in ('form', 'import')),
  import_ref        text,
  submitted_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (edition_id, email),
  unique (edition_id, import_ref)
);

create index applications_edition_idx on applications (edition_id, submitted_at desc);

create trigger applications_touch before update on applications
  for each row execute function app.touch_updated_at();
create trigger applications_audit after insert or update or delete on applications
  for each row execute function app.audit_row();

-- Which companies a student asked for, in order, and what HR decided for each.
-- Acceptance is per company: being turned down by one changes nothing for the
-- others.
create table application_preferences (
  id              uuid primary key default gen_random_uuid(),
  edition_id      uuid not null references editions (id) on delete cascade,
  application_id  uuid not null references applications (id) on delete cascade,
  company_id      uuid not null references companies (id) on delete cascade,
  rank            integer not null check (rank >= 1),
  decision        text not null default 'pending' check (decision in ('pending', 'accepted', 'rejected')),
  decided_at      timestamptz,
  decision_note   text,
  unique (application_id, company_id),
  unique (application_id, rank)
);

create index application_preferences_company_idx on application_preferences (company_id, decision);

create trigger application_preferences_audit
  after insert or update or delete on application_preferences
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- The email outbox
--
-- The database never sends mail: it writes a row saying what should be said
-- to whom, and the server renders and sends it afterwards (src/lib/interviews/
-- email.ts). Same reasoning as the club's push outbox — a trigger making a
-- network call would hold its transaction open for the length of that call.
-- -----------------------------------------------------------------------------

create table email_outbox (
  id              uuid primary key default gen_random_uuid(),
  edition_id      uuid not null references editions (id) on delete cascade,
  application_id  uuid references applications (id) on delete cascade,
  to_email        text not null,
  to_name         text,
  locale          text not null default 'ar' check (locale in ('ar', 'en')),
  -- accepted · booking_confirmed · booking_moved · booking_cancelled ·
  -- reminder · feedback
  kind            text not null,
  -- Whatever the template needs: the personal token, the slot, the company…
  payload         jsonb not null default '{}'::jsonb,
  -- Set for anything that could be produced twice, so it is written once.
  dedupe_key      text unique,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  attempts        integer not null default 0,
  last_error      text,
  provider_id     text
);

create index email_outbox_pending_idx on email_outbox (created_at) where sent_at is null;
create index email_outbox_edition_idx on email_outbox (edition_id, created_at desc);

create or replace function app.enqueue_email(
  p_edition      uuid,
  p_application  uuid,
  p_kind         text,
  p_payload      jsonb,
  p_dedupe_key   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app  applications%rowtype;
  v_id   uuid;
begin
  select * into v_app from applications where id = p_application;
  if v_app.id is null or v_app.email is null then
    return false;
  end if;

  insert into email_outbox
    (edition_id, application_id, to_email, to_name, locale, kind, payload, dedupe_key)
  values
    (p_edition, p_application, v_app.email::text, v_app.name, v_app.locale, p_kind,
     coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id is not null;
end;
$$;

-- Leases rows for a delivery pass. Two passes can overlap (one kicked by the
-- action that queued the row, one by the scheduled sweep); `skip locked` and
-- the lease mean they never both send the same one. A lease not released in
-- two minutes is taken again; five attempts and the row is left for a person.
create or replace function public.claim_email_outbox(p_limit integer default 50)
returns setof email_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  update email_outbox o
     set claimed_at = now(),
         attempts   = o.attempts + 1
   where o.id in (
     select id
     from email_outbox
     where sent_at is null
       and attempts < 5
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
     order by created_at
     limit greatest(p_limit, 1)
     for update skip locked
   )
  returning o.*
$$;

-- Put a failed row back in the queue with a fresh attempt budget.
create or replace function public.retry_email(p_id uuid, p_actor jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.set_actor(p_actor);
  update email_outbox
     set attempts = 0, claimed_at = null, last_error = null
   where id = p_id and sent_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Editions: create, update
-- -----------------------------------------------------------------------------

create or replace function public.create_edition(p_payload jsonb, p_actor jsonb)
returns editions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v editions;
begin
  perform app.set_actor(p_actor);

  insert into editions (name_en, name_ar, public_slug, club_project_id, tv_token, time_zone)
  values (
    p_payload ->> 'name_en',
    p_payload ->> 'name_ar',
    p_payload ->> 'public_slug',
    nullif(p_payload ->> 'club_project_id', '')::uuid,
    p_payload ->> 'tv_token',
    coalesce(nullif(p_payload ->> 'time_zone', ''), 'Asia/Riyadh')
  )
  returning * into v;

  return v;
end;
$$;

-- Only the keys present in p_patch change; `settings` keys are merged in, so
-- changing one setting never resets another.
create or replace function public.update_edition(p_edition uuid, p_patch jsonb, p_actor jsonb)
returns editions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v editions;
begin
  perform app.set_actor(p_actor);

  update editions e
     set name_en           = coalesce(p_patch ->> 'name_en', e.name_en),
         name_ar           = coalesce(p_patch ->> 'name_ar', e.name_ar),
         public_slug       = coalesce(p_patch ->> 'public_slug', e.public_slug),
         status            = coalesce(p_patch ->> 'status', e.status),
         club_project_id   = case when p_patch ? 'club_project_id'
                                  then nullif(p_patch ->> 'club_project_id', '')::uuid
                                  else e.club_project_id end,
         apply_opens_at    = case when p_patch ? 'apply_opens_at'
                                  then nullif(p_patch ->> 'apply_opens_at', '')::timestamptz
                                  else e.apply_opens_at end,
         apply_closes_at   = case when p_patch ? 'apply_closes_at'
                                  then nullif(p_patch ->> 'apply_closes_at', '')::timestamptz
                                  else e.apply_closes_at end,
         booking_opens_at  = case when p_patch ? 'booking_opens_at'
                                  then nullif(p_patch ->> 'booking_opens_at', '')::timestamptz
                                  else e.booking_opens_at end,
         booking_closes_at = case when p_patch ? 'booking_closes_at'
                                  then nullif(p_patch ->> 'booking_closes_at', '')::timestamptz
                                  else e.booking_closes_at end,
         time_zone         = coalesce(nullif(p_patch ->> 'time_zone', ''), e.time_zone),
         tv_token          = coalesce(p_patch ->> 'tv_token', e.tv_token),
         settings          = e.settings || coalesce(p_patch -> 'settings', '{}'::jsonb)
   where e.id = p_edition
   returning * into v;

  if v.id is null then
    perform app.refuse('not_found', 'No such edition.');
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rooms and companies
-- -----------------------------------------------------------------------------

create or replace function public.upsert_room(
  p_edition uuid, p_room uuid, p_payload jsonb, p_actor jsonb
)
returns rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v rooms;
begin
  perform app.set_actor(p_actor);

  if p_room is null then
    insert into rooms (edition_id, name, note, sort_order)
    values (p_edition, btrim(p_payload ->> 'name'), nullif(p_payload ->> 'note', ''),
            coalesce((p_payload ->> 'sort_order')::integer, 100))
    returning * into v;
  else
    update rooms r
       set name       = coalesce(btrim(p_payload ->> 'name'), r.name),
           note       = case when p_payload ? 'note' then nullif(p_payload ->> 'note', '') else r.note end,
           sort_order = coalesce((p_payload ->> 'sort_order')::integer, r.sort_order),
           is_active  = coalesce((p_payload ->> 'is_active')::boolean, r.is_active)
     where r.id = p_room and r.edition_id = p_edition
     returning * into v;
    if v.id is null then
      perform app.refuse('not_found', 'No such room.');
    end if;
  end if;
  return v;
end;
$$;

create or replace function public.upsert_company(
  p_edition uuid, p_company uuid, p_payload jsonb, p_actor jsonb
)
returns companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v companies;
begin
  perform app.set_actor(p_actor);

  if p_company is null then
    insert into companies
      (edition_id, name_en, name_ar, logo_url, desc_en, desc_ar, is_hidden, sort_order,
       access_token, access_pin, import_ref)
    values
      (p_edition,
       btrim(p_payload ->> 'name_en'),
       btrim(p_payload ->> 'name_ar'),
       nullif(p_payload ->> 'logo_url', ''),
       nullif(p_payload ->> 'desc_en', ''),
       nullif(p_payload ->> 'desc_ar', ''),
       coalesce((p_payload ->> 'is_hidden')::boolean, false),
       coalesce((p_payload ->> 'sort_order')::integer, 100),
       p_payload ->> 'access_token',
       nullif(p_payload ->> 'access_pin', ''),
       nullif(p_payload ->> 'import_ref', ''))
    returning * into v;
  else
    update companies c
       set name_en    = coalesce(btrim(p_payload ->> 'name_en'), c.name_en),
           name_ar    = coalesce(btrim(p_payload ->> 'name_ar'), c.name_ar),
           logo_url   = case when p_payload ? 'logo_url' then nullif(p_payload ->> 'logo_url', '') else c.logo_url end,
           desc_en    = case when p_payload ? 'desc_en'  then nullif(p_payload ->> 'desc_en', '')  else c.desc_en end,
           desc_ar    = case when p_payload ? 'desc_ar'  then nullif(p_payload ->> 'desc_ar', '')  else c.desc_ar end,
           is_hidden  = coalesce((p_payload ->> 'is_hidden')::boolean, c.is_hidden),
           sort_order = coalesce((p_payload ->> 'sort_order')::integer, c.sort_order),
           access_pin = case when p_payload ? 'access_pin' then nullif(p_payload ->> 'access_pin', '') else c.access_pin end
     where c.id = p_company and c.edition_id = p_edition
     returning * into v;
    if v.id is null then
      perform app.refuse('not_found', 'No such company.');
    end if;
  end if;
  return v;
end;
$$;

-- A new link for the interviewer. The old one stops working at once.
create or replace function public.rotate_company_token(
  p_company uuid, p_token text, p_actor jsonb
)
returns companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v companies;
begin
  perform app.set_actor(p_actor);
  update companies
     set access_token = p_token, token_rotated_at = now()
   where id = p_company
   returning * into v;
  if v.id is null then
    perform app.refuse('not_found', 'No such company.');
  end if;
  return v;
end;
$$;

create or replace function public.rotate_tv_token(p_edition uuid, p_token text, p_actor jsonb)
returns editions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v editions;
begin
  perform app.set_actor(p_actor);
  update editions set tv_token = p_token where id = p_edition returning * into v;
  if v.id is null then
    perform app.refuse('not_found', 'No such edition.');
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Applying
--
-- One form, once. A second submission with the same email UPDATES the first
-- while nothing has been decided or booked — people fix a typo or swap a
-- company, and last time 70 of 877 did — and is refused after that, because
-- an accepted company or a booked slot is no longer the student's alone to
-- change. Every earlier version is in audit_log.
--
-- Returns {id, personal_token, replaced, previous_cv_path}: the server uses
-- previous_cv_path to delete the file a re-submission replaced, AFTER this
-- has committed, so a refused submission never loses the old CV.
-- -----------------------------------------------------------------------------

create or replace function public.submit_application(
  p_edition  uuid,
  p_payload  jsonb,
  p_token    text,
  p_actor    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e            editions%rowtype;
  v_settings   jsonb;
  v_max        integer;
  v_email      citext;
  v_name       text;
  v_prefs      uuid[];
  v_count      integer;
  v_existing   applications%rowtype;
  v_id         uuid;
  v_prev_cv    text;
  v_replaced   boolean := false;
  v_cv         text;
  i            integer;
begin
  select * into e from editions where id = p_edition;
  if e.id is null then
    perform app.refuse('not_found', 'No such edition.');
  end if;
  if e.status <> 'active'
     or e.apply_opens_at is null or e.apply_closes_at is null
     or now() < e.apply_opens_at or now() >= e.apply_closes_at then
    perform app.refuse('applications_closed', 'Applications are closed.');
  end if;

  v_settings := app.edition_settings(p_edition);
  v_max := coalesce((v_settings ->> 'max_preferences')::integer, 4);

  v_email := lower(btrim(coalesce(p_payload ->> 'email', '')));
  v_name  := btrim(coalesce(p_payload ->> 'name', ''));
  if v_email = '' or v_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    perform app.refuse('invalid_email', 'Enter a valid email address.');
  end if;
  if v_name = '' then
    perform app.refuse('missing_name', 'Enter your name.');
  end if;

  -- Preferences: 1..max, distinct, all visible companies of this edition.
  select coalesce(array_agg((x.value ->> 0)::uuid order by x.ordinality), '{}')
    into v_prefs
    from jsonb_array_elements(coalesce(p_payload -> 'preferences', '[]'::jsonb))
         with ordinality as x;

  if array_length(v_prefs, 1) is null then
    perform app.refuse('no_preferences', 'Choose at least one company.');
  end if;
  if array_length(v_prefs, 1) > v_max then
    perform app.refuse('too_many_preferences', format('Choose at most %s companies.', v_max));
  end if;
  if (select count(distinct u) from unnest(v_prefs) u) <> array_length(v_prefs, 1) then
    perform app.refuse('duplicate_preference', 'Each company can be chosen once.');
  end if;
  select count(*) into v_count
    from companies c
   where c.id = any (v_prefs) and c.edition_id = p_edition and not c.is_hidden;
  if v_count <> array_length(v_prefs, 1) then
    perform app.refuse('unknown_company', 'One of the chosen companies is not available.');
  end if;

  v_cv := nullif(p_payload ->> 'cv_path', '');

  select * into v_existing
    from applications
   where edition_id = p_edition and email = v_email;

  if v_existing.id is not null then
    if exists (select 1 from application_preferences ap
                where ap.application_id = v_existing.id and ap.decision <> 'pending')
       or exists (select 1 from bookings b
                   where b.application_id = v_existing.id and b.cancelled_at is null) then
      perform app.refuse('already_reviewed',
        'This application has already been reviewed. Contact the club to change anything.');
    end if;

    -- The student is the actor of their own re-submission.
    perform app.set_actor(jsonb_build_object('kind', 'student', 'id', v_existing.id, 'name', v_name));

    v_prev_cv := v_existing.cv_path;
    v_id := v_existing.id;
    v_replaced := true;

    update applications a
       set phone            = nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
           name             = v_name,
           is_club_member   = (p_payload ->> 'is_club_member')::boolean,
           university       = nullif(p_payload ->> 'university', ''),
           university_other = nullif(p_payload ->> 'university_other', ''),
           level            = nullif(p_payload ->> 'level', ''),
           college          = nullif(p_payload ->> 'college', ''),
           major            = nullif(p_payload ->> 'major', ''),
           gpa              = nullif(p_payload ->> 'gpa', ''),
           english_level    = nullif(p_payload ->> 'english_level', ''),
           why_first        = nullif(p_payload ->> 'why_first', ''),
           locale           = coalesce(nullif(p_payload ->> 'locale', ''), a.locale),
           cv_path          = coalesce(v_cv, a.cv_path),
           submitted_at     = now()
     where a.id = v_id;

    delete from application_preferences where application_id = v_id;
  else
    if v_cv is null then
      perform app.refuse('missing_cv', 'Attach your CV as a PDF.');
    end if;

    insert into applications
      (edition_id, email, phone, name, is_club_member, university, university_other,
       level, college, major, gpa, english_level, why_first, locale, cv_path, personal_token)
    values
      (p_edition, v_email,
       nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
       v_name,
       (p_payload ->> 'is_club_member')::boolean,
       nullif(p_payload ->> 'university', ''),
       nullif(p_payload ->> 'university_other', ''),
       nullif(p_payload ->> 'level', ''),
       nullif(p_payload ->> 'college', ''),
       nullif(p_payload ->> 'major', ''),
       nullif(p_payload ->> 'gpa', ''),
       nullif(p_payload ->> 'english_level', ''),
       nullif(p_payload ->> 'why_first', ''),
       coalesce(nullif(p_payload ->> 'locale', ''), 'ar'),
       v_cv, p_token)
    returning id into v_id;

    perform app.set_actor(jsonb_build_object('kind', 'student', 'id', v_id, 'name', v_name));
  end if;

  for i in 1 .. array_length(v_prefs, 1) loop
    insert into application_preferences (edition_id, application_id, company_id, rank)
    values (p_edition, v_id, v_prefs[i], i);
  end loop;

  return jsonb_build_object(
    'id', v_id,
    'personal_token', (select personal_token from applications where id = v_id),
    'replaced', v_replaced,
    'previous_cv_path', case when v_cv is not null and v_prev_cv is distinct from v_cv
                             then v_prev_cv end
  );
end;
$$;

-- HR's decision on one (student, company) pair. Independent of every other
-- pair. The first acceptance is what earns the student their personal link,
-- so that email is queued here, once, whatever happens afterwards.
create or replace function public.decide_preference(
  p_application  uuid,
  p_company      uuid,
  p_decision     text,
  p_note         text,
  p_actor        jsonb
)
returns application_preferences
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v application_preferences;
begin
  perform app.set_actor(p_actor);

  if p_decision not in ('pending', 'accepted', 'rejected') then
    perform app.refuse('bad_decision', 'A decision is accepted, rejected or pending.');
  end if;

  update application_preferences ap
     set decision      = p_decision,
         decided_at    = case when p_decision = 'pending' then null else now() end,
         decision_note = nullif(p_note, '')
   where ap.application_id = p_application and ap.company_id = p_company
   returning * into v;

  if v.id is null then
    perform app.refuse('not_found', 'That student did not ask for this company.');
  end if;

  if p_decision = 'accepted' then
    perform app.enqueue_email(
      v.edition_id, p_application, 'accepted',
      jsonb_build_object('application_id', p_application),
      'accepted:' || p_application::text);
  end if;

  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security: on, with no policies. Only the service role gets in.
-- -----------------------------------------------------------------------------

alter table audit_log               enable row level security;
alter table editions                enable row level security;
alter table rooms                   enable row level security;
alter table companies               enable row level security;
alter table applications            enable row level security;
alter table application_preferences enable row level security;
alter table email_outbox            enable row level security;
