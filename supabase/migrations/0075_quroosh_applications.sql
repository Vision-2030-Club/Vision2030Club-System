-- =============================================================================
-- 0075 — Quroosh (قروش): applying to the programme.
--
-- Founders apply on a public page (/quroosh/apply/<project id>) without an
-- account. The questions are the club's "أسئلة التسجيل في قروش 2026", with
-- the changes the club asked for on 2026-11-07:
--   - filming consent is required (an answer, yes or no; not a yes);
--   - the team's work experience is asked, optionally;
--   - "describe the startup in one sentence" became two questions: the
--     problem being solved, and the elevator pitch (under 100 seconds);
--   - market research, user testing or pilots to date is asked.
--
-- Three tables:
--   quroosh_settings            per project: is the form open, the privacy
--                               notice link
--   quroosh_applications        one per founder per project (by phone)
--   quroosh_application_members the other members of a founder's team
--
-- Applications hold personal data (names, phones, emails, ages), so only
-- the project's managers read them. Nobody writes them directly: the public
-- form calls quroosh_apply(), a definer function that checks the form is
-- open and inserts; the CHECK constraints below decide what is valid.
--
-- Nothing is deleted. Safe to re-run: tables and policies use if-not-exists
-- or drop-and-create, the function is replaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

create table if not exists quroosh_settings (
  project_id         uuid primary key references projects (id),
  applications_open  boolean not null default false,
  privacy_url        text check (privacy_url is null or privacy_url ~ '^https?://'),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references members (id)
);

comment on table quroosh_settings is
  'Per Quroosh project: whether the public application form takes answers, and the privacy notice it links to.';

alter table quroosh_settings enable row level security;

drop policy if exists quroosh_settings_select on quroosh_settings;
create policy quroosh_settings_select on quroosh_settings
  for select using ((select app.can_manage_project(project_id)));

drop policy if exists quroosh_settings_insert on quroosh_settings;
create policy quroosh_settings_insert on quroosh_settings
  for insert with check ((select app.can_manage_project(project_id)));

drop policy if exists quroosh_settings_update on quroosh_settings;
create policy quroosh_settings_update on quroosh_settings
  for update
  using ((select app.can_manage_project(project_id)))
  with check ((select app.can_manage_project(project_id)));

grant select, insert, update on quroosh_settings to authenticated;

-- -----------------------------------------------------------------------------
-- Applications
-- -----------------------------------------------------------------------------

create table if not exists quroosh_applications (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects (id),
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
  -- phone is refused (quroosh_apply says so in words).
  unique (project_id, phone)
);

comment on table quroosh_applications is
  'One founder''s application to a Quroosh project, from the public form (0075). Personal data: managers of the project only.';

create index if not exists quroosh_applications_project_idx
  on quroosh_applications (project_id, created_at desc);

create table if not exists quroosh_application_members (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references quroosh_applications (id) on delete cascade,
  sort_order      int not null default 0,
  name            text not null check (char_length(name) between 1 and 200),
  phone           text not null check (phone ~ '^\+9665[0-9]{8}$'),
  email           text not null check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table quroosh_application_members is
  'The other members of an applying team, besides the lead founder (0075).';

create index if not exists quroosh_application_members_app_idx
  on quroosh_application_members (application_id, sort_order);

-- Phones in the one stored form, +9665XXXXXXXX (0022's normaliser).
create or replace function app.quroosh_normalize_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone := app.normalize_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists quroosh_applications_phone on quroosh_applications;
create trigger quroosh_applications_phone
  before insert or update of phone on quroosh_applications
  for each row execute function app.quroosh_normalize_phone();

drop trigger if exists quroosh_application_members_phone on quroosh_application_members;
create trigger quroosh_application_members_phone
  before insert or update of phone on quroosh_application_members
  for each row execute function app.quroosh_normalize_phone();

alter table quroosh_applications        enable row level security;
alter table quroosh_application_members enable row level security;

-- Read: the project's managers. Write: nobody directly; see quroosh_apply.
drop policy if exists quroosh_applications_select on quroosh_applications;
create policy quroosh_applications_select on quroosh_applications
  for select using ((select app.can_manage_project(project_id)));

drop policy if exists quroosh_application_members_select on quroosh_application_members;
create policy quroosh_application_members_select on quroosh_application_members
  for select using (
    exists (select 1 from quroosh_applications a
             where a.id = application_id
               and (select app.can_manage_project(a.project_id))));

grant select on quroosh_applications, quroosh_application_members to authenticated;

-- -----------------------------------------------------------------------------
-- The public form
-- -----------------------------------------------------------------------------

-- What the form page needs before anyone has applied: the project's name,
-- whether it takes answers, the privacy link. Nothing for a project that
-- does not carry Quroosh.
create or replace function public.quroosh_application_form(p_project uuid)
returns table (name_en text, name_ar text, applications_open boolean, privacy_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.name_en, p.name_ar,
         coalesce(s.applications_open, false),
         s.privacy_url
    from projects p
    join project_components pc
      on pc.project_id = p.id and pc.component_key = 'quroosh'
    left join quroosh_settings s on s.project_id = p.id
   where p.id = p_project;
$$;

comment on function public.quroosh_application_form(uuid) is
  'The public Quroosh form''s header: project name, open or closed, privacy link. Empty for a project without Quroosh.';

-- Submits one application. p_application carries the answers by column
-- name; p_members the other team members as [{name, phone, email}, …].
-- The id, project, time and every CHECK are the database's, whatever the
-- caller sends. Refusals carry a HINT the page translates.
create or replace function public.quroosh_apply(
  p_project uuid,
  p_application jsonb,
  p_members jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row  quroosh_applications;
  v_id   uuid;
  v_open boolean;
  v_m    jsonb;
  v_i    int := 0;
begin
  select f.applications_open into v_open from public.quroosh_application_form(p_project) f;
  if v_open is null then
    raise exception 'This form does not exist.' using hint = 'not_found', errcode = 'P0001';
  end if;
  if not v_open then
    raise exception 'Applications are closed.' using hint = 'applications_closed', errcode = 'P0001';
  end if;

  v_row := jsonb_populate_record(null::quroosh_applications, p_application);
  v_row.id := gen_random_uuid();
  v_row.project_id := p_project;
  v_row.created_at := now();

  if jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array' then
    raise exception 'Team members must be a list.' using hint = 'invalid', errcode = 'P0001';
  end if;
  if v_row.has_team and jsonb_array_length(p_members) = 0 then
    raise exception 'Add the other team members, or answer that there are none.'
      using hint = 'team_members_missing', errcode = 'P0001';
  end if;
  if jsonb_array_length(p_members) > 10 then
    raise exception 'At most 10 other team members.' using hint = 'too_many_members', errcode = 'P0001';
  end if;

  begin
    insert into quroosh_applications values (v_row.*) returning id into v_id;

    if v_row.has_team then
      for v_m in select * from jsonb_array_elements(p_members) loop
        insert into quroosh_application_members (application_id, sort_order, name, phone, email)
        values (v_id, v_i, v_m ->> 'name', v_m ->> 'phone', v_m ->> 'email');
        v_i := v_i + 1;
      end loop;
    end if;
  exception
    when unique_violation then
      raise exception 'An application from this phone number is already in.'
        using hint = 'already_applied', errcode = 'P0001';
    -- A missing answer, an unknown option, a malformed phone or email: the
    -- constraint says which in the log; the applicant gets one message.
    when check_violation or not_null_violation then
      raise exception 'Some answers are missing or not valid: %', sqlerrm
        using hint = 'invalid', errcode = 'P0001';
  end;

  return v_id;
end;
$$;

comment on function public.quroosh_apply(uuid, jsonb, jsonb) is
  'The public Quroosh form''s submit: checks the form is open, inserts the application and its team. Refusals carry a HINT.';

grant execute on function public.quroosh_application_form(uuid) to anon, authenticated, service_role;
grant execute on function public.quroosh_apply(uuid, jsonb, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
