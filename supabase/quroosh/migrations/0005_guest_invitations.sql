-- =============================================================================
-- Quroosh database — 0005: guest invitations and their bookings.
--
-- The project's managers invite guests (speakers, for now) to a Quroosh
-- event. Each guest gets a personal link (and its QR code) that needs no
-- account: the link's token is the only key. On it the guest picks ONE of
-- the times the managers offer, and gives a phone number and whether they
-- need transport (and then the number of their driver or office manager).
--
-- This is separate from the founders' applications (0001–0004): nothing
-- here reads or changes them, and these tables have no link to `settings`,
-- so offering guest slots never makes an application form exist.
--
-- Tables:
--   guest_slots        a time a guest can book: a start (sessions are a fixed
--                      45 minutes, so there is no end), on or off. Never
--                      deleted, only turned off.
--   guest_invitations  one per invited guest: the link's token, the role, the
--                      name, and the booking (the slot, the phones, transport).
--
-- One guest per slot: a unique index on guest_invitations.slot_id. Two guests
-- choosing the same time race on that index, and the loser is refused with
-- the hint `slot_taken`. Nothing checks first and writes after.
--
-- An invitation's status is not stored; it is read from the row:
--   cancelled_at set  cancelled
--   slot_id set       booked
--   otherwise         invited
--
-- Times are timestamptz. The app writes them with the zone name inside the
-- literal (`2026-11-21 14:00:00 Asia/Riyadh`, src/lib/time.ts) and shows them
-- on the club's clock, whatever the viewer's own time zone.
--
-- As everywhere in this database: Row Level Security on and NO policies,
-- every function executable by service_role only, and this database never
-- checks identity. The app asks the club database whether the person manages
-- the project before calling a manager's function, and passes their member
-- id as p_actor. The guests' functions take the link's token instead.
--
-- Nothing is deleted. Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Slots
-- -----------------------------------------------------------------------------

create table if not exists guest_slots (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,                  -- the club database's projects.id
  starts_at   timestamptz not null,
  active      boolean not null default true,  -- off: not offered to guests
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,                           -- the club member who changed it
  -- The same time twice in one project would be two slots nobody can tell apart.
  constraint guest_slots_project_time_unique unique (project_id, starts_at)
);

comment on table guest_slots is
  'A time a guest can book for a club project''s Quroosh event (0005). Sessions are 45 minutes. Never deleted, only turned off.';

-- -----------------------------------------------------------------------------
-- Invitations, each holding its booking
-- -----------------------------------------------------------------------------

create table if not exists guest_invitations (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null,             -- the club database's projects.id
  -- The guest's link: /quroosh/invite/<token>. Made by the app (newToken).
  token            text not null unique
                     constraint guest_invitations_token_shape check (token ~ '^[0-9a-f]{32,128}$'),
  -- Speakers only for now. To add a role, replace this CHECK in a new
  -- migration and add its wording to both catalogs.
  role             text not null default 'speaker'
                     constraint guest_invitations_role_check check (role in ('speaker')),
  name             text not null
                     constraint guest_invitations_name_shape check (char_length(btrim(name)) between 1 and 200),
  note             text                       -- the managers' own note; never shown to the guest
                     constraint guest_invitations_note_shape check (note is null or char_length(note) <= 2000),

  -- The booking. Empty until the guest books.
  slot_id          uuid references guest_slots (id),
  -- International numbers: + and the country code, digits only (E.164).
  phone            text
                     constraint guest_invitations_phone_shape check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  needs_transport  boolean,
  transport_phone  text
                     constraint guest_invitations_transport_phone_shape
                     check (transport_phone is null or transport_phone ~ '^\+[1-9][0-9]{7,14}$'),
  booked_at        timestamptz,

  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid,                      -- the club member who invited them
  updated_at       timestamptz not null default now(),
  updated_by       uuid,                      -- null when the guest made the change

  -- A booking always says how to reach the guest.
  constraint guest_invitations_booking_complete
    check (slot_id is null or (phone is not null and needs_transport is not null and booked_at is not null)),
  -- A driver's number only with transport asked for.
  constraint guest_invitations_transport_needed
    check (transport_phone is null or needs_transport),
  -- A cancelled invitation holds no slot.
  constraint guest_invitations_cancelled_free
    check (cancelled_at is null or slot_id is null)
);

comment on table guest_invitations is
  'A guest invited to a club project''s Quroosh event, and their booking (0005). Personal data: the app shows it to the project''s managers only.';

-- One guest per slot: the claim itself. A second booking of a slot fails here.
create unique index if not exists guest_invitations_slot_once
  on guest_invitations (slot_id) where slot_id is not null;

create index if not exists guest_invitations_project_idx
  on guest_invitations (project_id, created_at desc);

-- Deny-all: RLS on, no policies. Only the secret key (service_role) gets in.
alter table guest_slots       enable row level security;
alter table guest_invitations enable row level security;

-- -----------------------------------------------------------------------------
-- Managers: slots
-- -----------------------------------------------------------------------------

-- Adds a slot (p_slot null) or changes a slot's time. A booked slot's time is
-- not changed: the guest agreed to it. Move or cancel the booking first.
create or replace function public.save_slot(
  p_project uuid,
  p_actor uuid,
  p_slot uuid,
  p_starts_at timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_starts_at is null then
    perform app.refuse('invalid', 'Choose a day and a time.');
  end if;

  if p_slot is null then
    insert into guest_slots (project_id, starts_at, updated_by)
    values (p_project, p_starts_at, p_actor)
    returning id into v_id;
  else
    -- Locked so a guest cannot book it between the check and the change.
    perform 1 from guest_slots s where s.id = p_slot and s.project_id = p_project for update;
    if not found then
      perform app.refuse('not_found', 'This slot does not exist.');
    end if;
    if exists (select 1 from guest_invitations i where i.slot_id = p_slot) then
      perform app.refuse('slot_booked', 'This slot is booked. Cancel or move the booking first.');
    end if;
    update guest_slots
       set starts_at = p_starts_at, updated_at = now(), updated_by = p_actor
     where id = p_slot
    returning id into v_id;
  end if;

  return v_id;
exception
  when unique_violation then
    perform app.refuse('slot_exists', 'There is already a slot at this time.');
end;
$$;

-- Turns a slot on or off. A booked slot is not turned off.
create or replace function public.set_slot_active(
  p_project uuid,
  p_actor uuid,
  p_slot uuid,
  p_active boolean
)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  if p_active is null then
    perform app.refuse('invalid', 'Say whether the slot is on or off.');
  end if;
  perform 1 from guest_slots s where s.id = p_slot and s.project_id = p_project for update;
  if not found then
    perform app.refuse('not_found', 'This slot does not exist.');
  end if;
  if not p_active and exists (select 1 from guest_invitations i where i.slot_id = p_slot) then
    perform app.refuse('slot_booked', 'This slot is booked. Cancel or move the booking first.');
  end if;
  update guest_slots
     set active = p_active, updated_at = now(), updated_by = p_actor
   where id = p_slot;
end;
$$;

-- -----------------------------------------------------------------------------
-- Managers: invitations and bookings
-- -----------------------------------------------------------------------------

-- Invites a guest. The token is the app's (newToken), so the link can be
-- shown straight away.
create or replace function public.create_invitation(
  p_project uuid,
  p_actor uuid,
  p_token text,
  p_name text,
  p_note text default null
)
returns uuid
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into guest_invitations (project_id, token, name, note, created_by, updated_by)
  values (p_project, p_token, btrim(coalesce(p_name, '')), nullif(btrim(coalesce(p_note, '')), ''), p_actor, p_actor)
  returning id into v_id;
  return v_id;
exception
  when check_violation or not_null_violation or unique_violation then
    perform app.refuse('invalid', 'The invitation is not valid: ' || sqlerrm);
end;
$$;

-- Cancels an invitation, and frees its slot. The link then says so. The
-- guest's phones stay on the row for the managers.
create or replace function public.cancel_invitation(
  p_project uuid,
  p_actor uuid,
  p_invitation uuid
)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  update guest_invitations
     set cancelled_at = coalesce(cancelled_at, now()),
         slot_id = null,
         booked_at = null,
         updated_at = now(),
         updated_by = p_actor
   where id = p_invitation and project_id = p_project;
  if not found then
    perform app.refuse('not_found', 'This invitation does not exist.');
  end if;
end;
$$;

-- Moves a booking to another free slot of the same project.
create or replace function public.move_booking(
  p_project uuid,
  p_actor uuid,
  p_invitation uuid,
  p_slot uuid
)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_inv guest_invitations;
begin
  select * into v_inv from guest_invitations i
   where i.id = p_invitation and i.project_id = p_project
   for update;
  if not found then
    perform app.refuse('not_found', 'This invitation does not exist.');
  end if;
  if v_inv.cancelled_at is not null then
    perform app.refuse('invitation_cancelled', 'This invitation was cancelled.');
  end if;
  if v_inv.slot_id is null then
    perform app.refuse('not_booked', 'This guest has not booked a slot.');
  end if;

  -- Shared lock: a manager cannot turn the slot off or move it meanwhile.
  perform 1 from guest_slots s
   where s.id = p_slot and s.project_id = p_project and s.active
   for share;
  if not found then
    perform app.refuse('slot_unavailable', 'This slot is not offered.');
  end if;

  begin
    update guest_invitations
       set slot_id = p_slot, updated_at = now(), updated_by = p_actor
     where id = p_invitation;
  exception
    when unique_violation then
      perform app.refuse('slot_taken', 'Another guest has booked this slot.');
  end;
end;
$$;

-- Cancels a booking but not the invitation: the slot is free again, and the
-- guest's link offers the free slots again. The phones stay on the row.
create or replace function public.cancel_booking(
  p_project uuid,
  p_actor uuid,
  p_invitation uuid
)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  update guest_invitations
     set slot_id = null, booked_at = null, updated_at = now(), updated_by = p_actor
   where id = p_invitation and project_id = p_project;
  if not found then
    perform app.refuse('not_found', 'This invitation does not exist.');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Guests, by the link's token
-- -----------------------------------------------------------------------------

-- What the guest's page shows: who they are and their booking, if any. No
-- row: the link is unknown. The note and the phones are not returned.
create or replace function public.invitation(p_token text)
returns table (
  name          text,
  role          text,
  cancelled     boolean,
  slot_id       uuid,
  starts_at     timestamptz,
  booked_at     timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select i.name, i.role, i.cancelled_at is not null, i.slot_id, s.starts_at, i.booked_at
    from guest_invitations i
    left join guest_slots s on s.id = i.slot_id
   where i.token = p_token;
$$;

-- The times the guest may choose: on, not yet started, and not booked.
-- Nothing for an unknown or cancelled link.
create or replace function public.open_slots(p_token text)
returns table (id uuid, starts_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.id, s.starts_at
    from guest_invitations i
    join guest_slots s on s.project_id = i.project_id
   where i.token = p_token
     and i.cancelled_at is null
     and s.active
     and s.starts_at > now()
     and not exists (select 1 from guest_invitations b where b.slot_id = s.id)
   order by s.starts_at;
$$;

-- The guest books a slot. Once booked, only a manager changes it. Phones
-- arrive in E.164 (the app's country picker builds them). Returns the
-- slot's start, for the confirmation.
create or replace function public.book_slot(
  p_token text,
  p_slot uuid,
  p_phone text,
  p_needs_transport boolean,
  p_transport_phone text default null
)
returns timestamptz
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_inv   guest_invitations;
  v_start timestamptz;
begin
  select * into v_inv from guest_invitations i where i.token = p_token for update;
  if not found then
    perform app.refuse('not_found', 'This invitation does not exist.');
  end if;
  if v_inv.cancelled_at is not null then
    perform app.refuse('invitation_cancelled', 'This invitation was cancelled.');
  end if;
  if v_inv.slot_id is not null then
    perform app.refuse('already_booked', 'You have already booked a slot.');
  end if;
  if p_needs_transport is null then
    perform app.refuse('invalid', 'Say whether you need transport.');
  end if;
  if p_needs_transport and nullif(btrim(coalesce(p_transport_phone, '')), '') is null then
    perform app.refuse('transport_phone_missing', 'Give the number of your driver or office manager.');
  end if;

  -- Shared lock: a manager cannot turn the slot off or move it meanwhile.
  select s.starts_at into v_start from guest_slots s
   where s.id = p_slot
     and s.project_id = v_inv.project_id
     and s.active
     and s.starts_at > now()
   for share;
  if not found then
    perform app.refuse('slot_unavailable', 'This time is no longer offered.');
  end if;

  begin
    update guest_invitations
       set slot_id = p_slot,
           phone = nullif(btrim(coalesce(p_phone, '')), ''),
           needs_transport = p_needs_transport,
           transport_phone = case when p_needs_transport
                                  then nullif(btrim(coalesce(p_transport_phone, '')), '') end,
           booked_at = now(),
           updated_at = now(),
           updated_by = null
     where id = v_inv.id;
  exception
    -- The claim: another guest booked this slot first.
    when unique_violation then
      perform app.refuse('slot_taken', 'Another guest has just booked this time. Choose another.');
    when check_violation or not_null_violation then
      perform app.refuse('invalid', 'Some answers are missing or not valid: ' || sqlerrm);
  end;

  return v_start;
end;
$$;

-- -----------------------------------------------------------------------------
-- Server only: nobody but the secret key runs these.
-- -----------------------------------------------------------------------------

revoke execute on function public.save_slot(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_slot_active(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.create_invitation(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.cancel_invitation(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.move_booking(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.invitation(text) from public, anon, authenticated;
revoke execute on function public.open_slots(text) from public, anon, authenticated;
revoke execute on function public.book_slot(text, uuid, text, boolean, text) from public, anon, authenticated;

grant execute on function public.save_slot(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.set_slot_active(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.create_invitation(uuid, uuid, text, text, text) to service_role;
grant execute on function public.cancel_invitation(uuid, uuid, uuid) to service_role;
grant execute on function public.move_booking(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_booking(uuid, uuid, uuid) to service_role;
grant execute on function public.invitation(text) to service_role;
grant execute on function public.open_slots(text) to service_role;
grant execute on function public.book_slot(text, uuid, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
