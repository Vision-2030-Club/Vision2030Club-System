-- =============================================================================
-- 0031 — The proposer's side is decided once, at proposal time.
--
-- Found by `npm run db:meetings`: when the TARGET countered with a new time,
-- `app.sync_meeting_hold` re-checked "may you book as this group?" — and
-- `app.can` always asks about whoever is currently acting. The Media Director
-- countering a meeting proposed by Design was therefore asked whether they
-- could book as Design, which they cannot, so the counter was refused.
--
-- The rule was wrong, not just the timing. §4 says the room is booked for the
-- group the PROPOSER speaks for; who is countering has nothing to do with it.
--
-- So the party is pinned to `meeting_details` when the meeting is created and
-- never read from the request's answers again. That fixes the counter and
-- closes a smaller hole at the same time: a target could otherwise have
-- countered with `proposer_identity` changed to a group nobody had been
-- checked against.
-- =============================================================================

alter table meeting_details add column if not exists proposer_party text;

comment on column meeting_details.proposer_party is
  'Which group the proposer speaks for — "presidency", "team:<uuid>" or
   "project:<uuid>". Set once, when the meeting is created, and deliberately
   NOT re-read from requests.data afterwards: a counter changes the time, the
   room or the format, never who is booking.';

-- Fill in anything created before this file existed.
update meeting_details d
   set proposer_party = app.meeting_proposer_party(r.data)
  from requests r
 where r.id = d.request_id
   and d.proposer_party is null;

-- -----------------------------------------------------------------------------
-- The hold, now reading the pinned party
-- -----------------------------------------------------------------------------

create or replace function app.sync_meeting_hold(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r            requests%rowtype;
  d            meeting_details%rowtype;
  v_status     request_statuses%rowtype;
  v_room       uuid;
  v_start      timestamptz;
  v_end        timestamptz;
  v_kind       booking_party_kind;
  v_team       uuid;
  v_project    uuid;
  v_booking    room_bookings%rowtype;
begin
  select * into r from requests where id = p_request;
  if not found then return; end if;

  select * into d from meeting_details where request_id = p_request;
  if not found then return; end if;

  select * into v_status
  from request_statuses
  where request_type_id = r.request_type_id and key = r.status;

  -- Once approved the hold has become a real booking; the confirm hook owns it.
  if coalesce(v_status.is_approved, false) then
    return;
  end if;

  v_room  := app.meeting_room(r.data);
  v_start := app.meeting_start(r.data);
  v_end   := app.meeting_end(r.data);

  -- No room wanted any more: rejected, or countered to online (§2).
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

  -- Already holding exactly the right slot: nothing to do, and nothing to
  -- briefly release and race somebody else for.
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

  -- The PROPOSER's group, pinned when the meeting was created.
  if d.proposer_party = 'presidency' then
    v_kind := 'presidency';
  elsif d.proposer_party like 'team:%' then
    v_kind := 'team';
    v_team := substring(d.proposer_party from 6)::uuid;
  elsif d.proposer_party like 'project:%' then
    v_kind := 'project';
    v_project := substring(d.proposer_party from 9)::uuid;
  else
    raise exception 'An in-person meeting needs to say which group is booking the room'
      using errcode = '23514';
  end if;

  /*
   * Checked only while the proposer themself is acting — which is every path
   * that can CHOOSE the group: creating the meeting, and the requester's own
   * counters. A counter from the other side cannot change the party (it is
   * pinned above), so there is nothing left to authorise, and asking `app.can`
   * about them would be asking the wrong person entirely.
   */
  if r.submitted_by = app.current_member_id()
     and not app.can('rooms.book', p_team => v_team, p_project => v_project) then
    raise exception 'You cannot book a room as that group'
      using errcode = '42501';
  end if;

  -- Release then re-place together, so the negotiation never holds two slots
  -- and never briefly holds none.
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
-- Pin the party when the meeting is created
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

  -- `do nothing` on conflict, so a later UPDATE never overwrites the party
  -- that was settled when the meeting was proposed.
  insert into meeting_details (request_id, proposer_party)
  values (new.id, app.meeting_proposer_party(new.data))
  on conflict (request_id) do nothing;

  perform app.sync_meeting_hold(new.id);
  return new;
end;
$$;
