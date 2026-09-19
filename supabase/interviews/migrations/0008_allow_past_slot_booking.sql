-- =============================================================================
-- 0008 — Booking a past-dated slot is allowed.
--
-- book_slot and move_booking both refused a slot once its start time had
-- passed. That is right for a real event, but this project's rooms are
-- created and tested well before the actual interview days, often against
-- today's date as a placeholder — and under that refusal, a room's early
-- slots quietly became unbookable as the same testing day went on. Dropping
-- the check trades away "can't book the literal past" for "testing isn't
-- fighting the clock"; everything else booking already enforces (one slot
-- per person, no double-booking, the edition's booking window) is untouched.
-- =============================================================================

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

  return app.do_move(b, p_slot, 'student');
end;
$$;
