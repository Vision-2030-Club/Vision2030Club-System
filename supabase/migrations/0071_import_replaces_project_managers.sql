-- =============================================================================
-- 0071 — A file that names a project's managers replaces them.
--
-- Importing the 1448H sheet failed with "A project can have at most 4 Project
-- Managers". The sheet names exactly four Project Managers for each of the
-- five projects, but `import_members` only ever ADDED manager links. The live
-- database still held the managers from the first import, and from changes
-- made in the app, so every project where the sheet named somebody new went
-- to five and hit the 0005 trigger. The whole import rolled back, as designed.
--
-- The sheet is the club's current answer to "who runs which project", so now:
--
--   For every project the file names at least one Project Manager against,
--   that project's managers become exactly the people the file names. Anyone
--   else loses the manager link for that project.
--
-- What this does NOT remove:
--   - Project MEMBERSHIP (`project_members`). A former manager stays in the
--     project as an ordinary member and keeps their tasks and history.
--   - Managers of a project the file names no Project Manager against. A
--     file that is silent about a project leaves its managers alone.
--   - Split managers (`project_split_managers`), which are separate.
--
-- The rule only removes rows from the link table that grants authority over
-- a project; no person, task, request or membership row is deleted. A file
-- that names a fifth manager for one project is now reported against that
-- row in the validation pass, rather than failing on the trigger.
--
-- A second, quieter cause is fixed on the way: the trigger is BEFORE INSERT,
-- which runs before ON CONFLICT DO NOTHING is resolved, so re-inserting a
-- manager who was already there counted too. Existing links are now skipped.
--
-- The result gains `managers_removed`, so the screen can say how many old
-- links went. Safe to re-run: `create or replace` only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.import_members(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row        jsonb;
  v_index      integer := 0;
  v_errors     jsonb := '[]'::jsonb;

  v_email      text;
  v_phone      text;
  v_student    text;
  v_national   text;
  v_team       uuid;
  v_role       uuid;
  v_project    text;
  v_project_id uuid;

  v_seen_students text[] := '{}';
  v_seen_emails   text[] := '{}';
  v_seen_phones   text[] := '{}';
  v_seen_members  uuid[] := '{}';

  v_member_id  uuid;
  v_existing   uuid;
  v_matches    integer;
  v_created    integer := 0;
  v_updated    integer := 0;
  v_links      integer := 0;
  v_kept_roles integer := 0;

  -- Project Managers the file names, per project: counted in pass 1, written
  -- as (project, member) pairs in pass 2 once every member has an id.
  v_is_pm          boolean;
  v_pm_count       jsonb := '{}'::jsonb;
  v_pm_projects    uuid[] := '{}';
  v_pm_members     uuid[] := '{}';
  v_mgr_removed    integer := 0;
begin
  perform app.require('import.run');

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_members expects an array of rows';
  end if;

  -- ---------------------------------------------------------------------------
  -- PASS 1 — validate everything. No writes happen in this loop.
  -- ---------------------------------------------------------------------------
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;

    v_email    := nullif(btrim(coalesce(v_row ->> 'email', '')), '');
    v_phone    := app.normalize_phone(v_row ->> 'phone');
    v_student  := nullif(btrim(coalesce(v_row ->> 'student_id', '')), '');
    v_national := nullif(btrim(coalesce(v_row ->> 'national_id', '')), '');

    -- Required fields
    if v_email is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'email', 'reason', 'required', 'value', null);
    elsif v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'email', 'reason', 'not a valid email address',
        'value', v_email);
    elsif lower(v_email) = any (v_seen_emails) then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'email', 'reason', 'appears more than once in this file',
        'value', v_email);
    else
      v_seen_emails := v_seen_emails || lower(v_email);
    end if;

    if nullif(btrim(coalesce(v_row ->> 'name_en', '')), '') is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'name_en', 'reason', 'required', 'value', null);
    end if;

    if nullif(btrim(coalesce(v_row ->> 'name_ar', '')), '') is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'name_ar', 'reason', 'required', 'value', null);
    end if;

    -- Phone is the match key. Same rule as the column's CHECK (0022).
    if v_phone is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'phone', 'reason', 'required', 'value', null);
    elsif v_phone !~ '^\+9665[0-9]{8}$' then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'phone',
        'reason', 'must be a Saudi mobile number (05XXXXXXXX)', 'value', v_row ->> 'phone');
    elsif v_phone = any (v_seen_phones) then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'phone', 'reason', 'appears more than once in this file',
        'value', v_row ->> 'phone');
    else
      v_seen_phones := v_seen_phones || v_phone;
    end if;

    -- Optional. Spec §5 format when given; never silently reformatted.
    if v_student is not null then
      if v_student !~ '^4[0-9]{8}$' then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'student_id',
          'reason', 'must be exactly 9 digits and start with 4', 'value', v_student);
      elsif v_student = any (v_seen_students) then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'student_id',
          'reason', 'appears more than once in this file', 'value', v_student);
      else
        v_seen_students := v_seen_students || v_student;
      end if;
    end if;

    if v_national is not null and v_national !~ '^[12][0-9]{9}$' then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'national_id',
        'reason', 'must be exactly 10 digits and start with 1 or 2', 'value', v_national);
    end if;

    -- Team and role must already exist. The file is expected to use this
    -- system's own names — mapping happens before upload, not here (spec §4).
    select id into v_team
    from teams
    where key = upper(btrim(coalesce(v_row ->> 'team', '')))
       or lower(name_en) = lower(btrim(coalesce(v_row ->> 'team', '')))
       or name_ar = btrim(coalesce(v_row ->> 'team', ''));

    if v_team is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'team', 'reason', 'no team with this name exists',
        'value', v_row ->> 'team');
    end if;

    select id into v_role
    from roles
    where key = lower(replace(btrim(coalesce(v_row ->> 'role', '')), ' ', '_'))
       or lower(name_en) = lower(btrim(coalesce(v_row ->> 'role', '')))
       or name_ar = btrim(coalesce(v_row ->> 'role', ''));

    if v_role is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'role', 'reason', 'no role with this name exists',
        'value', v_row ->> 'role');
    end if;

    v_is_pm := exists (select 1 from roles r where r.id = v_role and r.key = 'project_manager');

    -- Optional project names, comma-separated.
    foreach v_project in array
      string_to_array(coalesce(v_row ->> 'projects', ''), ',')
    loop
      v_project := btrim(v_project);
      continue when v_project = '';

      select id into v_project_id
      from projects
      where lower(name_en) = lower(v_project) or name_ar = v_project;

      if v_project_id is null then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'projects',
          'reason', 'no project with this name exists', 'value', v_project);
      elsif v_is_pm then
        -- The file's managers replace the project's (header), so the limit of
        -- four from 0005 applies to the file alone. Report the fifth here.
        v_pm_count := jsonb_set(
          v_pm_count, array[v_project_id::text],
          to_jsonb(coalesce((v_pm_count ->> v_project_id::text)::integer, 0) + 1));
        if (v_pm_count ->> v_project_id::text)::integer = 5 then
          v_errors := v_errors || jsonb_build_object(
            'row', v_index, 'field', 'projects',
            'reason', 'a project can have at most 4 Project Managers; this is the 5th named for it',
            'value', v_project);
        end if;
      end if;
    end loop;

    -- Who this row is: phone first, then email. Two members already sharing a
    -- phone cannot be told apart, so that is reported rather than guessed.
    v_member_id := null;
    if v_phone ~ '^\+9665[0-9]{8}$' then
      select count(*), min(id::text)::uuid into v_matches, v_member_id
      from members where phone = v_phone;

      if v_matches > 1 then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'phone',
          'reason', 'more than one existing member has this phone', 'value', v_row ->> 'phone');
      end if;
    end if;

    if v_member_id is null and v_email is not null then
      select id into v_member_id from members where email = v_email::citext;
    end if;

    -- An email or student ID already held by a DIFFERENT person would
    -- break a unique constraint (or merge two people) at write time; catch it
    -- here so the report stays complete.
    if v_email is not null then
      select id into v_existing from members where email = v_email::citext;
      if v_existing is not null and v_existing is distinct from v_member_id then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'email',
          'reason', 'already used by a different member', 'value', v_email);
      end if;
    end if;

    -- One row's phone and another row's email can lead to the same person;
    -- writing both would silently merge two people into one.
    if v_member_id is not null then
      if v_member_id = any (v_seen_members) then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'phone',
          'reason', 'matches the same existing member as an earlier row', 'value', v_row ->> 'phone');
      else
        v_seen_members := v_seen_members || v_member_id;
      end if;
    end if;

    if v_student is not null then
      select id into v_existing from members where student_id = v_student;
      if v_existing is not null and v_existing is distinct from v_member_id then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'student_id',
          'reason', 'already used by a different member', 'value', v_student);
      end if;
    end if;
  end loop;

  -- Spec §4: if ANY row fails ANY check, commit NOTHING.
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'created', 0,
      'updated', 0,
      'project_links', 0,
      'kept_roles', 0,
      'managers_removed', 0,
      'errors', v_errors
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- PASS 2 — write. Everything below is in the caller's transaction, so any
  -- unexpected failure still leaves the database untouched.
  -- ---------------------------------------------------------------------------
  v_index := 0;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index    := v_index + 1;
    v_email    := btrim(v_row ->> 'email');
    v_phone    := app.normalize_phone(v_row ->> 'phone');
    v_student  := nullif(btrim(coalesce(v_row ->> 'student_id', '')), '');
    v_national := nullif(btrim(coalesce(v_row ->> 'national_id', '')), '');

    select id into v_team
    from teams
    where key = upper(btrim(coalesce(v_row ->> 'team', '')))
       or lower(name_en) = lower(btrim(coalesce(v_row ->> 'team', '')))
       or name_ar = btrim(coalesce(v_row ->> 'team', ''));

    select id into v_role
    from roles
    where key = lower(replace(btrim(coalesce(v_row ->> 'role', '')), ' ', '_'))
       or lower(name_en) = lower(btrim(coalesce(v_row ->> 'role', '')))
       or name_ar = btrim(coalesce(v_row ->> 'role', ''));

    -- Match key is the phone, then the email (pass 1 proved these unambiguous).
    v_member_id := null;
    select id into v_member_id from members where phone = v_phone;
    if v_member_id is null then
      select id into v_member_id from members where email = v_email::citext;
    end if;

    if v_member_id is null then
      insert into members (
        email, name_en, name_ar, phone, student_id, team_id, role_id,
        college, academic_level, graduation_term, status
      ) values (
        v_email::citext,
        btrim(v_row ->> 'name_en'),
        btrim(v_row ->> 'name_ar'),
        v_phone,
        v_student,
        v_team,
        v_role,
        nullif(btrim(coalesce(v_row ->> 'college', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'academic_level', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'graduation_term', '')), ''),
        'active'                                     -- Active immediately (§4)
      )
      returning id into v_member_id;

      v_created := v_created + 1;
    else
      -- Never demote a Super Admin from a file (0070, point 4).
      if exists (
        select 1 from members m join roles r on r.id = m.role_id
        where m.id = v_member_id and r.key = 'super_admin'
      ) then
        if v_role is distinct from (select role_id from members where id = v_member_id) then
          v_kept_roles := v_kept_roles + 1;
        end if;
        v_role := (select role_id from members where id = v_member_id);
      end if;

      update members set
        email           = v_email::citext,
        name_en         = btrim(v_row ->> 'name_en'),
        name_ar         = btrim(v_row ->> 'name_ar'),
        phone           = v_phone,
        student_id      = coalesce(v_student, student_id),
        team_id         = v_team,
        role_id         = v_role,
        college         = coalesce(nullif(btrim(coalesce(v_row ->> 'college', '')), ''), college),
        academic_level  = coalesce(nullif(btrim(coalesce(v_row ->> 'academic_level', '')), ''), academic_level),
        graduation_term = coalesce(nullif(btrim(coalesce(v_row ->> 'graduation_term', '')), ''), graduation_term),
        status          = 'active'
      where id = v_member_id;

      v_updated := v_updated + 1;
    end if;

    -- National ID goes to the separate, restricted table (spec §5) — only when
    -- the file has one. A blank cell keeps whatever is stored.
    if v_national is not null then
      insert into member_sensitive (member_id, national_id)
      values (v_member_id, v_national)
      on conflict (member_id) do update set national_id = excluded.national_id;
    end if;

    -- Project membership named in the file (spec §4).
    foreach v_project in array
      string_to_array(coalesce(v_row ->> 'projects', ''), ',')
    loop
      v_project := btrim(v_project);
      continue when v_project = '';

      select id into v_project_id
      from projects
      where lower(name_en) = lower(v_project) or name_ar = v_project;

      insert into project_members (project_id, member_id)
      values (v_project_id, v_member_id)
      on conflict do nothing;

      -- A Project Manager named against a project manages it (0047). Written
      -- after the loop, once the project's old managers are cleared.
      if exists (select 1 from roles r where r.id = v_role and r.key = 'project_manager') then
        v_pm_projects := v_pm_projects || v_project_id;
        v_pm_members  := v_pm_members || v_member_id;
      end if;

      v_links := v_links + 1;
    end loop;
  end loop;

  -- The file's managers replace the managers of every project it names one
  -- against (header). Cleared first, so the 0005 trigger counts only the
  -- file's; projects the file names no manager for are not touched.
  with named as (
    select * from unnest(v_pm_projects, v_pm_members) as t(project_id, member_id)
  ),
  gone as (
    delete from project_managers pm
    where pm.project_id in (select project_id from named)
      and not exists (
        select 1 from named n
        where n.project_id = pm.project_id and n.member_id = pm.member_id
      )
    returning 1
  )
  select count(*) into v_mgr_removed from gone;

  -- Only the links that are missing. The 0005 trigger is BEFORE INSERT, which
  -- runs before ON CONFLICT is resolved: re-inserting a manager who is already
  -- there would still be counted, and a full project would refuse it.
  insert into project_managers (project_id, member_id)
  select distinct t.project_id, t.member_id
  from unnest(v_pm_projects, v_pm_members) as t(project_id, member_id)
  where not exists (
    select 1 from project_managers pm
    where pm.project_id = t.project_id and pm.member_id = t.member_id
  );

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'project_links', v_links,
    'kept_roles', v_kept_roles,
    'managers_removed', v_mgr_removed,
    'errors', '[]'::jsonb
  );
end;
$function$
;

grant execute on function public.import_members(jsonb) to authenticated;
