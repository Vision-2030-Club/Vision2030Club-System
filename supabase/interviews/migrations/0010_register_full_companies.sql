-- =============================================================================
-- 0010 — Registering students: full companies, uploaded logos, and the
--        registrations Google Sheet.
--
--   1. A company can be marked FULL. It stays on every list (hiding it would
--      read as "pulled out" and detach it from the students who already chose
--      it), but nobody can choose it any more: the form greys it out and
--      submit_application refuses it. A student who chose it before it filled
--      keeps it on a re-submission.
--
--   2. Staff can register a student from the Register tab. submit_application
--      takes the staff member as p_actor, records them as the author, and lets
--      them register outside the public window (a walk-in, a late entry, a
--      draft edition being tried out). An archived edition still refuses.
--      The public form passes no actor and keeps the window exactly as before.
--
--   3. Logos can be uploaded instead of pasted as a URL. They live in a
--      PRIVATE `logos` bucket like everything else here; the app serves them
--      through /api/interviews/logo, so no storage policy is needed.
--
--   4. One registrations spreadsheet per edition, next to the floor sheet:
--      every submission is appended as a row. Its id is remembered here.
--
--   5. app.application_by_phone again, as 0009 now defines it (0009 read a
--      column that does not exist and was corrected in place). Repeated here
--      so a database where 0009's broken version somehow landed is fixed too.
--
-- Safe to re-run: every statement is `if not exists` / `create or replace`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Full companies.
-- ---------------------------------------------------------------------------

alter table companies add column if not exists is_full boolean not null default false;

create or replace function public.set_company_full(
  p_edition  uuid,
  p_company  uuid,
  p_full     boolean,
  p_actor    jsonb
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
  perform app.live_edition(p_edition);

  update companies
     set is_full = coalesce(p_full, false)
   where id = p_company and edition_id = p_edition
   returning * into v;

  if v.id is null then
    perform app.refuse('not_found', 'No such company.');
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Applying, with full companies refused and staff registration allowed.
--
-- The body is 0001's, with three changes marked "0010".
-- ---------------------------------------------------------------------------

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
  v_staff      boolean;
  i            integer;
begin
  select * into e from editions where id = p_edition;
  if e.id is null then
    perform app.refuse('not_found', 'No such edition.');
  end if;

  -- 0010: a signed-in staff member registering someone is the actor of the
  -- whole transaction and is not held to the public window.
  v_staff := coalesce(p_actor ->> 'kind', '') = 'member';
  if v_staff then
    perform app.set_actor(p_actor);
    if e.status = 'archived' then
      perform app.refuse('archived', 'This edition is archived and read-only.');
    end if;
  elsif e.status <> 'active'
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

  -- 0010: a full company cannot be newly chosen. One this student already
  -- held keeps its place, so fixing a typo does not cost them a company.
  if exists (
    select 1
      from companies c
     where c.id = any (v_prefs)
       and c.is_full
       and not exists (select 1 from application_preferences ap
                        where ap.application_id = v_existing.id and ap.company_id = c.id)
  ) then
    perform app.refuse('company_full', 'One of the chosen companies is full.');
  end if;

  if v_existing.id is not null then
    if exists (select 1 from application_preferences ap
                where ap.application_id = v_existing.id and ap.decision <> 'pending')
       or exists (select 1 from bookings b
                   where b.application_id = v_existing.id and b.cancelled_at is null) then
      perform app.refuse('already_reviewed',
        'This application has already been reviewed. Contact the club to change anything.');
    end if;

    -- The student is the actor of their own re-submission (0010: unless staff
    -- entered it, who stays the actor).
    if not v_staff then
      perform app.set_actor(jsonb_build_object('kind', 'student', 'id', v_existing.id, 'name', v_name));
    end if;

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

    if not v_staff then
      perform app.set_actor(jsonb_build_object('kind', 'student', 'id', v_id, 'name', v_name));
    end if;
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

-- ---------------------------------------------------------------------------
-- 3. The logos bucket. Private, images only, 1 MB. Guarded like 0004 so the
--    file also runs on a plain Postgres.
-- ---------------------------------------------------------------------------

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('logos', 'logos', false, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception
  when insufficient_privilege or undefined_table then
    raise warning
      'Could not create the logos bucket from SQL (%). Create a PRIVATE bucket named `logos` (1 MB, png/jpeg/webp/gif) in the dashboard.',
      sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. The registrations sheet, remembered the way 0006 remembers the floor's.
-- ---------------------------------------------------------------------------

alter table editions add column if not exists registrations_sheet_id  text;
alter table editions add column if not exists registrations_sheet_url text;

create or replace function public.set_registrations_sheet(
  p_edition    uuid,
  p_sheet_id   text,
  p_sheet_url  text
)
returns editions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v editions;
begin
  update editions
     set registrations_sheet_id = p_sheet_id, registrations_sheet_url = p_sheet_url
   where id = p_edition
   returning * into v;

  if v.id is null then
    perform app.refuse('not_found', 'No such edition.');
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The phone lookup, as corrected in 0009.
-- ---------------------------------------------------------------------------

create or replace function app.application_by_phone(p_edition uuid, p_phone text)
returns applications
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.*
    from applications a
   where a.edition_id = p_edition
     and a.phone is not null
     and app.normalise_phone(a.phone) = app.normalise_phone(p_phone)
   order by (a.email is not null) desc, a.submitted_at desc
   limit 1
$$;

-- 0004 revoked PUBLIC's default execute grant for future functions and gave
-- it to service_role; repeated here so this file stands on its own.
do $$
begin
  revoke all on function public.set_company_full(uuid, uuid, boolean, jsonb) from public;
  revoke all on function public.set_registrations_sheet(uuid, text, text) from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_company_full(uuid, uuid, boolean, jsonb) to service_role;
    grant execute on function public.set_registrations_sheet(uuid, text, text) to service_role;
    grant execute on function public.submit_application(uuid, jsonb, text, jsonb) to service_role;
  end if;
end
$$;

notify pgrst, 'reload schema';
