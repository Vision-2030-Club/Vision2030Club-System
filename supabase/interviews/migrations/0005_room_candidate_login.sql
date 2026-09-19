-- =============================================================================
-- 0005 — The simplified "room" flow: one link per company, phone as the key.
--
-- A room's public link lets a candidate identify themselves with just a name
-- and phone number (no email, no secret token to keep safe) and immediately
-- see whether HR already accepted them for that company. This sits ALONGSIDE
-- the existing apply/accept/book system — it does not replace it:
--
--   - `applications` gains a second way to be found: by (edition_id, phone),
--     not just (edition_id, email). Email stays optional.
--   - `companies.candidate_token` is a second, separate link from
--     `access_token` (which is the INTERVIEWER's link, unrelated to this).
--   - Booking itself is untouched: once room_login confirms someone is
--     accepted, the server sends them to their existing personal_token page
--     (/interviews/s/<token>), which already does everything — slots,
--     booking, moving, cancelling — for every company that accepted them.
--
-- Tokens are generated in the application layer, not with a database crypto
-- function (0001's comment on tokens.ts explains why: this project needs no
-- crypto extension). Every function below that can create a new applications
-- row therefore takes the token as a parameter, exactly like submit_application.
-- =============================================================================

alter table companies add column candidate_token text unique;

-- The room flow never collects an email; only phone does the identifying.
-- (edition_id, email) stays unique — multiple NULLs satisfy that on their own.
alter table applications alter column email drop not null;

-- A candidate is looked up by phone within one edition. Nulls (imported rows
-- with no phone on file) are excluded, so they never collide with each other.
create unique index applications_edition_phone_uidx
  on applications (edition_id, phone) where phone is not null;

-- Lets the room link's public page set a candidate_token at creation time —
-- the same way access_token already works. Update behaviour is unchanged.
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
       access_token, access_pin, candidate_token, import_ref)
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
       nullif(p_payload ->> 'candidate_token', ''),
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

-- -----------------------------------------------------------------------------
-- HR pre-approves a phone number for a company, ahead of the candidate ever
-- visiting the room link. This is the "already chosen by HR" list.
-- -----------------------------------------------------------------------------

create or replace function public.accept_phone(
  p_edition  uuid,
  p_company  uuid,
  p_phone    text,
  p_token    text,
  p_actor    jsonb
)
returns application_preferences
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone  text := nullif(btrim(p_phone), '');
  v_app    applications;
  v_rank   integer;
  v_pref   application_preferences;
begin
  perform app.set_actor(p_actor);

  if v_phone is null then
    perform app.refuse('missing_phone', 'Enter a phone number.');
  end if;
  if not exists (select 1 from companies c where c.id = p_company and c.edition_id = p_edition) then
    perform app.refuse('not_found', 'No such company in this edition.');
  end if;

  select * into v_app from applications where edition_id = p_edition and phone = v_phone;

  if v_app.id is null then
    insert into applications (edition_id, phone, name, personal_token, source)
    values (p_edition, v_phone, '', p_token, 'form')
    returning * into v_app;
  end if;

  select rank into v_rank
    from application_preferences
   where application_id = v_app.id and company_id = p_company;

  if v_rank is null then
    select coalesce(max(rank), 0) + 1 into v_rank
      from application_preferences where application_id = v_app.id;

    insert into application_preferences (edition_id, application_id, company_id, rank, decision, decided_at)
    values (p_edition, v_app.id, p_company, v_rank, 'accepted', now())
    returning * into v_pref;
  else
    update application_preferences
       set decision = 'accepted', decided_at = now()
     where application_id = v_app.id and company_id = p_company
     returning * into v_pref;
  end if;

  return v_pref;
end;
$$;

-- Withdraws a phone number HR had accepted (typo, changed mind). The
-- application row itself is left alone — it may hold other companies.
create or replace function public.unaccept_phone(
  p_edition  uuid,
  p_company  uuid,
  p_phone    text,
  p_actor    jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.set_actor(p_actor);
  update application_preferences ap
     set decision = 'pending', decided_at = null
    from applications a
   where a.id = ap.application_id
     and a.edition_id = p_edition
     and a.phone = nullif(btrim(p_phone), '')
     and ap.company_id = p_company;
end;
$$;

-- The phone numbers already accepted for one company, for the admin list.
create or replace function public.accepted_phones(p_company uuid)
returns table (phone text, name text, decided_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.phone, a.name, ap.decided_at
    from application_preferences ap
    join applications a on a.id = ap.application_id
   where ap.company_id = p_company and ap.decision = 'accepted'
   order by ap.decided_at desc nulls last
$$;

-- -----------------------------------------------------------------------------
-- The room link itself: resolve the token, identify the candidate by phone,
-- record their name and CV, and report whether they are accepted HERE.
-- -----------------------------------------------------------------------------

create or replace function public.room_login(
  p_room_token  text,
  p_name        text,
  p_phone       text,
  p_cv          text,
  p_new_token   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c        companies;
  e        editions;
  v_name   text := btrim(coalesce(p_name, ''));
  v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
  v_app    applications;
  v_accepted boolean;
begin
  select * into c from companies where candidate_token = p_room_token;
  if c.id is null then
    perform app.refuse('bad_link', 'This link is not recognised.');
  end if;

  select * into e from editions where id = c.edition_id;
  if e.id is null or e.status = 'archived' then
    perform app.refuse('closed', 'This room is no longer open.');
  end if;

  if v_name = '' then
    perform app.refuse('missing_name', 'Enter your name.');
  end if;
  if v_phone is null then
    perform app.refuse('missing_phone', 'Enter your phone number.');
  end if;

  perform app.set_actor(jsonb_build_object('kind', 'student', 'name', v_name));

  select * into v_app from applications where edition_id = c.edition_id and phone = v_phone;

  if v_app.id is null then
    insert into applications (edition_id, phone, name, cv_path, personal_token, source)
    values (c.edition_id, v_phone, v_name, nullif(p_cv, ''), p_new_token, 'form')
    returning * into v_app;
  else
    update applications
       set name    = v_name,
           cv_path = coalesce(nullif(p_cv, ''), cv_path)
     where id = v_app.id
     returning * into v_app;
  end if;

  select exists (
    select 1 from application_preferences ap
     where ap.application_id = v_app.id and ap.company_id = c.id and ap.decision = 'accepted'
  ) into v_accepted;

  return jsonb_build_object(
    'personal_token', v_app.personal_token,
    'accepted',       v_accepted
  );
end;
$$;
