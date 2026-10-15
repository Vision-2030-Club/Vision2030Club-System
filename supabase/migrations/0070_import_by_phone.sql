-- =============================================================================
-- 0070 — The member import matches on phone; student ID becomes optional.
--
-- The club's membership sheet for the first semester of 1448H carries name,
-- phone, email, team, role and projects — no student ID and no national ID,
-- and the club does not want those collected through the sheet any more.
-- Until now `import_members` refused any row without both, and matched people
-- on student ID, so 76 new members could not be imported at all.
--
-- What changes:
--
-- 1. `members.student_id` may be NULL. It stays UNIQUE and keeps its format
--    check, so a student ID that IS entered is still validated. The 98 IDs
--    already stored are untouched — nothing here deletes data.
--
-- 2. `import_members` matches on PHONE (normalised by `app.normalize_phone`
--    from 0022, the same form the column stores), and falls back to EMAIL when
--    the phone matches nobody, so a member who changed their number is updated
--    rather than duplicated. student_id and national_id columns are optional:
--    when a file carries them they are validated and stored as before; when it
--    does not, the stored values are kept.
--
-- 3. A blank optional cell no longer wipes what is stored. The 1448 sheet has
--    no college, level or graduation term, and importing it must not erase the
--    ones the first import wrote.
--
-- 4. The import never changes the role of somebody who is Super Admin today.
--    The live Super Admin is in the club's sheet as an ordinary team director;
--    importing that row as written would demote the only account that can
--    restore it. The CSV builder used to guard this by hard-coding a student
--    ID; doing it here covers every file and keeps personal data out of git.
--
-- Members who are not in the file are left alone, as before, and project links
-- are only ever added, never removed.
--
-- Safe to re-run: `drop not null` on a nullable column is a no-op and the
-- function is `create or replace`.
-- =============================================================================

alter table members alter column student_id drop not null;

comment on column members.student_id is
  'Optional since 0070. When present: exactly 9 digits starting with 4, unique.
   No longer the import match key — that is the phone number.';

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
      -- Never demote a Super Admin from a file; see the header, point 4.
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

      -- A Project Manager named against a project manages it (0047).
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
    'kept_roles', v_kept_roles,
    'errors', '[]'::jsonb
  );
end;
$function$
;

grant execute on function public.import_members(jsonb) to authenticated;
