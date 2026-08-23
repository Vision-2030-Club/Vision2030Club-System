-- =============================================================================
-- 0029 — The Meetings component.
--
-- Step 3 of the Meetings build, and the decision the design doc turns on: a
-- meeting IS a request. It is proposed, countered, accepted or rejected and
-- audited — which is exactly what the request engine already does, unbounded
-- counter loop included (see the `meeting_request` type seeded in 0008).
--
-- So this file adds no second state machine. It adds:
--
--   1. a person as a possible target, so a meeting can be with one colleague;
--   2. `meeting_details`, for the few things about a meeting that are not
--      answers on a form — its room hold, its Meet link, and what spawned it;
--   3. `app.sync_meeting_hold`, which keeps a room held for exactly as long as
--      the negotiation needs it;
--   4. `app.meeting_recipients`, the single definition of "who is party to
--      this meeting" (§5), used by both the invite list and the calendar
--      entry so the two cannot disagree;
--   5. `app.hook_confirm_meeting`, the on-approval hook.
--
-- Everything a person TYPES about a meeting — online or in person, when, which
-- room — stays in `requests.data`, filled in by the type's own `field_schema`
-- like every other request. That is why this adds no new form.
-- =============================================================================

create type meeting_type as enum ('online', 'in_person');

-- Where the Google link has got to. The database never calls Google (a trigger
-- that makes a network call holds a transaction open for the length of it, and
-- turns a Google outage into "you cannot confirm your meeting"), so this is
-- how the app knows there is work waiting and whether it succeeded.
create type meet_state as enum ('not_needed', 'pending', 'ready', 'failed');

-- -----------------------------------------------------------------------------
-- 1. A person as a target
-- -----------------------------------------------------------------------------

alter table requests add column if not exists target_member_id uuid references members (id);

alter table requests drop constraint if exists requests_target_shape;

alter table requests add constraint requests_target_shape check (
  (target_kind = 'team'
     and target_team_id is not null and target_project_id is null and target_member_id is null)
  or (target_kind = 'project'
     and target_project_id is not null and target_team_id is null and target_member_id is null)
  or (target_kind = 'presidency'
     and target_team_id is null and target_project_id is null and target_member_id is null)
  or (target_kind = 'individual'
     and target_member_id is not null and target_team_id is null and target_project_id is null)
);

create index if not exists requests_target_member_idx on requests (target_member_id);

/*
 * Who may act for a request's target.
 *
 * The two-argument version from 0006 is replaced rather than overloaded — an
 * overload with a default would be ambiguous, and leaving both would mean two
 * definitions of the same rule. Every caller is updated below.
 *
 * The new branch is the readable one: if a request was aimed at you
 * personally, you are its approver. No permission is involved, because being
 * asked to meet is not a power anybody grants.
 */
create or replace function app.can_act_on_request(
  p_target_team    uuid,
  p_target_project uuid,
  p_target_member  uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (p_target_member is not null and p_target_member = app.current_member_id())
    or (p_target_member is null
        and app.can('requests.approve', p_team => p_target_team, p_project => p_target_project))
$$;

grant execute on function app.can_act_on_request(uuid, uuid, uuid) to authenticated;

drop policy if exists requests_select on requests;
create policy requests_select on requests
  for select using (
    submitted_by = (select app.current_member_id())
    or (select app.can_act_on_request(target_team_id, target_project_id, target_member_id))
    or (select app.can('requests.view',
                       p_team    => target_team_id,
                       p_project => target_project_id,
                       p_owner   => submitted_by))
  );

drop policy if exists requests_update on requests;
create policy requests_update on requests
  for update
  using (
    submitted_by = (select app.current_member_id())
    or (select app.can_act_on_request(target_team_id, target_project_id, target_member_id))
  )
  with check (
    submitted_by = (select app.current_member_id())
    or (select app.can_act_on_request(target_team_id, target_project_id, target_member_id))
  );

-- The transition trigger asks the same question, so it moves with the rest.
create or replace function app.validate_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule request_actor_rule;
  v_perm text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select t.actor_rule, t.required_permission
    into v_rule, v_perm
  from request_transitions t
  where t.request_type_id = new.request_type_id
    and t.from_status = old.status
    and t.to_status = new.status;

  if not found then
    raise exception 'Status change % -> % is not allowed for this request type',
      old.status, new.status
      using errcode = '23514';
  end if;

  if v_rule = 'requester' then
    if new.submitted_by is distinct from app.current_member_id() then
      raise exception 'Only the person who submitted this request can do that'
        using errcode = '42501';
    end if;

  elsif v_rule = 'target_approver' then
    if not app.can_act_on_request(new.target_team_id, new.target_project_id,
                                  new.target_member_id) then
      raise exception 'You are not an approver for this request''s target'
        using errcode = '42501';
    end if;

  elsif v_rule = 'permission' then
    if not app.can(v_perm,
                   p_team    => new.target_team_id,
                   p_project => new.target_project_id,
                   p_owner   => new.submitted_by) then
      raise exception 'That change requires the % permission', v_perm
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop function if exists app.can_act_on_request(uuid, uuid);

-- -----------------------------------------------------------------------------
-- 2. The meeting's own row
--
-- One row per meeting request, created by a trigger so it always exists and no
-- code path can forget it. Nothing here is typed by a person — the answers
-- live in `requests.data` like every other request.
-- -----------------------------------------------------------------------------

create table meeting_details (
  request_id  uuid primary key references requests (id) on delete cascade,

  -- The room held for this negotiation, and after approval the confirmed
  -- booking. Same row throughout — see app.sync_meeting_hold.
  booking_id  uuid references room_bookings (id) on delete set null,

  meet_link      text,
  meet_event_id  text,
  meet_state     meet_state not null default 'not_needed',
  meet_error     text,

  -- What asked for this meeting, if anything. The Design Request will set it
  -- in step 6. The Meetings component never looks at what KIND of thing it is
  -- — only "tell whoever this is when I am confirmed".
  origin_request_id uuid references requests (id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index meeting_details_booking_idx on meeting_details (booking_id);
create index meeting_details_origin_idx  on meeting_details (origin_request_id);

create trigger meeting_details_touch_updated_at
  before update on meeting_details
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Reading a meeting's proposal out of the request
--
-- Small helpers so the same jsonb keys are not spelled out in five places. A
-- typo in one of them would be a silently unheld room.
-- -----------------------------------------------------------------------------

create or replace function app.meeting_is_in_person(p_data jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_data ->> 'meeting_type', 'online') = 'in_person'
$$;

create or replace function app.meeting_room(p_data jsonb)
returns uuid
language sql
immutable
as $$
  select nullif(p_data ->> 'room_id', '')::uuid
$$;

create or replace function app.meeting_start(p_data jsonb)
returns timestamptz
language sql
immutable
as $$
  select nullif(p_data ->> 'proposed_start', '')::timestamptz
$$;

create or replace function app.meeting_end(p_data jsonb)
returns timestamptz
language sql
immutable
as $$
  select coalesce(
    nullif(p_data ->> 'proposed_end', '')::timestamptz,
    nullif(p_data ->> 'proposed_start', '')::timestamptz + interval '1 hour'
  )
$$;

-- Who the proposer speaks for, as picked on the form ("team:<uuid>" etc).
-- Defaults to Presidency only if nothing was chosen, which the form prevents.
create or replace function app.meeting_proposer_party(p_data jsonb)
returns text
language sql
immutable
as $$
  select nullif(p_data ->> 'proposer_identity', '')
$$;

-- -----------------------------------------------------------------------------
-- 4. The room hold (§4: "held for that negotiation from the moment the meeting
--    request is first submitted")
--
-- One function, called from two places — whenever the request's answers change
-- and whenever meeting_details changes. Both funnel here so there is exactly
-- one definition of "what room should be held right now".
--
-- It runs as the table owner because the authority for this booking is the
-- meeting itself, not the room policy: the negotiation is what reserves the
-- room, and the proposer's right to book as their group is checked explicitly
-- below rather than being inherited from `room_bookings_insert`.
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
  v_party      text;
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

  -- Once approved the hold has become a real booking; leave it alone. The
  -- confirm hook owns it from then on.
  if coalesce(v_status.is_approved, false) then
    return;
  end if;

  v_room  := app.meeting_room(r.data);
  v_start := app.meeting_start(r.data);
  v_end   := app.meeting_end(r.data);

  -- No room wanted any more: rejected, or switched to online.
  -- §2: a Counter that switches to online releases the room immediately.
  if coalesce(v_status.is_terminal, false) or not app.meeting_is_in_person(r.data) then
    if d.booking_id is not null then
      delete from room_bookings where id = d.booking_id and status = 'held';
      update meeting_details set booking_id = null where request_id = p_request;
    end if;
    return;
  end if;

  -- In person, but half-described. §2 has the room chosen AT PROPOSAL TIME, so
  -- this is refused rather than left as a meeting nobody can hold.
  if v_room is null then
    raise exception 'An in-person meeting needs a room chosen when it is proposed'
      using errcode = '23514';
  end if;

  if v_start is null or v_end is null then
    raise exception 'An in-person meeting needs a proposed time'
      using errcode = '23514';
  end if;

  -- Already holding exactly the right slot? Then there is nothing to do, and
  -- more importantly nothing to briefly release and race someone else for.
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

  -- Who the hold is booked as. §4 forbids booking on behalf of a group you are
  -- not part of, and a meeting is no exception — so this is checked here even
  -- though the insert below runs as the owner.
  v_party := app.meeting_proposer_party(r.data);

  if v_party = 'presidency' then
    v_kind := 'presidency';
  elsif v_party like 'team:%' then
    v_kind := 'team';
    v_team := substring(v_party from 6)::uuid;
  elsif v_party like 'project:%' then
    v_kind := 'project';
    v_project := substring(v_party from 9)::uuid;
  else
    raise exception 'An in-person meeting needs to say which group is booking the room'
      using errcode = '23514';
  end if;

  if not app.can('rooms.book', p_team => v_team, p_project => v_project) then
    raise exception 'You cannot book a room as that group'
      using errcode = '42501';
  end if;

  -- Release then re-place, in this one statement pair, so the negotiation
  -- never holds two slots and never briefly holds none.
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

/*
 * Every meeting request gets its details row the moment it is created, and its
 * hold at the same time. §4 wants the room held "from the moment the meeting
 * request is first submitted" — and because the exclusion constraint refuses
 * an overlapping insert, proposing a room somebody already has fails the whole
 * submission rather than starting a negotiation that cannot be honoured.
 */
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

  insert into meeting_details (request_id, meet_state)
  values (new.id, case when app.meeting_is_in_person(new.data)
                       then 'not_needed'::meet_state
                       else 'not_needed'::meet_state end)
  on conflict (request_id) do nothing;

  perform app.sync_meeting_hold(new.id);
  return new;
end;
$$;

create trigger requests_meeting_details
  after insert or update of data, status on requests
  for each row execute function app.on_meeting_request_written();

-- -----------------------------------------------------------------------------
-- 5. Who is party to a meeting (§5)
--
-- ONE definition, used by the Google invite list and by the calendar entry's
-- audience. Writing it twice is how the invite and the calendar start
-- disagreeing about who the meeting was with.
--
-- Both sides are resolved: the target, and the group the proposer speaks for.
-- No role is named — `calendar_audience_roles` already records which roles
-- count as "directors" and which count as "presidency" (0007), so moving that
-- definition is a data change here too.
-- -----------------------------------------------------------------------------

create or replace function app.party_members(
  p_kind    text,
  p_team    uuid,
  p_project uuid,
  p_member  uuid
)
returns table (member_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- One specific person.
  select p_member where p_kind = 'individual' and p_member is not null

  union

  -- Every Director that team has, whichever one did the negotiating (§5).
  select m.id
  from members m
  join calendar_audience_roles car
    on car.role_id = m.role_id and car.audience_kind = 'directors'
  where p_kind = 'team' and m.team_id = p_team and m.status = 'active'

  union

  -- Every Project Manager the project has, up to the four 0005 allows (§5).
  select pm.member_id
  from project_managers pm
  where p_kind = 'project' and pm.project_id = p_project

  union

  -- Both the President and the VP (§5).
  select m.id
  from members m
  join calendar_audience_roles car
    on car.role_id = m.role_id and car.audience_kind = 'presidency'
  where p_kind = 'presidency' and m.status = 'active'
$$;

create or replace function app.meeting_recipients(p_request uuid)
returns table (member_id uuid, email text, name_en text, name_ar text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with r as (select * from requests where id = p_request),
  target as (
    select p.member_id
    from r
    cross join lateral app.party_members(
      r.target_kind::text, r.target_team_id, r.target_project_id, r.target_member_id
    ) p
  ),
  proposer_party as (
    select
      case
        when app.meeting_proposer_party(r.data) = 'presidency' then 'presidency'
        when app.meeting_proposer_party(r.data) like 'team:%' then 'team'
        when app.meeting_proposer_party(r.data) like 'project:%' then 'project'
        else null
      end as kind,
      case when app.meeting_proposer_party(r.data) like 'team:%'
           then substring(app.meeting_proposer_party(r.data) from 6)::uuid end as team_id,
      case when app.meeting_proposer_party(r.data) like 'project:%'
           then substring(app.meeting_proposer_party(r.data) from 9)::uuid end as project_id
    from r
  ),
  proposer as (
    select p.member_id
    from proposer_party pp
    cross join lateral app.party_members(pp.kind, pp.team_id, pp.project_id, null) p
    where pp.kind is not null
  ),
  everyone as (
    select member_id from target
    union
    select member_id from proposer
    union
    -- The person who actually filed it, always.
    select submitted_by from r
  )
  select m.id, m.email::text, m.name_en, m.name_ar
  from everyone e
  join members m on m.id = e.member_id
  where m.status <> 'inactive'
  order by m.name_en
$$;

grant execute on function app.meeting_recipients(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Confirmation (§2)
--
-- Registered as the meeting_request type's on-approval hook, replacing
-- `create_calendar_entry`: the calendar entry is still written, but now it is
-- one of three things confirmation does rather than the only one.
-- -----------------------------------------------------------------------------

create or replace function app.hook_confirm_meeting(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          requests%rowtype;
  d          meeting_details%rowtype;
  v_entry    uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_other    text;
  v_rows     integer;
begin
  select * into r from requests where id = p_request;
  select * into d from meeting_details where request_id = p_request;

  v_start := app.meeting_start(r.data);
  v_end   := app.meeting_end(r.data);

  if v_start is null then
    raise exception 'This meeting has no agreed time yet' using errcode = '23514';
  end if;

  -- --- the room ------------------------------------------------------------
  if app.meeting_is_in_person(r.data) then
    -- §2: if the room is gone, Confirm FAILS. It is never silently confirmed
    -- without the room it was agreed for.
    update room_bookings
       set status     = 'booked',
           other_kind = case r.target_kind
                          when 'team' then 'team'::booking_party_kind
                          when 'project' then 'project'::booking_party_kind
                          when 'presidency' then 'presidency'::booking_party_kind
                          else null
                        end,
           other_team_id    = r.target_team_id,
           other_project_id = r.target_project_id,
           other_member_id  = r.target_member_id
     where id = d.booking_id
       and status = 'held';

    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      raise exception
        'That room is no longer held for this meeting. Suggest another time, or start again with a different room.'
        using errcode = '55006';
    end if;
  end if;

  -- --- the Meet link -------------------------------------------------------
  -- Marked as work waiting, not done here: see the comment on `meet_state`.
  if not app.meeting_is_in_person(r.data) then
    update meeting_details set meet_state = 'pending' where request_id = p_request;
  end if;

  -- --- the calendar entry --------------------------------------------------
  if exists (select 1 from calendar_entries where source_request_id = r.id) then
    return;
  end if;

  insert into calendar_entries (
    kind, title, description, starts_at, ends_at, all_day, location,
    category, color, created_by, source_request_id,
    meeting_scope_kind, meeting_scope_team_id, meeting_scope_project_id
  )
  values (
    'meeting',
    coalesce(nullif(r.data ->> 'title', ''), 'Meeting'),
    r.data ->> 'description',
    v_start,
    v_end,
    false,
    case when app.meeting_is_in_person(r.data)
         then (select coalesce(name_en, '') from rooms where id = app.meeting_room(r.data))
         else nullif(r.data ->> 'location', '') end,
    'meeting',
    '#007a8f',
    r.submitted_by,
    r.id,
    -- An individual meeting has no team/project scope; the shape constraint on
    -- calendar_entries allows a meeting with none.
    case when r.target_kind in ('team', 'project', 'presidency')
         then r.target_kind::text::meeting_scope_kind end,
    r.target_team_id,
    r.target_project_id
  )
  returning id into v_entry;

  /*
   * §2: visibility is fixed to exactly the people who are party to the
   * meeting — no audience picker, no widening afterwards. Using the same
   * function the invite list uses is what stops the two drifting apart.
   */
  insert into calendar_entry_audiences (entry_id, audience_kind, member_id)
  select v_entry, 'individual', rec.member_id
  from app.meeting_recipients(r.id) rec
  on conflict do nothing;
end;
$$;

insert into request_hooks (name, function_schema, function_name, description)
values (
  'confirm_meeting',
  'app',
  'hook_confirm_meeting',
  'Turns the room hold into a booking, queues the Meet link, and writes the calendar entry when a Meeting Request is approved.'
)
on conflict (name) do update
  set function_schema = excluded.function_schema,
      function_name   = excluded.function_name,
      description     = excluded.description;

-- -----------------------------------------------------------------------------
-- 7. A meeting's calendar entry is a PROJECTION, not a record of its own
--
-- The calendar gained editing in an earlier step. Dragging a meeting's entry to
-- another time would leave the entry and the room booking disagreeing, with the
-- room still held at the old hour. So entries that came from a request are
-- read-only: to change a meeting, counter it.
-- -----------------------------------------------------------------------------

create or replace function app.guard_sourced_calendar_entry()
returns trigger
language plpgsql
as $$
begin
  if old.source_request_id is null then
    return new;
  end if;

  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.location is distinct from old.location
     or new.title is distinct from old.title
  then
    raise exception
      'This entry comes from an agreed meeting. Change the meeting itself rather than the calendar.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger calendar_entries_guard_sourced
  before update on calendar_entries
  for each row execute function app.guard_sourced_calendar_entry();

-- -----------------------------------------------------------------------------
-- 8. RLS for the new table
-- -----------------------------------------------------------------------------

alter table meeting_details enable row level security;

-- Visible exactly when its request is: the sub-select is itself filtered by
-- `requests_select`, so there is no second visibility rule to keep in step.
create policy meeting_details_select on meeting_details
  for select using (
    exists (select 1 from requests r where r.id = meeting_details.request_id)
  );

-- Written only by the triggers and hooks above, which run as the owner. There
-- is deliberately no insert/update policy: nothing a person types belongs here.
grant select on meeting_details to authenticated;
revoke insert, update, delete on meeting_details from authenticated;
