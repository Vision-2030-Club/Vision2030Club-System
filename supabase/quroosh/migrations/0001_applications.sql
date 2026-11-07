-- =============================================================================
-- Quroosh (قروش) database — 0001: applying to the programme.
--
-- This is the QUROOSH database, a separate Supabase project, as Mock
-- Interviews has its own (supabase/interviews). The club database decides
-- who may open the Quroosh component and as what (club 0074,
-- `my_component_access`); this database never checks identity. Only the
-- app's server talks to it, with the project's secret key:
--
--   - Row Level Security is on for every table and there are NO policies,
--     so the publishable key and signed-in sessions read and write nothing.
--   - Every function is executable by service_role only.
--   - Who changed a setting is recorded (updated_by: a club member id,
--     passed in by the app after the club database said they manage the
--     project).
--
-- Founders apply on the public page /quroosh/apply/<club project id>. The
-- questions are the club's "أسئلة التسجيل في قروش 2026" with the changes
-- asked for on 2026-11-07 (see docs/quroosh.md); the CHECK constraints below
-- must stay in step with src/lib/quroosh/questions.ts.
--
-- Tables:
--   settings             one per club project that runs Quroosh: is the form
--                        open, the privacy notice link
--   applications         one per founder phone per project
--   application_members  the other members of a founder's team
--
-- Nothing is deleted. Safe to re-run.
-- =============================================================================

create schema if not exists app;

-- A refusal the app can translate: the HINT names it (as in the interviews
-- database).
create or replace function app.refuse(p_hint text, p_message text)
returns void
language plpgsql
as $$
begin
  raise exception '%', p_message using hint = p_hint, errcode = 'P0001';
end;
$$;

-- Saudi mobile numbers to +9665XXXXXXXX: the club database's normaliser
-- (club 0022), copied so both databases store phones the same way.
create or replace function app.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  with cleaned as (
    -- Separators only. Digits and a leading '+' are all that survives.
    select regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g') as v
  )
  select case
    when v = ''                     then null
    when v ~ '^\+9665[0-9]{8}$'     then v
    when v ~ '^009665[0-9]{8}$'     then '+' || substring(v from 3)
    when v ~ '^9665[0-9]{8}$'       then '+' || v
    when v ~ '^05[0-9]{8}$'         then '+966' || substring(v from 2)
    when v ~ '^5[0-9]{8}$'          then '+966' || v
    else v                          -- left as-is, for the CHECK to reject
  end
  from cleaned;
$$;

create or replace function app.normalize_phone_column()
returns trigger
language plpgsql
as $$
begin
  new.phone := app.normalize_phone(new.phone);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Settings: one row per club project. The row is what makes a project's
-- form exist; the app creates it when a manager first saves the settings.
-- -----------------------------------------------------------------------------

create table if not exists settings (
  project_id         uuid primary key,          -- the club database's projects.id
  applications_open  boolean not null default false,
  privacy_url        text check (privacy_url is null or privacy_url ~ '^https?://'),
  updated_at         timestamptz not null default now(),
  updated_by         uuid                       -- the club member who changed it
);

comment on table settings is
  'Per club project running Quroosh: whether the public form takes answers, and its privacy notice link.';

-- -----------------------------------------------------------------------------
-- Applications
-- -----------------------------------------------------------------------------

create table if not exists applications (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references settings (project_id),
  created_at           timestamptz not null default now(),

  -- The lead founder, who attends the programme.
  founder_name         text not null check (char_length(founder_name) between 1 and 200),
  email                text not null check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                text not null check (phone ~ '^\+9665[0-9]{8}$'),
  university_relation  text check (university_relation is null or university_relation in
                         ('current_student', 'postgraduate', 'graduate', 'left_university',
                          'no_university', 'faculty')),
  university           text not null check (char_length(university) between 1 and 200),
  age_band             text not null check (age_band in ('under_18', '18_30', 'over_30')),

  -- The startup.
  stage                text not null check (stage in
                         ('idea', 'prototype', 'users', 'paying', 'recurring')),
  commitment           text not null check (commitment in ('all_days', 'limited_conflict', 'cannot')),
  venture_name         text not null check (char_length(venture_name) between 1 and 200),
  problem              text not null check (char_length(problem) between 1 and 2000),
  pitch                text not null check (char_length(pitch) between 1 and 3000),
  sector               text not null check (sector in
                         ('fintech', 'health', 'education', 'tourism', 'energy', 'industry',
                          'retail', 'housing', 'agriculture', 'none')),

  -- The team.
  has_team             boolean not null,
  team_experience      text check (team_experience is null or char_length(team_experience) <= 3000),

  -- The market and the evidence.
  link_url             text check (link_url is null or (link_url ~ '^https?://' and char_length(link_url) <= 1000)),
  customer             text not null check (char_length(customer) between 1 and 2000),
  customer_problem     text not null check (char_length(customer_problem) between 1 and 3000),
  competitor           text not null check (char_length(competitor) between 1 and 2000),
  evidence             text not null check (char_length(evidence) between 1 and 3000),
  research             text not null check (char_length(research) between 1 and 3000),
  revenue_model        text not null check (char_length(revenue_model) between 1 and 2000),
  funding              text[] not null check (
                         cardinality(funding) >= 1
                         and funding <@ array['none', 'founders_family', 'grant',
                                              'investors_under_1m', 'investors_1m_plus']
                         and (not 'none' = any (funding) or cardinality(funding) = 1)),

  -- Quroosh itself.
  wants                text[] not null check (
                         cardinality(wants) between 1 and 2
                         and wants <@ array['investor_prep', 'customers_pilot', 'partners_suppliers',
                                            'non_dilutive', 'go_to_market', 'exposure']),
  heard_from           text not null check (heard_from in
                         ('social', 'event', 'whatsapp', 'creator', 'referral', 'search',
                          'partner', 'other', 'university')),
  conflict_of_interest boolean not null,
  declaration          boolean not null check (declaration),
  data_consent         boolean not null check (data_consent),
  filming_consent      boolean not null,

  -- One application per founder per project: a second one from the same
  -- phone is refused (apply() says so in words).
  unique (project_id, phone)
);

comment on table applications is
  'One founder''s application to a Quroosh project, from the public form. Personal data: the app shows it to the project''s managers only.';

create index if not exists applications_project_idx on applications (project_id, created_at desc);

create table if not exists application_members (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications (id) on delete cascade,
  sort_order      int not null default 0,
  name            text not null check (char_length(name) between 1 and 200),
  phone           text not null check (phone ~ '^\+9665[0-9]{8}$'),
  email           text not null check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table application_members is
  'The other members of an applying team, besides the lead founder.';

create index if not exists application_members_app_idx on application_members (application_id, sort_order);

drop trigger if exists applications_phone on applications;
create trigger applications_phone
  before insert or update of phone on applications
  for each row execute function app.normalize_phone_column();

drop trigger if exists application_members_phone on application_members;
create trigger application_members_phone
  before insert or update of phone on application_members
  for each row execute function app.normalize_phone_column();

-- Deny-all: RLS on, no policies. Only the secret key (service_role) gets in.
alter table settings            enable row level security;
alter table applications        enable row level security;
alter table application_members enable row level security;

-- -----------------------------------------------------------------------------
-- Functions the app calls
-- -----------------------------------------------------------------------------

-- The public form's state. No row: the project has no Quroosh form.
create or replace function public.application_form(p_project uuid)
returns table (applications_open boolean, privacy_url text)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.applications_open, s.privacy_url from settings s where s.project_id = p_project;
$$;

-- A manager's change to the settings. The app has already asked the club
-- database that p_actor manages p_project. Null leaves a value as it is;
-- p_privacy_url = '' clears the link.
create or replace function public.save_settings(
  p_project uuid,
  p_actor uuid,
  p_open boolean default null,
  p_privacy_url text default null
)
returns settings
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v settings;
begin
  insert into settings (project_id, applications_open, privacy_url, updated_at, updated_by)
  values (p_project, coalesce(p_open, false), nullif(p_privacy_url, ''), now(), p_actor)
  on conflict (project_id) do update
     set applications_open = coalesce(p_open, settings.applications_open),
         privacy_url = case when p_privacy_url is null then settings.privacy_url
                            else nullif(p_privacy_url, '') end,
         updated_at = now(),
         updated_by = p_actor
  returning * into v;
  return v;
end;
$$;

-- Submits one application. p_application carries the answers by column
-- name; p_members the other team members as [{name, phone, email}, …].
-- The id, project and time are this function's, whatever the caller sends,
-- and every CHECK applies. Refusals carry a HINT the page translates.
create or replace function public.apply(
  p_project uuid,
  p_application jsonb,
  p_members jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_row  applications;
  v_id   uuid;
  v_open boolean;
  v_m    jsonb;
  v_i    int := 0;
begin
  select s.applications_open into v_open from settings s where s.project_id = p_project;
  if v_open is null then
    perform app.refuse('not_found', 'This form does not exist.');
  end if;
  if not v_open then
    perform app.refuse('applications_closed', 'Applications are closed.');
  end if;

  v_row := jsonb_populate_record(null::applications, p_application);
  v_row.id := gen_random_uuid();
  v_row.project_id := p_project;
  v_row.created_at := now();

  if jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array' then
    perform app.refuse('invalid', 'Team members must be a list.');
  end if;
  if v_row.has_team and jsonb_array_length(p_members) = 0 then
    perform app.refuse('team_members_missing', 'Add the other team members, or answer that there are none.');
  end if;
  if jsonb_array_length(p_members) > 10 then
    perform app.refuse('too_many_members', 'At most 10 other team members.');
  end if;

  begin
    insert into applications values (v_row.*) returning id into v_id;

    if v_row.has_team then
      for v_m in select * from jsonb_array_elements(p_members) loop
        insert into application_members (application_id, sort_order, name, phone, email)
        values (v_id, v_i, v_m ->> 'name', v_m ->> 'phone', v_m ->> 'email');
        v_i := v_i + 1;
      end loop;
    end if;
  exception
    when unique_violation then
      perform app.refuse('already_applied', 'An application from this phone number is already in.');
    -- A missing answer, an unknown option, a malformed phone or email: the
    -- constraint says which in the log; the applicant gets one message.
    when check_violation or not_null_violation then
      perform app.refuse('invalid', 'Some answers are missing or not valid: ' || sqlerrm);
  end;

  return v_id;
end;
$$;

-- Server only: nobody but the secret key runs these.
revoke execute on function public.application_form(uuid) from public, anon, authenticated;
revoke execute on function public.save_settings(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.apply(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.application_form(uuid) to service_role;
grant execute on function public.save_settings(uuid, uuid, boolean, text) to service_role;
grant execute on function public.apply(uuid, jsonb, jsonb) to service_role;
grant usage on schema app to service_role;

notify pgrst, 'reload schema';
