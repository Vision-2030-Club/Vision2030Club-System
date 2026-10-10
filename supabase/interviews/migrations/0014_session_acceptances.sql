-- =============================================================================
-- 0014 — Accepted lists per assignment (a company in a room on one day).
--
-- A company can interview on several days. HR wants one company, not one per
-- day, and to decide which day each student comes: the Rooms tab now gives
-- every assignment (a session: one company, one room, one day and hours) its
-- own candidate link and accepted phone list. A student on an assignment's
-- list books only that assignment's times.
--
--   1. session_acceptances: who HR accepted for which assignment. Taking a
--      student off a list sets revoked_at; nothing is deleted. The row goes
--      only with its session, and the app refuses to remove an assignment
--      while anyone is accepted on it.
--
--   2. accept_for_session: like accept_for_company (0013), for one
--      assignment. It also accepts the student for the assignment's company
--      (application_preferences), which do_book (0002) still checks, so
--      counters, the applicant page and the acceptance email work as before.
--      A number that never applied becomes a phone-only application.
--      unaccept_for_session takes them off the list, and puts the company
--      back to pending when no other list of that company holds them.
--
--   3. book_slot and move_booking (the student's own) refuse a time outside
--      the student's assignments, when they have any for that company. A
--      student accepted the old way (per company, no assignment) can still
--      book any time of the company. Staff booking is not restricted.
--      The bodies are 0012's with that one check added: apply 0012 first.
--
-- Apply after 0012 and 0013. Can be run twice. Nothing is deleted.
-- =============================================================================

alter table applications alter column email drop not null;

create table if not exists session_acceptances (
  id              uuid primary key default gen_random_uuid(),
  edition_id      uuid not null references editions (id) on delete cascade,
  session_id      uuid not null references sessions (id) on delete cascade,
  application_id  uuid not null references applications (id) on delete cascade,
  accepted_at     timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (session_id, application_id)
);

create index if not exists session_acceptances_application_idx on session_acceptances (application_id);

alter table session_acceptances enable row level security;

drop trigger if exists session_acceptances_audit on session_acceptances;
create trigger session_acceptances_audit
  after insert or update or delete on session_acceptances
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- 2. HR's list, per assignment.
-- ---------------------------------------------------------------------------

create or replace function public.accept_for_session(
  p_session      uuid,
  p_application  uuid,
  p_phone        text,
  p_token        text,
  p_actor        jsonb
)
returns session_acceptances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s       sessions;
  v_app   applications;
  v_rank  integer;
  v_acc   session_acceptances;
begin
  perform app.set_actor(p_actor);

  select * into s from sessions where id = p_session;
  if s.id is null then
    perform app.refuse('not_found', 'No such assignment.');
  end if;

  if p_application is not null then
    select * into v_app from applications a where a.id = p_application and a.edition_id = s.edition_id;
    if v_app.id is null then
      perform app.refuse('not_found', 'No such application.');
    end if;
  else
    if nullif(btrim(coalesce(p_phone, '')), '') is null then
      perform app.refuse('missing_phone', 'Enter a phone number.');
    end if;
    insert into applications (edition_id, phone, name, personal_token)
    values (s.edition_id, btrim(p_phone), '', p_token)
    returning * into v_app;
  end if;

  -- The company, as decide_preference and accept_for_company do it.
  update application_preferences ap
     set decision = 'accepted', decided_at = now()
   where ap.application_id = v_app.id and ap.company_id = s.company_id;
  if not found then
    select coalesce(max(rank), 0) + 1 into v_rank
      from application_preferences where application_id = v_app.id;
    insert into application_preferences (edition_id, application_id, company_id, rank, decision, decided_at)
    values (s.edition_id, v_app.id, s.company_id, v_rank, 'accepted', now());
  end if;

  insert into session_acceptances (edition_id, session_id, application_id)
  values (s.edition_id, s.id, v_app.id)
  on conflict (session_id, application_id)
    do update set revoked_at = null, accepted_at = case when session_acceptances.revoked_at is null
                                                        then session_acceptances.accepted_at else now() end
  returning * into v_acc;

  perform app.enqueue_email(
    s.edition_id, v_app.id, 'accepted',
    jsonb_build_object('application_id', v_app.id),
    'accepted:' || v_app.id::text);

  return v_acc;
end;
$$;

create or replace function public.unaccept_for_session(
  p_session      uuid,
  p_application  uuid,
  p_actor        jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s sessions;
begin
  perform app.set_actor(p_actor);

  select * into s from sessions where id = p_session;
  if s.id is null then
    perform app.refuse('not_found', 'No such assignment.');
  end if;

  update session_acceptances
     set revoked_at = now()
   where session_id = s.id and application_id = p_application and revoked_at is null;

  -- On no other list of this company: not accepted for it any more.
  if not exists (
    select 1 from session_acceptances sa join sessions se on se.id = sa.session_id
     where sa.application_id = p_application and sa.revoked_at is null and se.company_id = s.company_id
  ) then
    update application_preferences
       set decision = 'pending', decided_at = null
     where application_id = p_application and company_id = s.company_id and decision = 'accepted';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A student books only within their assignments.
-- ---------------------------------------------------------------------------

create or replace function app.refuse_outside_sessions(p_app applications, p_slot uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  sl slots;
begin
  select * into sl from slots where id = p_slot;
  if sl.id is null then
    return;  -- do_book / do_move refuse a missing slot in their own words
  end if;
  if exists (
       select 1 from session_acceptances sa join sessions se on se.id = sa.session_id
        where sa.application_id = p_app.id and sa.revoked_at is null and se.company_id = sl.company_id
     )
     and not exists (
       select 1 from session_acceptances sa
        where sa.application_id = p_app.id and sa.revoked_at is null and sa.session_id = sl.session_id
     ) then
    perform app.refuse('not_your_session', 'This time is not on the day you were given.');
  end if;
end;
$$;

create or replace function public.book_slot(p_token text, p_slot uuid)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a  applications;
  e  editions;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));
  perform app.refuse_outside_sessions(a, p_slot);

  return app.do_book(a, p_slot, 'student');
end;
$$;

create or replace function public.move_booking(p_token text, p_booking uuid, p_slot uuid)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a  applications;
  e  editions;
  b  bookings;
begin
  a := app.student_by_token(p_token);
  e := app.live_edition(a.edition_id);
  perform app.booking_open(e);
  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', a.id, 'name', a.name));

  select * into b from bookings where id = p_booking and application_id = a.id and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'That booking is not yours, or was cancelled.');
  end if;
  perform app.within_cutoff(e, b.starts_at);
  perform app.refuse_outside_sessions(a, p_slot);

  return app.do_move(b, p_slot, 'student');
end;
$$;
