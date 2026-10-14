-- =============================================================================
-- 0015 — The company finishes an interview by giving its feedback.
--
-- On the interviewer's page (/interviews/c/<token>) the company presses
-- "Interview done", fills in the feedback form, and saving it marks the
-- interview done. The club decided (2026-10-14) that this is the only stage
-- a company moves, and that it moves it only together with its feedback.
--
--   finish_interview(token, booking, payload)
--     One transaction: the feedback is saved exactly as submit_feedback
--     (0003) saves it, and the booking becomes `done` if it is not already.
--     A done interview can be finished again, which only edits the
--     feedback (until it is released to the student, as before).
--
--     Refused (with a hint the page translates):
--       not_found        the booking is not this company's, or was cancelled
--       marked_no_show   the organizer marked the student as not shown;
--                        they change that first
--       empty_feedback   no rating and no text: "done" must carry feedback
--       feedback_sent    the feedback was already released to the student
--
--     From scheduled or arrived as well as in_interview: a company must not
--     be stuck because nobody pressed "In interview" for that student. The
--     row is locked (`for update`) so a floor click at the same moment waits
--     for it rather than racing it.
--
-- Organizers keep their own "Finished" button (advance_stage, 0002/0011);
-- the floor marks a finished interview that has no feedback yet.
--
-- Nothing is deleted. Can be run twice.
-- =============================================================================

create or replace function public.finish_interview(
  p_company_token  text,
  p_booking        uuid,
  p_payload        jsonb
)
returns feedback
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c        companies;
  b        bookings;
  f        feedback;
  v_mode   text;
  v_ratings jsonb := coalesce(p_payload -> 'ratings', '{}'::jsonb);
begin
  c := app.company_by_token(p_company_token);
  perform app.live_edition(c.edition_id);
  perform app.set_actor(jsonb_build_object('kind', 'company', 'id', c.id, 'name', c.name_en));

  select * into b
    from bookings
   where id = p_booking and company_id = c.id and cancelled_at is null
   for update;
  if b.id is null then
    perform app.refuse('not_found', 'That booking is not on your list.');
  end if;
  if b.stage = 'no_show' then
    perform app.refuse('marked_no_show',
      'This student is marked as not shown. Ask the room''s organizer to change that first.');
  end if;

  if jsonb_typeof(v_ratings) <> 'object' then
    v_ratings := '{}'::jsonb;
  end if;
  if v_ratings = '{}'::jsonb
     and coalesce(btrim(p_payload ->> 'strengths'), '') = ''
     and coalesce(btrim(p_payload ->> 'improvements'), '') = ''
     and coalesce(btrim(p_payload ->> 'overall'), '') = '' then
    perform app.refuse('empty_feedback', 'Give at least one rating or a comment.');
  end if;

  select * into f from feedback where booking_id = b.id;
  if f.id is not null and f.released_at is not null then
    perform app.refuse('feedback_sent', 'This feedback has already been sent to the student.');
  end if;

  insert into feedback (edition_id, booking_id, company_id, application_id, ratings, strengths, improvements, overall)
  values (b.edition_id, b.id, c.id, b.application_id,
          v_ratings,
          nullif(p_payload ->> 'strengths', ''),
          nullif(p_payload ->> 'improvements', ''),
          nullif(p_payload ->> 'overall', ''))
  on conflict (booking_id) do update
    set ratings      = excluded.ratings,
        strengths    = excluded.strengths,
        improvements = excluded.improvements,
        overall      = excluded.overall
  returning * into f;

  if b.stage <> 'done' then
    update bookings
       set stage            = 'done',
           stage_changed_at = now(),
           stage_changed_by = c.name_en,
           arrived_at       = coalesce(arrived_at, now()),
           finished_at      = now()
     where id = b.id;
  end if;

  v_mode := app.edition_settings(c.edition_id) ->> 'feedback_email_mode';
  if v_mode = 'immediately' then
    perform app.release_one(f.id);
    select * into f from feedback where id = f.id;
  end if;

  return f;
end;
$$;

-- Same grants as every function here (0004): the service role only.
revoke all on function public.finish_interview(text, uuid, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.finish_interview(text, uuid, jsonb) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
