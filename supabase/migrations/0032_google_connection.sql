-- =============================================================================
-- 0032 — The club's Google connection.
--
-- One shared Google account creates every Meet link (§3), authorised once and
-- stored here. The club's account is a personal @gmail.com, which rules out
-- the Meet API — it is a Workspace product, and it cannot send invitations
-- anyway. So we use the Calendar API, and Google mints the Meet link as part
-- of the event.
--
-- To honour what §3 actually wanted — nothing cluttering that account's own
-- calendar — every event goes on a SECONDARY calendar created for the club and
-- nothing else. Its id is stored below the moment it is created.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The credential
--
-- RLS is enabled and there are deliberately NO policies. A table with RLS on
-- and no policy denies everyone, which means the only thing that can read this
-- row is the service-role client — the same discipline the Super Admin
-- password reset already uses. There is no view, no RPC and no page that can
-- surface the token.
--
-- The client ID and client SECRET are NOT here. They live in environment
-- variables next to the Supabase keys, because they identify the application
-- rather than the account, and they never change per-club.
-- -----------------------------------------------------------------------------

create table google_credentials (
  id             boolean primary key default true check (id),

  -- Long-lived, and the only thing that lets the server act as the club
  -- account. Stored rather than kept in an env var so that re-authorising is a
  -- button a Super Admin presses, not a redeploy.
  refresh_token  text not null,
  scopes         text[] not null default '{}',
  google_email   text,

  -- The secondary calendar events are written to. Created on first use.
  calendar_id    text,

  connected_by   uuid references members (id),
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table google_credentials enable row level security;

-- Said twice on purpose: the empty policy list is the rule, and this makes an
-- attempt fail outright instead of silently matching no rows.
revoke all on google_credentials from authenticated, anon;

create trigger google_credentials_touch_updated_at
  before update on google_credentials
  for each row execute function app.touch_updated_at();

comment on table google_credentials is
  'One row. Readable only by the service role — RLS is enabled with no policies
   at all. Never expose this through a view, an RPC, or a page.';

-- -----------------------------------------------------------------------------
-- Who may connect it
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('integrations.configure',
   'Connect the club''s Google account',
   'ربط حساب جوجل الخاص بالنادي')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

insert into role_permissions (role_id, permission_key, scope)
select r.id, 'integrations.configure', 'none'::permission_scope
from roles r
on conflict (role_id, permission_key) do nothing;

update role_permissions rp
   set scope = 'all'
  from roles r
 where r.id = rp.role_id
   and r.key = 'super_admin'
   and rp.permission_key = 'integrations.configure';

-- -----------------------------------------------------------------------------
-- What the server needs to build one invitation
--
-- Granted to the service role ONLY. It returns members' real email addresses,
-- which is exactly what an invite needs and exactly what no signed-in user
-- should be able to enumerate through an RPC.
--
-- The attendee list comes from `app.meeting_recipients` — the same function
-- the calendar entry's audience is built from (0029). That is the whole point:
-- the invitation and the calendar cannot disagree about who the meeting is
-- with, because there is only one definition of it.
-- -----------------------------------------------------------------------------

create or replace function public.meeting_invite_payload(p_request uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'title',       coalesce(nullif(r.data ->> 'title', ''), 'Meeting'),
    'description', r.data ->> 'description',
    'starts_at',   app.meeting_start(r.data),
    'ends_at',     app.meeting_end(r.data),
    'location',    nullif(r.data ->> 'location', ''),
    'is_online',   not app.meeting_is_in_person(r.data),
    'attendees',   coalesce(
      (select jsonb_agg(rec.email order by rec.email)
         from app.meeting_recipients(r.id) rec),
      '[]'::jsonb
    )
  )
  from requests r
  where r.id = p_request
$$;

revoke all on function public.meeting_invite_payload(uuid) from public, authenticated, anon;
grant execute on function public.meeting_invite_payload(uuid) to service_role;

-- Finding the work waiting. §3 wants the link created the moment a meeting is
-- confirmed; this index is for the retry pass that catches whatever the
-- request that confirmed it could not finish — a Google outage, a expired
-- token, a deploy mid-flight.
create index meeting_details_meet_pending_idx
  on meeting_details (meet_state)
  where meet_state in ('pending', 'failed');
