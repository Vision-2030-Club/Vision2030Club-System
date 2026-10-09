-- =============================================================================
-- 0013 — HR's accepted list takes any phone number.
--
-- The Companies tab's "Add phone numbers" used decide_preference (0001),
-- which only accepts a student for a company they chose on the form, and the
-- app could only match numbers that had applied. HR's list is the decision:
-- a number on it is accepted for that company, whether or not the student
-- chose it, and whether or not they ever filled in the form.
--
--   1. applications.email may be empty. A number HR adds that never applied
--      becomes an application with only a phone (name '' until the student
--      opens the company's candidate link and types it). The same change as
--      0005's first line, so running both is harmless. unique (edition_id,
--      email) still holds for every row that has one; enqueue_email (0001)
--      already skips a row without an email.
--
--   2. accept_for_company: accepts one application for one company. With no
--      application it creates the phone-only one first; with no preference
--      for that company it adds one after the student's own choices. The
--      app matches the number (normalisePhone in src/lib/interviews/phone.ts)
--      and passes the application it found, so this needs nothing from
--      0005–0009. The acceptance email is queued as decide_preference does.
--
-- Can be run twice. Nothing is deleted.
-- =============================================================================

alter table applications alter column email drop not null;

create or replace function public.accept_for_company(
  p_edition      uuid,
  p_company      uuid,
  p_application  uuid,
  p_phone        text,
  p_token        text,
  p_actor        jsonb
)
returns application_preferences
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app   applications;
  v_rank  integer;
  v_pref  application_preferences;
begin
  perform app.set_actor(p_actor);

  if not exists (select 1 from companies c where c.id = p_company and c.edition_id = p_edition) then
    perform app.refuse('not_found', 'No such company in this edition.');
  end if;

  if p_application is not null then
    select * into v_app from applications a where a.id = p_application and a.edition_id = p_edition;
    if v_app.id is null then
      perform app.refuse('not_found', 'No such application.');
    end if;
  else
    if nullif(btrim(coalesce(p_phone, '')), '') is null then
      perform app.refuse('missing_phone', 'Enter a phone number.');
    end if;
    insert into applications (edition_id, phone, name, personal_token)
    values (p_edition, btrim(p_phone), '', p_token)
    returning * into v_app;
  end if;

  update application_preferences ap
     set decision = 'accepted', decided_at = now()
   where ap.application_id = v_app.id and ap.company_id = p_company
   returning * into v_pref;

  if v_pref.id is null then
    select coalesce(max(rank), 0) + 1 into v_rank
      from application_preferences where application_id = v_app.id;
    insert into application_preferences (edition_id, application_id, company_id, rank, decision, decided_at)
    values (p_edition, v_app.id, p_company, v_rank, 'accepted', now())
    returning * into v_pref;
  end if;

  perform app.enqueue_email(
    p_edition, v_app.id, 'accepted',
    jsonb_build_object('application_id', v_app.id),
    'accepted:' || v_app.id::text);

  return v_pref;
end;
$$;
