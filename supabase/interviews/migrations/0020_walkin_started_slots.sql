-- =============================================================================
-- 0020 — A walk-in can be given a time that has started but is not over.
--
-- 0016 offered a walk-in only a time that had not started yet. A no-show is
-- found, and its booking deleted at Reception, only once its time has
-- started, so the time it frees was never offered to a walk-in: the desk saw
-- it free on the board but not in the walk-in picker, and a walk-in could
-- not be confirmed into it (slot_past). The club's decision (2026-10-20): a
-- free time can be given to a walk-in until it ENDS.
--
--   walkin_slots(e)      now: ends_at > now() (was starts_at > now())
--   confirm_walkin(...)  slot_past now refused only once the time is over
--
-- Everything else in both functions is 0016's, unchanged. The walk-in form's
-- "a company with a free time left today" follows walkin_slots, so it too
-- counts a time that has started but is not over.
--
-- Apply after 0019. Can be run twice. Nothing is deleted.
-- =============================================================================

create or replace function public.walkin_slots(p_edition uuid)
returns table (slot_id uuid, company_id uuid, room_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with st as (
    select coalesce(app.edition_settings(p_edition) -> 'walkins_off_companies', '[]'::jsonb) as off
  )
  select s.id, s.company_id, s.room_id, s.starts_at, s.ends_at
    from slots s
    join sessions se on se.id = s.session_id
    join companies c on c.id = s.company_id
    cross join st
   where s.edition_id = p_edition
     and se.day = app.edition_today(p_edition)
     -- Until the time is over, not only until it starts (0020).
     and s.ends_at > now()
     and not s.is_closed
     and not c.is_hidden
     and not (jsonb_typeof(st.off) = 'array' and st.off ? c.id::text)
     and not exists (select 1 from bookings b where b.slot_id = s.id and b.cancelled_at is null)
   order by s.starts_at
$$;

create or replace function public.confirm_walkin(p_request uuid, p_slot uuid, p_token text, p_actor jsonb)
returns walkin_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       walkin_requests;
  sl      slots;
  v_app   applications;
  v_rank  integer;
  b       bookings;
  v_name  text := coalesce(p_actor ->> 'name', 'staff');
begin
  perform app.set_actor(p_actor);

  select * into r from walkin_requests where id = p_request for update;
  if r.id is null then
    perform app.refuse('not_found', 'No such walk-in request.');
  end if;
  if r.status <> 'pending' then
    perform app.refuse('walkin_not_pending', 'This request was already handled.');
  end if;
  perform app.live_edition(r.edition_id);

  select * into sl from slots where id = p_slot and edition_id = r.edition_id;
  if sl.id is null then
    perform app.refuse('not_found', 'That slot does not exist.');
  end if;
  if sl.company_id <> r.company_id then
    perform app.refuse('other_company', 'That time belongs to another company.');
  end if;
  if sl.is_closed then
    perform app.refuse('slot_closed', 'That slot is not available.');
  end if;
  if sl.ends_at <= now() then
    perform app.refuse('slot_past', 'That time has already passed.');
  end if;
  if (select se.day from sessions se where se.id = sl.session_id) <> app.edition_today(r.edition_id) then
    perform app.refuse('not_today', 'A walk-in is given a time today.');
  end if;

  -- The student: their own application (same email), else a phone-only one
  -- from HR's list (0013), else a new one. Nothing on file is overwritten;
  -- only blanks are filled.
  select * into v_app from applications
   where edition_id = r.edition_id and email = r.email
   for update;
  if v_app.id is null and r.phone is not null then
    select * into v_app from applications a
     where a.edition_id = r.edition_id and a.email is null and a.phone is not null
       and app.normalise_phone(a.phone) = app.normalise_phone(r.phone)
     order by a.submitted_at desc
     limit 1
     for update;
  end if;

  if v_app.id is null then
    insert into applications
      (edition_id, email, phone, name, is_club_member, university, university_other,
       level, college, major, gpa, english_level, why_first, locale, cv_path, personal_token)
    values
      (r.edition_id, r.email, r.phone, r.name, r.is_club_member, r.university, r.university_other,
       r.level, r.college, r.major, r.gpa, r.english_level, r.why_first, r.locale, r.cv_path, p_token)
    returning * into v_app;
  else
    update applications a
       set email            = coalesce(a.email, r.email),
           name             = case when btrim(a.name) = '' then r.name else a.name end,
           phone            = coalesce(a.phone, r.phone),
           is_club_member   = coalesce(a.is_club_member, r.is_club_member),
           university       = coalesce(a.university, r.university),
           university_other = coalesce(a.university_other, r.university_other),
           level            = coalesce(a.level, r.level),
           college          = coalesce(a.college, r.college),
           major            = coalesce(a.major, r.major),
           gpa              = coalesce(a.gpa, r.gpa),
           english_level    = coalesce(a.english_level, r.english_level),
           why_first        = coalesce(a.why_first, r.why_first),
           cv_path          = coalesce(a.cv_path, r.cv_path)
     where a.id = v_app.id
     returning * into v_app;
  end if;

  -- Accepted for this company: the student's own preference if they chose
  -- it online (whatever HR decided then), else a new one after theirs.
  select coalesce(max(rank), 0) + 1 into v_rank
    from application_preferences where application_id = v_app.id;
  insert into application_preferences
    (edition_id, application_id, company_id, rank, decision, decided_at, decision_note)
  values
    (r.edition_id, v_app.id, r.company_id, v_rank, 'accepted', now(), 'Walk-in')
  on conflict (application_id, company_id) do update
    set decision      = 'accepted',
        decided_at    = case when application_preferences.decision = 'accepted'
                             then application_preferences.decided_at else now() end,
        decision_note = case when application_preferences.decision = 'accepted'
                             then application_preferences.decision_note else 'Walk-in' end;

  -- The booking, with the constraint violations turned into sentences, and
  -- checked in: they are standing at the desk.
  b := app.do_book(v_app, sl.id, 'staff');
  update bookings
     set stage            = 'arrived',
         arrived_at       = now(),
         stage_changed_at = now(),
         stage_changed_by = v_name
   where id = b.id
   returning * into b;

  update walkin_requests
     set status         = 'confirmed',
         application_id = v_app.id,
         booking_id     = b.id,
         decided_at     = now(),
         decided_by     = v_name,
         decision_note  = null
   where id = r.id
   returning * into r;

  return r;
end;
$$;

-- Grants (0016): unchanged by create or replace; repeated so this file can
-- be applied on its own.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.walkin_slots(uuid) to service_role;
    grant execute on function public.confirm_walkin(uuid, uuid, text, jsonb) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
