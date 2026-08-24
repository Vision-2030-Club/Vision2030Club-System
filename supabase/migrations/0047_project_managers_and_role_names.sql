-- =============================================================================
-- 0047 — Project Managers actually manage their project, and two role names.
--
-- 1. THE IMPORT LEFT PROJECT MANAGERS POWERLESS.
--
--    `import_members` linked a named project through `project_members` — which
--    makes somebody a MEMBER of a project. `project_managers` is the table that
--    grants authority over it: `app.is_project_manager` reads it, and that is
--    what `own_projects` scope resolves through. So after the club's first real
--    import, all twenty Project Managers were ordinary members of the projects
--    they run, and could not manage tasks, approve requests, or book a room as
--    that project.
--
--    Fixed in both directions: the function now creates the manager link too,
--    and the backfill at the bottom repairs the people already imported.
--
-- 2. TWO ARABIC ROLE NAMES the club does not use.
--
--    The club says قائد فريق and مدير مشروع; the seed said مدير الفريق and
--    مدير المشروع. Only `name_ar` changes — the keys `team_director` and
--    `project_manager` are what every policy and permission row refers to, and
--    those are untouched.
--
--    Worth knowing: `import_members` matches Arabic byte-exactly, so after this
--    a spreadsheet saying قائد فريق matches directly. The CSV builder emits
--    English keys and is unaffected either way.
-- =============================================================================

update roles set name_ar = 'قائد فريق'  where key = 'team_director';
update roles set name_ar = 'مدير مشروع' where key = 'project_manager';

-- -----------------------------------------------------------------------------
-- The import, now creating the manager link as well
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_members(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row        jsonb;
  v_index      integer := 0;
  v_errors     jsonb := '[]'::jsonb;

  v_email      text;
  v_student    text;
  v_national   text;
  v_team       uuid;
  v_role       uuid;
  v_project    text;
  v_project_id uuid;

  v_seen_students text[] := '{}';
  v_seen_emails   text[] := '{}';

  v_member_id  uuid;
  v_existing   uuid;
  v_created    integer := 0;
  v_updated    integer := 0;
  v_links      integer := 0;
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

    -- Spec §5: exactly 9 digits, must start with 4. Never silently reformatted.
    if v_student is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'student_id', 'reason', 'required', 'value', null);
    elsif v_student !~ '^4[0-9]{8}$' then
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

    -- Spec §5: exactly 10 digits, must start with 1 or 2.
    if v_national is null then
      v_errors := v_errors || jsonb_build_object(
        'row', v_index, 'field', 'national_id', 'reason', 'required', 'value', null);
    elsif v_national !~ '^[12][0-9]{9}$' then
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
      end if;
    end loop;

    -- An email already used by a DIFFERENT person would break the unique
    -- constraint at write time; catch it here so the report stays complete.
    if v_email is not null and v_student is not null then
      select id into v_existing from members where email = v_email::citext;
      if v_existing is not null
         and v_existing <> coalesce((select id from members where student_id = v_student), '00000000-0000-0000-0000-000000000000'::uuid)
      then
        v_errors := v_errors || jsonb_build_object(
          'row', v_index, 'field', 'email',
          'reason', 'already used by a different member', 'value', v_email);
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
      'errors', v_errors
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- PASS 2 — write. Everything below is in the caller's transaction, so any
  -- unexpected failure still leaves the database untouched.
  -- ---------------------------------------------------------------------------
  v_index := 0;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index  := v_index + 1;
    v_email  := btrim(v_row ->> 'email');
    v_student := btrim(v_row ->> 'student_id');
    v_national := btrim(v_row ->> 'national_id');

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

    -- Match key is the student ID (spec §4): existing -> update, new -> insert.
    select id into v_member_id from members where student_id = v_student;

    if v_member_id is null then
      insert into members (
        email, name_en, name_ar, phone, student_id, team_id, role_id,
        college, academic_level, graduation_term, status
      ) values (
        v_email::citext,
        btrim(v_row ->> 'name_en'),
        btrim(v_row ->> 'name_ar'),
        nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
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
      update members set
        email           = v_email::citext,
        name_en         = btrim(v_row ->> 'name_en'),
        name_ar         = btrim(v_row ->> 'name_ar'),
        phone           = nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
        team_id         = v_team,
        role_id         = v_role,
        college         = nullif(btrim(coalesce(v_row ->> 'college', '')), ''),
        academic_level  = nullif(btrim(coalesce(v_row ->> 'academic_level', '')), ''),
        graduation_term = nullif(btrim(coalesce(v_row ->> 'graduation_term', '')), ''),
        status          = 'active'
      where id = v_member_id;

      v_updated := v_updated + 1;
    end if;

    -- National ID goes to the separate, restricted table (spec §5).
    insert into member_sensitive (member_id, national_id)
    values (v_member_id, v_national)
    on conflict (member_id) do update set national_id = excluded.national_id;

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

      /*
       * Somebody whose ROLE is Project Manager, named against a project, is a
       * manager OF that project. The import used to leave them as an ordinary
       * member, so a PM had no authority over the project they run until an
       * admin added them by hand.
       *
       * The max-four rule from 0005 is a trigger: if a file names a fifth it
       * raises, and because this import is all-or-nothing nothing is written.
       * That is the right answer — the spreadsheet is wrong, not the rule.
       */
      if exists (select 1 from roles r where r.id = v_role and r.key = 'project_manager') then
        insert into project_managers (project_id, member_id)
        values (v_project_id, v_member_id)
        on conflict do nothing;
      end if;

      v_links := v_links + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'project_links', v_links,
    'errors', '[]'::jsonb
  );
end;
$function$
;

grant execute on function public.import_members(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill: everybody already imported
--
-- Only people whose ROLE is Project Manager and who are already members of the
-- project. Nobody gains authority they were not given in the spreadsheet.
-- -----------------------------------------------------------------------------

insert into project_managers (project_id, member_id)
select pm.project_id, pm.member_id
from project_members pm
join members m on m.id = pm.member_id
join roles r on r.id = m.role_id and r.key = 'project_manager'
on conflict do nothing;
