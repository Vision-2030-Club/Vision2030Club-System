-- =============================================================================
-- 0019 — Visitor feedback without a phone number.
--
-- The club decided (2026-10-19) that the visitor feedback form asks no phone
-- number: anyone with the link answers, anonymously. 0018 required the phone
-- of a student who checked in; now a blank phone is accepted and saved with
-- no student attached. A phone that IS given still works as in 0018 (one
-- answer per checked-in student), so a page still showing the old form keeps
-- working until it is reloaded.
--
-- The four answers stay required and checked; the link still has to be open.
-- Anonymous answers are not limited per person by the database; the page
-- remembers on the device that it already answered.
--
-- Apply after 0018. Can be run twice. Nothing is deleted.
-- =============================================================================

alter table visitor_feedback alter column application_id drop not null;
alter table visitor_feedback alter column phone drop not null;

create or replace function public.submit_visitor_feedback(
  p_edition  uuid,
  p_phone    text,
  p_answers  jsonb,
  p_comment  text,
  p_locale   text default 'ar'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e        editions;
  v_phone  text := app.normalise_phone(nullif(btrim(coalesce(p_phone, '')), ''));
  v_app    applications;
  v_key    text;
  v_value  jsonb;
  v_had    boolean;
  v_answers jsonb;
begin
  e := app.live_edition(p_edition);
  if coalesce(app.edition_settings(e.id) ->> 'visitor_feedback_open', 'false') <> 'true' then
    perform app.refuse('visitor_feedback_closed', 'Visitor feedback is closed right now.');
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    perform app.refuse('bad_answers', 'Answer every question.');
  end if;
  foreach v_key in array array['event_quality', 'club_goals', 'activities', 'team'] loop
    v_value := p_answers -> v_key;
    if v_value is null or jsonb_typeof(v_value) <> 'number'
       or (v_value)::text::numeric not in (1, 2, 3, 4) then
      perform app.refuse('bad_answers', 'Answer every question.');
    end if;
  end loop;
  v_answers := jsonb_build_object(
    'event_quality', (p_answers ->> 'event_quality')::int,
    'club_goals',    (p_answers ->> 'club_goals')::int,
    'activities',    (p_answers ->> 'activities')::int,
    'team',          (p_answers ->> 'team')::int);

  -- 0019: no phone, an anonymous answer.
  if v_phone is null then
    perform app.set_actor(jsonb_build_object('kind', 'visitor', 'name', 'Anonymous visitor'));
    insert into visitor_feedback (edition_id, application_id, phone, answers, comment, locale)
    values (e.id, null, null, v_answers,
            nullif(btrim(coalesce(p_comment, '')), ''),
            case when p_locale = 'en' then 'en' else 'ar' end);
    return jsonb_build_object('replaced', false);
  end if;

  -- A phone given: as 0018, a student who checked in, one answer each.
  select a.* into v_app
    from applications a
   where a.edition_id = e.id
     and length(v_phone) >= 9
     and app.normalise_phone(a.phone) = v_phone
     and exists (select 1 from bookings b
                  where b.application_id = a.id
                    and b.cancelled_at is null
                    and b.stage in ('arrived', 'in_interview', 'done'))
   order by a.submitted_at desc
   limit 1;
  if v_app.id is null then
    perform app.refuse('not_checked_in', 'No one who checked in at the event has that phone number.');
  end if;

  perform app.set_actor(jsonb_build_object('kind', 'student', 'id', v_app.id, 'name', v_app.name));
  select exists (select 1 from visitor_feedback where edition_id = e.id and application_id = v_app.id) into v_had;

  insert into visitor_feedback (edition_id, application_id, phone, answers, comment, locale)
  values (e.id, v_app.id, v_phone, v_answers,
          nullif(btrim(coalesce(p_comment, '')), ''),
          case when p_locale = 'en' then 'en' else 'ar' end)
  on conflict (edition_id, application_id) do update
    set phone   = excluded.phone,
        answers = excluded.answers,
        comment = excluded.comment,
        locale  = excluded.locale;

  return jsonb_build_object('replaced', v_had);
end;
$$;

revoke all on function public.submit_visitor_feedback(uuid, text, jsonb, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.submit_visitor_feedback(uuid, text, jsonb, text, text) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
