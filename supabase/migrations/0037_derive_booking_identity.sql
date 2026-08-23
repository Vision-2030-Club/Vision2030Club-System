-- =============================================================================
-- 0037 — Stop asking people which group they are booking a room as.
--
-- The meeting form had a "Booking the room as" question. For almost everybody
-- there is exactly one possible answer — a Director speaks for their team, the
-- Presidency for the Presidency — so it was a question with one option, which
-- is not a question. It is now derived.
--
-- The only person it is genuinely ambiguous for is a Project Manager running
-- more than one project, and that case is handled by saying so rather than by
-- guessing (see the exception at the end).
--
-- Also renames the Money Request. "أمر صرف" is what the club actually calls
-- it; "Money Request" was a placeholder.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which group is this person booking as?
--
-- The same three cases `my_booking_identities` lists, collapsed to one answer.
-- `app.can` decides, so this stays in step with what `room_bookings_insert`
-- will accept — a derived identity can never be one the database then refuses.
-- -----------------------------------------------------------------------------

create or replace function app.default_booking_identity()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope   permission_scope;
  v_project uuid;
  v_count   integer;
begin
  v_scope := app.effective_scope('rooms.book');

  if v_scope = 'all' then
    return 'presidency';
  end if;

  if v_scope = 'own_team' then
    return 'team:' || app.current_team_id()::text;
  end if;

  if v_scope = 'own_projects' then
    select count(*), min(project_id) into v_count, v_project
    from project_managers
    where member_id = app.current_member_id();

    -- One project: obvious. Several: genuinely their choice, and picking one
    -- for them would book the wrong project's name onto the schedule.
    if v_count = 1 then
      return 'project:' || v_project::text;
    end if;
  end if;

  return null;
end;
$$;

grant execute on function app.default_booking_identity() to authenticated;

-- -----------------------------------------------------------------------------
-- Pin the derived identity when the meeting is created
--
-- `data ->> 'proposer_identity'` is still honoured if something supplies it —
-- a hook that already knows the answer, or a future form for the multi-project
-- case — so this is a fallback rather than a replacement.
-- -----------------------------------------------------------------------------

create or replace function app.on_meeting_request_written()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from request_types t
    where t.id = new.request_type_id and t.key = 'meeting_request'
  ) then
    return new;
  end if;

  insert into meeting_details (request_id, proposer_party)
  values (
    new.id,
    coalesce(app.meeting_proposer_party(new.data), app.default_booking_identity())
  )
  on conflict (request_id) do nothing;

  perform app.sync_meeting_hold(new.id);
  return new;
end;
$$;

-- A clearer message for the one case that cannot be derived.
create or replace function app.sync_meeting_hold(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          requests%rowtype;
  d          meeting_details%rowtype;
  v_status   request_statuses%rowtype;
  v_room     uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_kind     booking_party_kind;
  v_team     uuid;
  v_project  uuid;
  v_booking  room_bookings%rowtype;
begin
  select * into r from requests where id = p_request;
  if not found then return; end if;

  select * into d from meeting_details where request_id = p_request;
  if not found then return; end if;

  select * into v_status
  from request_statuses
  where request_type_id = r.request_type_id and key = r.status;

  if coalesce(v_status.is_approved, false) then
    return;
  end if;

  v_room  := app.meeting_room(r.data);
  v_start := app.meeting_start(r.data);
  v_end   := app.meeting_end(r.data);

  if coalesce(v_status.is_terminal, false) or not app.meeting_is_in_person(r.data) then
    if d.booking_id is not null then
      delete from room_bookings where id = d.booking_id and status = 'held';
      update meeting_details set booking_id = null where request_id = p_request;
    end if;
    return;
  end if;

  if v_room is null then
    raise exception 'An in-person meeting needs a room chosen when it is proposed'
      using errcode = '23514';
  end if;

  if v_start is null or v_end is null then
    raise exception 'An in-person meeting needs a proposed time'
      using errcode = '23514';
  end if;

  if d.booking_id is not null then
    select * into v_booking from room_bookings where id = d.booking_id;
    if found
       and v_booking.room_id = v_room
       and v_booking.starts_at = v_start
       and v_booking.ends_at = v_end
    then
      return;
    end if;
  end if;

  if d.proposer_party = 'presidency' then
    v_kind := 'presidency';
  elsif d.proposer_party like 'team:%' then
    v_kind := 'team';
    v_team := substring(d.proposer_party from 6)::uuid;
  elsif d.proposer_party like 'project:%' then
    v_kind := 'project';
    v_project := substring(d.proposer_party from 9)::uuid;
  else
    -- Reached when nothing could be derived: either the proposer may not book
    -- a room at all, or they run several projects and only they know which one
    -- this meeting belongs to.
    raise exception
      'We could not work out which group is booking this room. If you manage more than one project, book the room from the Rooms schedule instead; otherwise you do not have permission to book one.'
      using errcode = '42501';
  end if;

  if r.submitted_by = app.current_member_id()
     and not app.can('rooms.book', p_team => v_team, p_project => v_project) then
    raise exception 'You cannot book a room as that group'
      using errcode = '42501';
  end if;

  if d.booking_id is not null then
    delete from room_bookings where id = d.booking_id and status = 'held';
  end if;

  insert into room_bookings (
    room_id, starts_at, ends_at, status,
    party_kind, team_id, project_id, booked_by, title
  ) values (
    v_room, v_start, v_end, 'held',
    v_kind, v_team, v_project, r.submitted_by,
    coalesce(nullif(r.data ->> 'title', ''), 'Meeting')
  )
  returning * into v_booking;

  update meeting_details set booking_id = v_booking.id where request_id = p_request;
end;
$$;

-- -----------------------------------------------------------------------------
-- Take the question off the forms
-- -----------------------------------------------------------------------------

update request_types
   set field_schema = (
     select jsonb_agg(field)
     from jsonb_array_elements(field_schema) field
     where field ->> 'key' <> 'proposer_identity'
   )
 where key = 'meeting_request';

update request_transitions rt
   set field_schema = (
     select coalesce(jsonb_agg(field), '[]'::jsonb)
     from jsonb_array_elements(rt.field_schema) field
     where field ->> 'key' <> 'proposer_identity'
   )
 where rt.field_schema @> '[{"key":"proposer_identity"}]'::jsonb;

-- -----------------------------------------------------------------------------
-- The Money Request, renamed
-- -----------------------------------------------------------------------------

update request_types
   set name_en = 'Fund Request',
       name_ar = 'أمر صرف',
       description_en = 'Ask Finance to approve a purchase or a reimbursement.',
       description_ar = 'طلب موافقة الفريق المالي على شراء أو تعويض.'
 where key = 'money_request';
