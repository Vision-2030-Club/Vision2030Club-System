-- =============================================================================
-- 0077 — Event attendance: nobody checks themselves in.
--
-- The gate (0075) already refuses anyone who is not a manager of the project
-- or on the HR team, so an ordinary attendee has never been able to record
-- their own arrival. One gap was left: a manager or an HR member who is also
-- signed up to the event could read their own pass, or find themselves by
-- name, and be counted as present without anyone having seen them.
--
-- `event_check_in` now refuses that with the hint `own_pass`. A pass is the
-- caller's own when its mobile or its email is the one on their member
-- record. Someone else at the gate checks them in, as for every attendee.
--
-- The function is 0075's with that one check added. Nothing is changed in
-- the tables and nothing is deleted. Safe to re-run.
-- =============================================================================

create or replace function public.event_check_in(
  p_project uuid,
  p_token text default null,
  p_attendee uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_attendee event_attendees;
  v_settings event_attendance_settings;
  v_today    date := app.club_today();
  v_at       timestamptz;
  v_new      boolean := false;
begin
  if app.event_attendance_role(p_project) is null then
    perform app.refuse('forbidden', 'You may not check people in to this event.');
  end if;

  if p_token is not null then
    select * into v_attendee from event_attendees a where a.token = p_token;
  elsif p_attendee is not null then
    select * into v_attendee from event_attendees a where a.id = p_attendee;
  end if;
  if v_attendee.id is null then
    perform app.refuse('not_found', 'This pass is not known.');
  end if;
  if v_attendee.project_id <> p_project then
    perform app.refuse('wrong_event', 'This pass is for another event.');
  end if;

  -- The pass is the caller's own: the same mobile or the same email as their
  -- member record. A member's mobile may be stored as 05XXXXXXXX; the pass
  -- always holds the international form.
  if exists (
    select 1
      from members m
     where m.auth_user_id = auth.uid()
       and (app.normalize_phone(m.phone) = v_attendee.phone
            or (v_attendee.email is not null and lower(m.email::text) = lower(v_attendee.email)))
  ) then
    perform app.refuse('own_pass', 'You cannot check yourself in. Ask someone else at the gate.');
  end if;

  if v_attendee.cancelled_at is not null then
    perform app.refuse('attendee_cancelled', 'This pass was cancelled.');
  end if;

  select * into v_settings from event_attendance_settings s where s.project_id = p_project;
  if v_settings.first_day is not null and (v_today < v_settings.first_day or v_today > v_settings.last_day) then
    perform app.refuse('not_an_event_day', 'Today is not one of the event''s days.');
  end if;

  -- The claim: the unique index decides, nothing checks first.
  insert into event_check_ins (attendee_id, project_id, day, checked_in_by, via)
  values (v_attendee.id, p_project, v_today, app.current_member_id(),
          case when p_token is not null then 'scan' else 'manual' end)
  on conflict (attendee_id, day) where undone_at is null do nothing
  returning checked_in_at into v_at;

  if v_at is not null then
    v_new := true;
  else
    select c.checked_in_at into v_at from event_check_ins c
     where c.attendee_id = v_attendee.id and c.day = v_today and c.undone_at is null;
  end if;

  return jsonb_build_object(
    'result', case when v_new then 'checked_in' else 'already' end,
    'attendee_id', v_attendee.id,
    'name', v_attendee.name,
    'day', v_today,
    'at', v_at
  );
end;
$$;

revoke execute on function public.event_check_in(uuid, text, uuid) from public, anon;
grant execute on function public.event_check_in(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
