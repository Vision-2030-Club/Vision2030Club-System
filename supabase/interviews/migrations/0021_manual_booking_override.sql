-- =============================================================================
-- 0021 — Manual booking overrides: a second interview with the same company.
--
-- The club's decision (2026-10-20): booking by hand at Reception overrides
-- whatever the student already holds with that company. A scheduled booking
-- is moved, a no-show or a checked-in one is cancelled and booked again (the
-- app does both with the functions it already has), and a FINISHED interview
-- is kept, with its feedback, next to the new booking. That last case needs
-- the database to allow it:
--
--   bookings_one_per_company  was: one live booking per student per company.
--                             now: one live booking that is not done, so a
--                             done interview no longer blocks a new one.
--   app.do_book               a student booking for themselves (personal or
--                             candidate link) is still refused when they
--                             already had their interview with that company
--                             (already_interviewed); staff are not.
--
-- Everything else in do_book is 0002's, unchanged. Apply after 0020. Can be
-- run twice. Nothing is deleted.
-- =============================================================================

drop index if exists bookings_one_per_company;
create unique index bookings_one_per_company
  on bookings (application_id, company_id) where cancelled_at is null and stage <> 'done';

create or replace function app.do_book(
  p_app   applications,
  p_slot  uuid,
  p_kind  text
)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sl            slots;
  b             bookings;
  v_constraint  text;
begin
  select * into sl from slots where id = p_slot;
  if sl.id is null or sl.edition_id <> p_app.edition_id then
    perform app.refuse('not_found', 'That slot does not exist.');
  end if;
  if sl.is_closed then
    perform app.refuse('slot_closed', 'That slot is not available.');
  end if;
  if not exists (select 1 from application_preferences ap
                  where ap.application_id = p_app.id
                    and ap.company_id = sl.company_id
                    and ap.decision = 'accepted') then
    perform app.refuse('not_accepted', 'You were not accepted for this company.');
  end if;
  -- 0021: a student booking for themselves still gets one interview per
  -- company; only staff may book a second one after a finished interview.
  if p_kind <> 'staff' and exists (
       select 1 from bookings b0
        where b0.application_id = p_app.id and b0.company_id = sl.company_id
          and b0.cancelled_at is null and b0.stage = 'done') then
    perform app.refuse('already_interviewed', 'You already had your interview with this company.');
  end if;

  begin
    insert into bookings
      (edition_id, slot_id, application_id, company_id, starts_at, ends_at, booked_by_kind)
    values
      (sl.edition_id, sl.id, p_app.id, sl.company_id, sl.starts_at, sl.ends_at, p_kind)
    returning * into b;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'bookings_one_per_slot' then
        perform app.refuse('slot_taken', 'Someone took that slot first. Pick another one.');
      end if;
      perform app.refuse('already_booked', 'You already hold a slot with this company. Move it instead.');
    when exclusion_violation then
      perform app.refuse('overlap', 'That time overlaps another of your interviews.');
  end;

  perform app.enqueue_email(
    b.edition_id, b.application_id, 'booking_confirmed',
    app.booking_payload(b.id),
    'booked:' || b.id::text);

  return b;
end;
$$;

notify pgrst, 'reload schema';
