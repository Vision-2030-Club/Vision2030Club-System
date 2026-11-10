-- =============================================================================
-- Quroosh database — 0004: the managers edit the application's questions.
--
-- Asked for on 2026-11-10: a project's managers add questions to the public
-- form and edit the existing ones (wording in both languages, help line,
-- required or not, the choices, the section and the order) from the
-- Applications page. Nothing is ever removed: a question, or one of its
-- choices, is HIDDEN instead, so every past answer stays readable.
--
-- How it is stored:
--
--   questions            one row per question a manager has touched, per
--                        project. The form's own questions (the columns of
--                        `applications`, listed in src/lib/quroosh/questions.ts)
--                        need no row until they are edited: the app merges
--                        these rows over its list. Questions a manager adds
--                        exist only here (builtin = false).
--   applications.answers the answers to added questions, keyed by the
--                        question's `key`.
--
-- Answers are stored by the question's key and by the choice's value, never
-- by their wording, so editing a question's text or a choice's label changes
-- how every past application reads, on the Applications page and in the
-- Google Sheet (the app rewrites the sheet after each edit).
--
-- What moves from the database to the app: which questions are required,
-- and which choices are allowed, now depend on the project's edits, so the
-- app's server checks them against the merged list before calling apply().
-- That is why the CHECK lists of choices and the NOT NULLs of the questions
-- a manager may hide are relaxed below. The shapes stay in the database:
-- phone and email formats, lengths, one application per phone, the team.
-- The lead founder's name, email, phone and the data consent cannot be
-- hidden or made optional (the app refuses), and keep their NOT NULL.
--
-- Nothing is deleted. Safe to re-run.
-- =============================================================================

create table if not exists questions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references settings (project_id),
  -- The form's own questions use their column name; added ones get c_… .
  key         text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  section     text not null check (section in ('founder', 'startup', 'team', 'market', 'quroosh', 'consent')),
  sort_order  int not null default 0,
  kind        text not null check (kind in
                ('text', 'email', 'tel', 'url', 'number', 'textarea', 'radio', 'select',
                 'checkboxes', 'yesno', 'consent')),
  builtin     boolean not null default false,
  required    boolean not null default false,
  hidden      boolean not null default false,
  -- Null wording on a form question means "the catalog's text".
  label_en    text check (label_en is null or char_length(label_en) between 1 and 1000),
  label_ar    text check (label_ar is null or char_length(label_ar) between 1 and 1000),
  hint_en     text check (hint_en is null or char_length(hint_en) between 1 and 2000),
  hint_ar     text check (hint_ar is null or char_length(hint_ar) between 1 and 2000),
  -- [{ "value": "…", "en": "…" | null, "ar": "…" | null, "hidden": bool }, …]
  options     jsonb not null default '[]'::jsonb check (
                jsonb_typeof(options) = 'array' and octet_length(options::text) <= 50000),
  min_value   int,
  max_value   int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,                              -- the club member who changed it
  -- An added question has wording of its own, in at least one language.
  check (builtin or label_en is not null or label_ar is not null),
  unique (project_id, key)
);

comment on table questions is
  'The managers'' edits to a project''s application form (0004): changes to the form''s own questions, and the questions they added. Never deleted; hidden instead.';

create index if not exists questions_project_idx on questions (project_id, section, sort_order);

alter table questions enable row level security;

alter table applications
  add column if not exists answers jsonb not null default '{}'::jsonb
  check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 200000);

comment on column applications.answers is
  'Answers to the questions a manager added (0004), keyed by questions.key.';

-- -----------------------------------------------------------------------------
-- Relax what a manager's edits may change.
-- -----------------------------------------------------------------------------

-- The choice questions' CHECK lists: a manager may add choices. Each of these
-- columns had exactly one single-column CHECK (its list, from 0001); it is
-- replaced by a looser shape check, named so a re-run leaves it alone.
do $$
declare
  v_col text;
  v_con record;
begin
  foreach v_col in array array['university_relation', 'age_band', 'stage', 'commitment', 'sector',
                               'heard_from', 'funding', 'wants'] loop
    for v_con in
      select c.conname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.conrelid = 'public.applications'::regclass
         and c.contype = 'c'
         and cardinality(c.conkey) = 1
         and a.attname = v_col
         and c.conname <> 'applications_' || v_col || '_shape'
    loop
      execute format('alter table public.applications drop constraint %I', v_con.conname);
    end loop;
  end loop;
end;
$$;

alter table applications drop constraint if exists applications_university_relation_shape;
alter table applications add constraint applications_university_relation_shape
  check (university_relation is null or char_length(university_relation) between 1 and 100);
alter table applications drop constraint if exists applications_age_band_shape;
alter table applications add constraint applications_age_band_shape
  check (age_band is null or char_length(age_band) between 1 and 100);
alter table applications drop constraint if exists applications_stage_shape;
alter table applications add constraint applications_stage_shape
  check (stage is null or char_length(stage) between 1 and 100);
alter table applications drop constraint if exists applications_commitment_shape;
alter table applications add constraint applications_commitment_shape
  check (commitment is null or char_length(commitment) between 1 and 100);
alter table applications drop constraint if exists applications_sector_shape;
alter table applications add constraint applications_sector_shape
  check (sector is null or char_length(sector) between 1 and 100);
alter table applications drop constraint if exists applications_heard_from_shape;
alter table applications add constraint applications_heard_from_shape
  check (heard_from is null or char_length(heard_from) between 1 and 100);
alter table applications drop constraint if exists applications_funding_shape;
alter table applications add constraint applications_funding_shape
  check (funding is null or cardinality(funding) <= 50);
alter table applications drop constraint if exists applications_wants_shape;
alter table applications add constraint applications_wants_shape
  check (wants is null or cardinality(wants) <= 50);

-- The questions a manager may hide or make optional: an application sent
-- while one is hidden has it empty. (founder_name, email, phone and
-- data_consent keep their NOT NULL: they cannot be hidden.)
alter table applications alter column university           drop not null;
alter table applications alter column age_band             drop not null;
alter table applications alter column stage                drop not null;
alter table applications alter column commitment           drop not null;
alter table applications alter column venture_name         drop not null;
alter table applications alter column problem              drop not null;
alter table applications alter column pitch                drop not null;
alter table applications alter column sector               drop not null;
alter table applications alter column has_team             drop not null;
alter table applications alter column customer             drop not null;
alter table applications alter column customer_problem     drop not null;
alter table applications alter column competitor           drop not null;
alter table applications alter column evidence             drop not null;
alter table applications alter column research             drop not null;
alter table applications alter column revenue_model        drop not null;
alter table applications alter column funding              drop not null;
alter table applications alter column wants                drop not null;
alter table applications alter column heard_from           drop not null;
alter table applications alter column conflict_of_interest drop not null;
alter table applications alter column declaration          drop not null;
alter table applications alter column filming_consent      drop not null;

-- -----------------------------------------------------------------------------
-- Functions the app calls
-- -----------------------------------------------------------------------------

-- Saves one or more questions of a project, as the app's merged view of them
-- (p_questions: [{key, section, sort_order, kind, builtin, required, hidden,
-- label_en, label_ar, hint_en, hint_ar, options, min, max}, …]). The app has
-- already asked the club database that p_actor manages p_project. A
-- question's kind and whether it is one of the form's own never change once
-- it exists; there is no delete.
create or replace function public.save_questions(
  p_project uuid,
  p_actor uuid,
  p_questions jsonb
)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if jsonb_typeof(p_questions) is distinct from 'array' then
    perform app.refuse('invalid', 'Questions must be a list.');
  end if;

  -- Questions belong to a form; editing them before the form's settings
  -- were ever saved makes it (closed).
  insert into settings (project_id, updated_by) values (p_project, p_actor)
  on conflict (project_id) do nothing;

  begin
    for v in select * from jsonb_array_elements(p_questions) loop
      insert into questions (project_id, key, section, sort_order, kind, builtin, required, hidden,
                             label_en, label_ar, hint_en, hint_ar, options, min_value, max_value,
                             updated_at, updated_by)
      values (p_project,
              v ->> 'key',
              v ->> 'section',
              coalesce((v ->> 'sort_order')::int, 0),
              v ->> 'kind',
              coalesce((v ->> 'builtin')::boolean, false),
              coalesce((v ->> 'required')::boolean, false),
              coalesce((v ->> 'hidden')::boolean, false),
              nullif(btrim(v ->> 'label_en'), ''),
              nullif(btrim(v ->> 'label_ar'), ''),
              nullif(btrim(v ->> 'hint_en'), ''),
              nullif(btrim(v ->> 'hint_ar'), ''),
              coalesce(v -> 'options', '[]'::jsonb),
              (v ->> 'min')::int,
              (v ->> 'max')::int,
              now(),
              p_actor)
      on conflict (project_id, key) do update
         set section    = excluded.section,
             sort_order = excluded.sort_order,
             required   = excluded.required,
             hidden     = excluded.hidden,
             label_en   = excluded.label_en,
             label_ar   = excluded.label_ar,
             hint_en    = excluded.hint_en,
             hint_ar    = excluded.hint_ar,
             options    = excluded.options,
             min_value  = excluded.min_value,
             max_value  = excluded.max_value,
             updated_at = now(),
             updated_by = p_actor;
    end loop;
  exception
    when check_violation or not_null_violation or invalid_text_representation then
      perform app.refuse('invalid', 'A question is not valid: ' || sqlerrm);
  end;
end;
$$;

-- apply() as in 0002, with the 0004 changes: the answers to added questions
-- (`answers`), and no question required here any more — the app checks the
-- project's required questions before calling. The team and the attendees
-- cap still apply whenever those questions are answered.
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
  v_most int;
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
  v_row.answers := coalesce(v_row.answers, '{}'::jsonb);

  if jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array' then
    perform app.refuse('invalid', 'Team members must be a list.');
  end if;
  if v_row.has_team is true and jsonb_array_length(p_members) = 0 then
    perform app.refuse('team_members_missing', 'Add the other team members, or answer that there are none.');
  end if;
  if jsonb_array_length(p_members) > 10 then
    perform app.refuse('too_many_members', 'At most 10 other team members.');
  end if;
  -- 0002: no more people attending than the founder plus the members named.
  v_most := 1 + case when v_row.has_team is true then jsonb_array_length(p_members) else 0 end;
  if v_row.attendees is not null and v_row.has_team is not null and v_row.attendees > v_most then
    perform app.refuse('attendees_too_many', 'More people attending than the lead founder and the members named.');
  end if;

  begin
    insert into applications values (v_row.*) returning id into v_id;

    if v_row.has_team is true then
      for v_m in select * from jsonb_array_elements(p_members) loop
        insert into application_members (application_id, sort_order, name, phone, email)
        values (v_id, v_i, v_m ->> 'name', v_m ->> 'phone', v_m ->> 'email');
        v_i := v_i + 1;
      end loop;
    end if;
  exception
    when unique_violation then
      perform app.refuse('already_applied', 'An application from this phone number is already in.');
    -- A malformed phone or email, a text too long: the constraint says which
    -- in the log; the applicant gets one message.
    when check_violation or not_null_violation then
      perform app.refuse('invalid', 'Some answers are missing or not valid: ' || sqlerrm);
  end;

  return v_id;
end;
$$;

revoke execute on function public.save_questions(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_questions(uuid, uuid, jsonb) to service_role;
revoke execute on function public.apply(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply(uuid, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
