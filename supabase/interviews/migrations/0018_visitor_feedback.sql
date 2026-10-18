-- =============================================================================
-- 0018 — Visitor feedback: how the students who came rate the event.
--
-- A public link, like the apply form (/interviews/visit/<public slug>), open
-- only while the club switches it on in Settings (`visitor_feedback_open`
-- in the edition's settings). The student types their phone number and
-- answers four questions on a four-step scale plus an optional comment.
--
--   submit_visitor_feedback(edition, phone, answers, comment)
--     The phone must belong to a student who CHECKED IN at this edition: a
--     booking, not cancelled, that reached arrived, in interview or done.
--     Whether they were interviewed does not matter. One answer per student:
--     sending again replaces their earlier answer (the audit log keeps it).
--
--     answers: { event_quality, club_goals, activities, team }, each
--     4 = Excellent, 3 = Good, 2 = Acceptable, 1 = Not good. All four are
--     required; the comment is optional.
--
--     Refused (with a hint the page translates):
--       visitor_feedback_closed  the link is switched off
--       not_checked_in           no checked-in student has that number
--       bad_answers              a question missing or out of range
--       archived / not_found     as everywhere (app.live_edition)
--
-- Also: edition_snapshot (0016) now carries visitor_feedback.
--
-- Apply after 0017. Can be run twice. Nothing is deleted.
-- =============================================================================

create table if not exists visitor_feedback (
  id              uuid primary key default gen_random_uuid(),
  edition_id      uuid not null references editions (id) on delete cascade,
  application_id  uuid not null references applications (id) on delete cascade,
  -- The number as typed, normalised (app.normalise_phone).
  phone           text not null,
  answers         jsonb not null,
  comment         text,
  locale          text not null default 'ar' check (locale in ('ar', 'en')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint visitor_feedback_one_per_student unique (edition_id, application_id)
);

create index if not exists visitor_feedback_edition_idx on visitor_feedback (edition_id, created_at desc);

alter table visitor_feedback enable row level security;

drop trigger if exists visitor_feedback_touch on visitor_feedback;
create trigger visitor_feedback_touch before update on visitor_feedback
  for each row execute function app.touch_updated_at();
drop trigger if exists visitor_feedback_audit on visitor_feedback;
create trigger visitor_feedback_audit after insert or update or delete on visitor_feedback
  for each row execute function app.audit_row();

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
  v_phone  text := app.normalise_phone(p_phone);
  v_app    applications;
  v_key    text;
  v_value  jsonb;
  v_had    boolean;
begin
  e := app.live_edition(p_edition);
  if coalesce(app.edition_settings(e.id) ->> 'visitor_feedback_open', 'false') <> 'true' then
    perform app.refuse('visitor_feedback_closed', 'Visitor feedback is closed right now.');
  end if;

  -- Exactly the four questions, each 1–4.
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

  -- A student with that number who checked in (the newest such application).
  select a.* into v_app
    from applications a
   where a.edition_id = e.id
     and v_phone is not null and length(v_phone) >= 9
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
  values (e.id, v_app.id, v_phone,
          jsonb_build_object(
            'event_quality', (p_answers ->> 'event_quality')::int,
            'club_goals',    (p_answers ->> 'club_goals')::int,
            'activities',    (p_answers ->> 'activities')::int,
            'team',          (p_answers ->> 'team')::int),
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

-- 0016's snapshot, with visitor_feedback added.
create or replace function public.edition_snapshot(p_edition uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'taken_at',     now(),
    'edition',      (select to_jsonb(e) from editions e where e.id = p_edition),
    'rooms',        (select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.name), '[]'::jsonb) from rooms r where r.edition_id = p_edition),
    'companies',    (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order, c.name_en), '[]'::jsonb) from companies c where c.edition_id = p_edition),
    'applications', (select coalesce(jsonb_agg(to_jsonb(a) order by a.submitted_at), '[]'::jsonb) from applications a where a.edition_id = p_edition),
    'preferences',  (select coalesce(jsonb_agg(to_jsonb(p) order by p.application_id, p.rank), '[]'::jsonb) from application_preferences p where p.edition_id = p_edition),
    'sessions',     (select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at), '[]'::jsonb) from sessions s where s.edition_id = p_edition),
    'slots',        (select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at), '[]'::jsonb) from slots s where s.edition_id = p_edition),
    'bookings',     (select coalesce(jsonb_agg(to_jsonb(b) order by b.starts_at), '[]'::jsonb) from bookings b where b.edition_id = p_edition),
    'feedback',     (select coalesce(jsonb_agg(to_jsonb(f) order by f.submitted_at), '[]'::jsonb) from feedback f where f.edition_id = p_edition),
    'emails',       (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) from email_outbox m where m.edition_id = p_edition),
    'audit_log',    (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb) from audit_log l where l.edition_id = p_edition),
    'session_acceptances', (select coalesce(jsonb_agg(to_jsonb(x) order by x.accepted_at), '[]'::jsonb) from session_acceptances x where x.edition_id = p_edition),
    'walkin_requests',     (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at), '[]'::jsonb) from walkin_requests w where w.edition_id = p_edition),
    'visitor_feedback',    (select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at), '[]'::jsonb) from visitor_feedback v where v.edition_id = p_edition)
  )
$$;

-- Grants (0004): the service role only.
revoke all on function public.submit_visitor_feedback(uuid, text, jsonb, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table visitor_feedback from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table visitor_feedback to service_role;
    grant execute on function public.submit_visitor_feedback(uuid, text, jsonb, text, text) to service_role;
    grant execute on function public.edition_snapshot(uuid) to service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
