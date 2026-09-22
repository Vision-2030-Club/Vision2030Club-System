-- =============================================================================
-- 0009 — The room flow, made safe enough for a real event.
--
-- 0005 keyed candidates on a bare phone number, 0008 let anyone book a time
-- that had already passed. Reviewed together, four things needed changing
-- before either could run on the live edition:
--
--   1. Phone numbers are NORMALISED before they are stored or compared.
--      "+966 50 123 4567", "00966501234567" and "0501234567" are one number;
--      HR pastes whatever format their list came in, and a candidate types
--      whatever their phone autofills. Comparing raw strings sent real
--      accepted candidates away with "not accepted yet".
--
--   2. The phone index is no longer UNIQUE. The apply form (0001) never
--      promised one application per phone — two siblings sharing a family
--      number, a typo, the April 2026 import — and a unique index would have
--      turned the next such case into a raw database error on the apply
--      form, or stopped 0005 from applying at all. Lookups by phone instead
--      prefer the fullest record (one with an email) and then the newest.
--
--   3. room_login can no longer take over somebody else's application. It
--      used to overwrite the name and CV of whichever row matched the phone,
--      and hand out that row's personal token — so anyone who knew a
--      classmate's number could rename them, replace their CV and cancel
--      their interview. Now an application that came through the apply form
--      (it has an email) is off limits to the phone-only door: the person is
--      told to use their personal link. A row HR created from a phone list
--      is still reachable by phone, which is that list's whole purpose; its
--      name is filled in only while blank, and its CV only while missing.
--
--   4. book_slot and move_booking refuse a past time again — for ACTIVE and
--      archived editions. A DRAFT edition is where rooms are tried out
--      against today's date (0008's reason for dropping the rule), so the
--      clock is ignored there. Set the edition active for the event and the
--      rule is back without a deploy.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. One spelling per phone number.
-- ---------------------------------------------------------------------------

create or replace function app.normalise_phone(p_phone text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  with digits as (
    select regexp_replace(p_phone, '\D', '', 'g') as d
  ),
  stripped as (
    -- 00966…, +966… and 966… all mean a Saudi number written internationally.
    select case
             when d like '00966%' and length(d) = 14 then '0' || substr(d, 6)
             when d like '966%'   and length(d) = 12 then '0' || substr(d, 4)
             when d like '5%'     and length(d) = 9  then '0' || d
             else d
           end as d
      from digits
  )
  select nullif(d, '') from stripped
$$;

drop index if exists applications_edition_phone_uidx;
create index if not exists applications_edition_phone_idx
  on applications (edition_id, app.normalise_phone(phone))
  where phone is not null;

-- Existing rows keep the spelling they arrived with; the index above compares
-- them normalised, so nothing has to be rewritten to match.

-- The one application a phone number means in an edition: the fullest record
-- first (an email means it came through the apply form), then the newest.
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
   order by (a.email is not null) desc, a.created_at desc
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 2. HR's list, compared and stored normalised.
-- ---------------------------------------------------------------------------

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
  v_phone  text := app.normalise_phone(coalesce(p_phone, ''));
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

  v_app := app.application_by_phone(p_edition, v_phone);

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
declare
  v_app applications;
begin
  perform app.set_actor(p_actor);
  v_app := app.application_by_phone(p_edition, coalesce(p_phone, ''));
  if v_app.id is null then
    return;
  end if;
  update application_preferences
     set decision = 'pending', decided_at = null
   where application_id = v_app.id
     and company_id = p_company;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The room door, unable to take over a form applicant's record.
-- ---------------------------------------------------------------------------

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
  c          companies;
  e          editions;
  v_name     text := btrim(coalesce(p_name, ''));
  v_phone    text := app.normalise_phone(coalesce(p_phone, ''));
  v_app      applications;
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

  v_app := app.application_by_phone(c.edition_id, v_phone);

  if v_app.id is null then
    insert into applications (edition_id, phone, name, cv_path, personal_token, source)
    values (c.edition_id, v_phone, v_name, nullif(p_cv, ''), p_new_token, 'form')
    returning * into v_app;
  elsif v_app.email is not null then
    -- Came through the apply form: their personal link is their identity,
    -- and a phone number typed at a public door must not stand in for it.
    perform app.refuse('use_personal_link',
      'You applied with your email. Use the personal link you were given.');
  else
    update applications
       set name    = case when name = '' then v_name else name end,
           cv_path = coalesce(cv_path, nullif(p_cv, ''))
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

-- ---------------------------------------------------------------------------
-- 4. The clock applies again, except while an edition is still a draft.
-- ---------------------------------------------------------------------------

create or replace function app.refuse_past_slot(e editions, p_slot uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  sl slots;
begin
  if e.status = 'draft' then
    return;
  end if;
  select * into sl from slots where id = p_slot;
  if sl.id is not null and sl.starts_at <= now() then
    perform app.refuse('slot_past', 'That time has already passed.');
  end if;
end;
$$;

create or replace function public.book_slot(p_token text, p_slot uuid)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a  applications;
  e  editions;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));
  perform app.refuse_past_slot(e, p_slot);

  return app.do_book(a, p_slot, 'student');
end;
$$;

create or replace function public.move_booking(p_token text, p_booking uuid, p_slot uuid)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a  applications;
  e  editions;
  b  bookings;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));

  select * into b from bookings where id = p_booking and application_id = a.id and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'That booking is not yours, or was cancelled.');
  end if;
  perform app.within_cutoff(e, b.starts_at);
  perform app.refuse_past_slot(e, p_slot);

  return app.do_move(b, p_slot, 'student');
end;
$$;
