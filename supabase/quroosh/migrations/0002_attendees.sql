-- =============================================================================
-- Quroosh database — 0002: how many of the team will attend.
--
-- The club asked (2026-11-08) to know how many people from each applying
-- team will attend Quroosh, counting the lead founder. It is a number from 1
-- to 11 (the founder and up to ten members), and apply() checks it is no more
-- than the founder plus the members the application names.
--
-- Applications sent before this migration keep an empty answer: the column
-- is nullable, and apply() is what requires it from now on.
--
-- Nothing is deleted. Safe to re-run: the column is added if missing, the
-- function replaced.
-- =============================================================================

alter table applications
  add column if not exists attendees int
  check (attendees is null or attendees between 1 and 11);

comment on column applications.attendees is
  'How many of the team will attend Quroosh, the lead founder included (0002). Empty for applications sent before 0002.';

-- apply() as in 0001, with the attendees check.
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

  if jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array' then
    perform app.refuse('invalid', 'Team members must be a list.');
  end if;
  if v_row.has_team and jsonb_array_length(p_members) = 0 then
    perform app.refuse('team_members_missing', 'Add the other team members, or answer that there are none.');
  end if;
  if jsonb_array_length(p_members) > 10 then
    perform app.refuse('too_many_members', 'At most 10 other team members.');
  end if;
  -- 0002: how many will attend, counting the lead founder. Required from
  -- now on, and no more than the founder plus the members named.
  if v_row.attendees is null then
    perform app.refuse('invalid', 'Say how many of the team will attend.');
  end if;
  -- (Computed first: an IF condition cannot hold CASE's own THEN.)
  v_most := 1 + case when v_row.has_team then jsonb_array_length(p_members) else 0 end;
  if v_row.attendees > v_most then
    perform app.refuse('attendees_too_many', 'More people attending than the lead founder and the members named.');
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

revoke execute on function public.apply(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply(uuid, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
