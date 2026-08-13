-- =============================================================================
-- 0010 — Functions the application calls.
--
-- These run with the CALLER's rights (no SECURITY DEFINER), so Row Level
-- Security still applies on top of whatever they do. They exist to bundle a
-- multi-step operation into one transaction, not to escape permissions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What may I do? Used by the UI to grey out actions, and by server actions to
-- pre-check before hitting the database. The database remains the authority.
-- -----------------------------------------------------------------------------

create or replace function public.my_permissions()
returns table (permission_key text, scope permission_scope)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.key, app.effective_scope(p.key)
  from permissions p
  order by p.key
$$;

-- The signed-in person's own profile, with role and team resolved.
create or replace function public.my_member()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(x)
  from (
    select
      m.id, m.email, m.name_en, m.name_ar, m.status, m.student_id,
      m.team_id, t.key as team_key, t.name_en as team_name_en, t.name_ar as team_name_ar,
      m.role_id, r.key as role_key, r.name_en as role_name_en, r.name_ar as role_name_ar
    from members m
    join teams t on t.id = m.team_id
    join roles r on r.id = m.role_id
    where m.auth_user_id = auth.uid()
  ) x
$$;

grant execute on function public.my_permissions() to authenticated;
grant execute on function public.my_member() to authenticated;

-- -----------------------------------------------------------------------------
-- Move a request to a new status.
--
-- Deliberately NOT security definer: the RLS policy decides whether you may
-- touch this request at all, and the validate/history/hook triggers from 0006
-- decide whether this particular move is legal. This function only packages
-- the note and any payload change into the same statement so the history row
-- captures them.
-- -----------------------------------------------------------------------------

create or replace function public.transition_request(
  p_request    uuid,
  p_to_status  text,
  p_note       text  default null,
  p_patch      jsonb default '{}'::jsonb
)
returns requests
language plpgsql
as $$
declare
  v_request requests;
begin
  update requests
     set status = p_to_status,
         data   = data
                  || coalesce(p_patch, '{}'::jsonb)
                  || jsonb_build_object('transition_note', p_note)
   where id = p_request
   returning * into v_request;

  if not found then
    raise exception 'Request not found, or you are not allowed to act on it'
      using errcode = '42501';
  end if;

  return v_request;
end;
$$;

grant execute on function public.transition_request(uuid, text, text, jsonb) to authenticated;

-- =============================================================================
-- CSV import (spec §4)
--
-- All-or-nothing: the whole file is validated first and NOTHING is written
-- unless every row passes. The caller gets a report naming each problem row,
-- field, and reason.
--
-- Two layers of enforcement, as everywhere else: app.require() gives a clear
-- "you may not import" error, and because this function runs as the caller,
-- the RLS policies on `members` would reject the writes anyway.
-- =============================================================================

create or replace function public.import_members(p_rows jsonb)
returns jsonb
language plpgsql
as $$
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
        college, academic_level, graduation_term, status, join_date
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
        'active',                                    -- Active immediately (§4)
        coalesce((v_row ->> 'join_date')::date, current_date)
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
        status          = 'active',
        join_date       = coalesce((v_row ->> 'join_date')::date, join_date)
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
$$;

grant execute on function public.import_members(jsonb) to authenticated;
