-- =============================================================================
-- 0016 — Walk-ins.
--
-- A student who turns up on the day without an interview scans the walk-in
-- link (a QR code at the venue: /interviews/w/<token>), fills in the same
-- questions as the apply form with their CV, and chooses ONE company. Only a
-- company with a free time later TODAY can be chosen. The request waits at
-- the reception desk; a receptionist confirms it by picking one of those
-- free times, or turns it down. The club's decisions (2026-10-14):
--
--   - one company per walk-in request, and only a time that has not started;
--   - a student who applied online may still walk in: their online
--     application is kept as it is (nothing on file is overwritten, only
--     blanks are filled) and reception sees what HR decided before
--     confirming;
--   - confirming is reception's to do, and can be undone.
--
--   walkin_requests       one row per request, holding what the form said
--                         until reception confirms it; never deleted
--   walkin_slots(e)       the free times a walk-in can be given now: today on
--                         the edition's clock, not started, not closed, not
--                         held, of a visible company that takes walk-ins
--   submit_walkin(...)    the public form (the link's token resolves the
--                         edition here)
--   confirm_walkin(...)   reception: the request becomes an application (or
--                         joins the student's own), an acceptance for that
--                         company, a booking at the chosen time, and checked
--                         in, all in one transaction
--   reject_walkin(...)    reception turns a request down, with a note
--   reopen_walkin(...)    undo: a confirmed request's booking is cancelled
--                         (only while the interview has not started) and the
--                         request goes back to the queue; a rejected one too
--
-- The link's token, whether walk-ins are open, and the companies that take
-- none live in the edition's settings (walkin_token, walkins_open,
-- walkins_off_companies), written by the app like every other setting.
--
-- Also: edition_snapshot (0003) now carries walkin_requests and 0014's
-- session_acceptances, so the club's export misses neither.
--
-- Apply after 0015. Can be run twice. Nothing is deleted.
-- =============================================================================

create table if not exists walkin_requests (
  id                uuid primary key default gen_random_uuid(),
  edition_id        uuid not null references editions (id) on delete cascade,
  -- The number the student shows at the desk.
  seq               bigint generated always as identity,
  -- The student's own status page (/interviews/w/<link>/r/<request_token>);
  -- made by the app, like every token here.
  request_token     text not null unique,
  company_id        uuid not null references companies (id) on delete cascade,
  -- The edition's "today" when the request was made.
  day               date not null,

  -- What the form said, in applications' columns.
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
  locale            text not null default 'ar' check (locale in ('ar', 'en')),
  cv_path           text not null,

  status            text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  application_id    uuid references applications (id) on delete set null,
  booking_id        uuid references bookings (id) on delete set null,
  decided_at        timestamptz,
  decided_by        text,
  decision_note     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists walkin_requests_queue_idx on walkin_requests (edition_id, status, created_at);
-- One request waiting per student at a time.
create unique index if not exists walkin_requests_one_pending
  on walkin_requests (edition_id, email) where status = 'pending';

alter table walkin_requests enable row level security;

drop trigger if exists walkin_requests_touch on walkin_requests;
create trigger walkin_requests_touch before update on walkin_requests
  for each row execute function app.touch_updated_at();
drop trigger if exists walkin_requests_audit on walkin_requests;
create trigger walkin_requests_audit after insert or update or delete on walkin_requests
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Today on the edition's clock.
create or replace function app.edition_today(p_edition uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone coalesce((select time_zone from editions where id = p_edition), 'Asia/Riyadh'))::date
$$;

-- The edition a walk-in link belongs to.
create or replace function app.edition_by_walkin_token(p_token text)
returns editions
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  e editions;
begin
  if coalesce(p_token, '') = '' then
    perform app.refuse('bad_link', 'This link is not recognised.');
  end if;
  select * into e from editions where settings ->> 'walkin_token' = p_token limit 1;
  if e.id is null then
    perform app.refuse('bad_link', 'This link is not recognised.');
  end if;
  return e;
end;
$$;

-- The free times a walk-in can be given right now.
create or replace function public.walkin_slots(p_edition uuid)
returns table (slot_id uuid, company_id uuid, room_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with st as (
    select coalesce(app.edition_settings(p_edition) -> 'walkins_off_companies', '[]'::jsonb) as off
  )
  select s.id, s.company_id, s.room_id, s.starts_at, s.ends_at
    from slots s
    join sessions se on se.id = s.session_id
    join companies c on c.id = s.company_id
    cross join st
   where s.edition_id = p_edition
     and se.day = app.edition_today(p_edition)
     and s.starts_at > now()
     and not s.is_closed
     and not c.is_hidden
     and not (jsonb_typeof(st.off) = 'array' and st.off ? c.id::text)
     and not exists (select 1 from bookings b where b.slot_id = s.id and b.cancelled_at is null)
   order by s.starts_at
$$;

-- ---------------------------------------------------------------------------
-- The public form
-- ---------------------------------------------------------------------------

-- p_payload: name, email, phone, the apply form's answers, company_id,
-- cv_path, locale. Returns {id, seq, request_token}.
create or replace function public.submit_walkin(p_token text, p_payload jsonb, p_request_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e          editions;
  v_email    citext;
  v_name     text;
  v_cv       text;
  v_company  uuid;
  v_app      applications;
  r          walkin_requests;
begin
  e := app.edition_by_walkin_token(p_token);
  if e.status = 'archived' then
    perform app.refuse('archived', 'This edition is archived and read-only.');
  end if;
  if coalesce(app.edition_settings(e.id) ->> 'walkins_open', 'false') <> 'true' then
    perform app.refuse('walkins_closed', 'Walk-in registration is closed right now.');
  end if;

  v_email := lower(btrim(coalesce(p_payload ->> 'email', '')));
  v_name  := btrim(coalesce(p_payload ->> 'name', ''));
  if v_email = '' or v_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    perform app.refuse('invalid_email', 'Enter a valid email address.');
  end if;
  if v_name = '' then
    perform app.refuse('missing_name', 'Enter your name.');
  end if;
  v_cv := nullif(p_payload ->> 'cv_path', '');
  if v_cv is null then
    perform app.refuse('missing_cv', 'Attach your CV as a PDF.');
  end if;

  begin
    v_company := nullif(p_payload ->> 'company_id', '')::uuid;
  exception when invalid_text_representation then
    v_company := null;
  end;
  if v_company is null then
    perform app.refuse('no_preferences', 'Choose a company.');
  end if;
  if not exists (select 1 from companies c where c.id = v_company and c.edition_id = e.id and not c.is_hidden) then
    perform app.refuse('unknown_company', 'That company is not available.');
  end if;
  if not exists (select 1 from public.walkin_slots(e.id) w where w.company_id = v_company) then
    perform app.refuse('no_walkin_slots', 'That company has no free time left today. Choose another.');
  end if;

  select * into v_app from applications where edition_id = e.id and email = v_email;
  if v_app.id is not null and exists (
       select 1 from bookings b
        where b.application_id = v_app.id and b.company_id = v_company and b.cancelled_at is null) then
    perform app.refuse('walkin_already_booked',
      'You already have an interview with this company. Go to the reception desk.');
  end if;
  if exists (select 1 from walkin_requests w
              where w.edition_id = e.id and w.email = v_email and w.status = 'pending') then
    perform app.refuse('walkin_pending', 'You already have a request waiting at the reception desk.');
  end if;

  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', v_app.id, 'name', v_name));

  begin
    insert into walkin_requests
      (edition_id, request_token, company_id, day, email, phone, name, is_club_member,
       university, university_other, level, college, major, gpa, english_level, why_first,
       locale, cv_path)
    values
      (e.id, p_request_token, v_company, app.edition_today(e.id), v_email,
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
       v_cv)
    returning * into r;
  exception when unique_violation then
    -- A double tap: the first one is already waiting.
    perform app.refuse('walkin_pending', 'You already have a request waiting at the reception desk.');
  end;

  return jsonb_build_object('id', r.id, 'seq', r.seq, 'request_token', r.request_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reception
-- ---------------------------------------------------------------------------

-- p_token: a personal token for the application, used only if one has to be
-- made. Returns the request, now confirmed, with its application and booking.
create or replace function public.confirm_walkin(p_request uuid, p_slot uuid, p_token text, p_actor jsonb)
returns walkin_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       walkin_requests;
  sl      slots;
  v_app   applications;
  v_rank  integer;
  b       bookings;
  v_name  text := coalesce(p_actor ->> 'name', 'staff');
begin
  perform app.set_actor(p_actor);

  select * into r from walkin_requests where id = p_request for update;
  if r.id is null then
    perform app.refuse('not_found', 'No such walk-in request.');
  end if;
  if r.status <> 'pending' then
    perform app.refuse('walkin_not_pending', 'This request was already handled.');
  end if;
  perform app.live_edition(r.edition_id);

  select * into sl from slots where id = p_slot and edition_id = r.edition_id;
  if sl.id is null then
    perform app.refuse('not_found', 'That slot does not exist.');
  end if;
  if sl.company_id <> r.company_id then
    perform app.refuse('other_company', 'That time belongs to another company.');
  end if;
  if sl.is_closed then
    perform app.refuse('slot_closed', 'That slot is not available.');
  end if;
  if sl.starts_at <= now() then
    perform app.refuse('slot_past', 'That time has already passed.');
  end if;
  if (select se.day from sessions se where se.id = sl.session_id) <> app.edition_today(r.edition_id) then
    perform app.refuse('not_today', 'A walk-in is given a time today.');
  end if;

  -- The student: their own application (same email), else a phone-only one
  -- from HR's list (0013), else a new one. Nothing on file is overwritten;
  -- only blanks are filled.
  select * into v_app from applications
   where edition_id = r.edition_id and email = r.email
   for update;
  if v_app.id is null and r.phone is not null then
    select * into v_app from applications a
     where a.edition_id = r.edition_id and a.email is null and a.phone is not null
       and app.normalise_phone(a.phone) = app.normalise_phone(r.phone)
     order by a.submitted_at desc
     limit 1
     for update;
  end if;

  if v_app.id is null then
    insert into applications
      (edition_id, email, phone, name, is_club_member, university, university_other,
       level, college, major, gpa, english_level, why_first, locale, cv_path, personal_token)
    values
      (r.edition_id, r.email, r.phone, r.name, r.is_club_member, r.university, r.university_other,
       r.level, r.college, r.major, r.gpa, r.english_level, r.why_first, r.locale, r.cv_path, p_token)
    returning * into v_app;
  else
    update applications a
       set email            = coalesce(a.email, r.email),
           name             = case when btrim(a.name) = '' then r.name else a.name end,
           phone            = coalesce(a.phone, r.phone),
           is_club_member   = coalesce(a.is_club_member, r.is_club_member),
           university       = coalesce(a.university, r.university),
           university_other = coalesce(a.university_other, r.university_other),
           level            = coalesce(a.level, r.level),
           college          = coalesce(a.college, r.college),
           major            = coalesce(a.major, r.major),
           gpa              = coalesce(a.gpa, r.gpa),
           english_level    = coalesce(a.english_level, r.english_level),
           why_first        = coalesce(a.why_first, r.why_first),
           cv_path          = coalesce(a.cv_path, r.cv_path)
     where a.id = v_app.id
     returning * into v_app;
  end if;

  -- Accepted for this company: the student's own preference if they chose
  -- it online (whatever HR decided then), else a new one after theirs.
  select coalesce(max(rank), 0) + 1 into v_rank
    from application_preferences where application_id = v_app.id;
  insert into application_preferences
    (edition_id, application_id, company_id, rank, decision, decided_at, decision_note)
  values
    (r.edition_id, v_app.id, r.company_id, v_rank, 'accepted', now(), 'Walk-in')
  on conflict (application_id, company_id) do update
    set decision      = 'accepted',
        decided_at    = case when application_preferences.decision = 'accepted'
                             then application_preferences.decided_at else now() end,
        decision_note = case when application_preferences.decision = 'accepted'
                             then application_preferences.decision_note else 'Walk-in' end;

  -- The booking, with the constraint violations turned into sentences, and
  -- checked in: they are standing at the desk.
  b := app.do_book(v_app, sl.id, 'staff');
  update bookings
     set stage            = 'arrived',
         arrived_at       = now(),
         stage_changed_at = now(),
         stage_changed_by = v_name
   where id = b.id
   returning * into b;

  update walkin_requests
     set status         = 'confirmed',
         application_id = v_app.id,
         booking_id     = b.id,
         decided_at     = now(),
         decided_by     = v_name,
         decision_note  = null
   where id = r.id
   returning * into r;

  return r;
end;
$$;

create or replace function public.reject_walkin(p_request uuid, p_note text, p_actor jsonb)
returns walkin_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r walkin_requests;
begin
  perform app.set_actor(p_actor);
  select * into r from walkin_requests where id = p_request for update;
  if r.id is null then
    perform app.refuse('not_found', 'No such walk-in request.');
  end if;
  if r.status <> 'pending' then
    perform app.refuse('walkin_not_pending', 'This request was already handled.');
  end if;
  perform app.live_edition(r.edition_id);

  update walkin_requests
     set status        = 'rejected',
         decided_at    = now(),
         decided_by    = coalesce(p_actor ->> 'name', 'staff'),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id
   returning * into r;
  return r;
end;
$$;

-- Undo. A confirmed request's booking is cancelled, unless the interview
-- has started; the acceptance for the company stays, so it can be confirmed
-- again at another time. A rejected request simply waits again.
create or replace function public.reopen_walkin(p_request uuid, p_actor jsonb)
returns walkin_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r walkin_requests;
  b bookings;
begin
  perform app.set_actor(p_actor);
  select * into r from walkin_requests where id = p_request for update;
  if r.id is null then
    perform app.refuse('not_found', 'No such walk-in request.');
  end if;
  perform app.live_edition(r.edition_id);
  if r.status = 'pending' then
    return r;
  end if;

  if r.status = 'confirmed' and r.booking_id is not null then
    select * into b from bookings where id = r.booking_id and cancelled_at is null for update;
    if b.id is not null then
      if b.stage in ('in_interview', 'done') then
        perform app.refuse('not_scheduled', 'This interview has happened; it cannot be undone.');
      end if;
      update bookings
         set cancelled_at      = now(),
             cancelled_by_kind = 'staff',
             cancel_reason     = 'Walk-in reopened at reception'
       where id = b.id;
    end if;
  end if;

  begin
    update walkin_requests
       set status        = 'pending',
           booking_id    = null,
           decided_at    = null,
           decided_by    = null,
           decision_note = null
     where id = r.id
     returning * into r;
  exception when unique_violation then
    perform app.refuse('walkin_pending', 'This student already has another request waiting.');
  end;
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- The export carries walk-ins (and 0014's acceptances). 0003's body, with
-- the two lines added at the end of the object.
-- ---------------------------------------------------------------------------

create or replace function public.edition_snapshot(p_edition uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'taken_at',     now(),
    'edition',      (select to_jsonb(e) from editions e where e.id = p_edition),
    'rooms',        (select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.name), '[]'::jsonb) from rooms r where r.edition_id = p_edition),
    'companies',    (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order, c.name_en), '[]'::jsonb) from companies c where c.edition_id = p_edition),
    'applications', (select coalesce(jsonb_agg(to_jsonb(a) order by a.submitted_at), '[]'::jsonb) from applications a where a.edition_id = p_edition),
    'preferences',  (select coalesce(jsonb_agg(to_jsonb(p) order by p.application_id, p.rank), '[]'::jsonb) from application_preferences p where p.edition_id = p_edition),
    'sessions',     (select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at), '[]'::jsonb) from sessions s where s.edition_id = p_edition),
    'slots',        (select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at), '[]'::jsonb) from slots s where s.edition_id = p_edition),
    'bookings',     (select coalesce(jsonb_agg(to_jsonb(b) order by b.starts_at), '[]'::jsonb) from bookings b where b.edition_id = p_edition),
    'feedback',     (select coalesce(jsonb_agg(to_jsonb(f) order by f.submitted_at), '[]'::jsonb) from feedback f where f.edition_id = p_edition),
    'emails',       (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) from email_outbox m where m.edition_id = p_edition),
    'audit_log',    (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb) from audit_log l where l.edition_id = p_edition),
    'session_acceptances', (select coalesce(jsonb_agg(to_jsonb(x) order by x.accepted_at), '[]'::jsonb) from session_acceptances x where x.edition_id = p_edition),
    'walkin_requests',     (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at), '[]'::jsonb) from walkin_requests w where w.edition_id = p_edition)
  )
$$;

-- ---------------------------------------------------------------------------
-- Grants (0004): the service role only.
-- ---------------------------------------------------------------------------

revoke all on function public.walkin_slots(uuid) from public;
revoke all on function public.submit_walkin(text, jsonb, text) from public;
revoke all on function public.confirm_walkin(uuid, uuid, text, jsonb) from public;
revoke all on function public.reject_walkin(uuid, text, jsonb) from public;
revoke all on function public.reopen_walkin(uuid, jsonb) from public;
do $$
declare
  r text;
begin
  -- 0004's default privileges already keep the API roles out; said again for
  -- this table so the file stands on its own.
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table walkin_requests from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table walkin_requests to service_role;
    grant execute on function public.walkin_slots(uuid) to service_role;
    grant execute on function public.submit_walkin(text, jsonb, text) to service_role;
    grant execute on function public.confirm_walkin(uuid, uuid, text, jsonb) to service_role;
    grant execute on function public.reject_walkin(uuid, text, jsonb) to service_role;
    grant execute on function public.reopen_walkin(uuid, jsonb) to service_role;
    grant execute on function public.edition_snapshot(uuid) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
