-- =============================================================================
-- 0003 — Interviewer feedback, reminders, and the export record.
--
-- Feedback is written by the company (through its link) against one booking.
-- It reaches the student by EMAIL ONLY, and only once a manager releases it
-- (or at once, if the edition's feedback_email_mode says so). Until then it
-- can be edited; after that it is frozen, because what was sent is what was
-- sent.
-- =============================================================================

create table feedback (
  id              uuid primary key default gen_random_uuid(),
  edition_id      uuid not null references editions (id) on delete cascade,
  booking_id      uuid not null unique references bookings (id) on delete cascade,
  company_id      uuid not null references companies (id) on delete cascade,
  application_id  uuid not null references applications (id) on delete cascade,
  -- {communication: 4, technical: 3, …} keyed by the edition's rating_labels.
  ratings         jsonb not null default '{}'::jsonb,
  strengths       text,
  improvements    text,
  overall         text,
  submitted_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  released_at     timestamptz,
  email_sent_at   timestamptz
);

create index feedback_edition_idx on feedback (edition_id, submitted_at desc);

create trigger feedback_touch before update on feedback
  for each row execute function app.touch_updated_at();
create trigger feedback_audit after insert or update or delete on feedback
  for each row execute function app.audit_row();

create or replace function app.company_by_token(p_token text)
returns companies
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c companies;
begin
  select * into c from companies where access_token = p_token;
  if c.id is null then
    perform app.refuse('bad_link', 'This link is not recognised.');
  end if;
  return c;
end;
$$;

create or replace function app.release_one(p_feedback uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f feedback;
begin
  update feedback set released_at = now()
   where id = p_feedback and released_at is null
   returning * into f;
  if f.id is null then
    return;
  end if;
  perform app.enqueue_email(
    f.edition_id, f.application_id, 'feedback',
    jsonb_build_object('feedback_id', f.id, 'booking_id', f.booking_id, 'company_id', f.company_id),
    'feedback:' || f.id::text);
end;
$$;

-- p_payload: ratings (object), strengths, improvements, overall.
create or replace function public.submit_feedback(p_company_token text, p_booking uuid, p_payload jsonb)
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
begin
  c := app.company_by_token(p_company_token);
  perform app.live_edition(c.edition_id);
  perform app.set_actor(jsonb_build_object('kind', 'company', 'id', c.id, 'name', c.name_en));

  select * into b from bookings where id = p_booking and company_id = c.id and cancelled_at is null;
  if b.id is null then
    perform app.refuse('not_found', 'That booking is not on your list.');
  end if;

  select * into f from feedback where booking_id = b.id;
  if f.id is not null and f.released_at is not null then
    perform app.refuse('feedback_sent', 'This feedback has already been sent to the student.');
  end if;

  insert into feedback (edition_id, booking_id, company_id, application_id, ratings, strengths, improvements, overall)
  values (b.edition_id, b.id, c.id, b.application_id,
          coalesce(p_payload -> 'ratings', '{}'::jsonb),
          nullif(p_payload ->> 'strengths', ''),
          nullif(p_payload ->> 'improvements', ''),
          nullif(p_payload ->> 'overall', ''))
  on conflict (booking_id) do update
    set ratings      = excluded.ratings,
        strengths    = excluded.strengths,
        improvements = excluded.improvements,
        overall      = excluded.overall
  returning * into f;

  v_mode := app.edition_settings(c.edition_id) ->> 'feedback_email_mode';
  if v_mode = 'immediately' then
    perform app.release_one(f.id);
    select * into f from feedback where id = f.id;
  end if;

  return f;
end;
$$;

-- A manager sending everything that is still held. Returns how many.
create or replace function public.release_feedback(p_edition uuid, p_actor jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec  record;
  v_n  integer := 0;
begin
  perform app.set_actor(p_actor);
  perform app.live_edition(p_edition);

  for rec in select id from feedback where edition_id = p_edition and released_at is null loop
    perform app.release_one(rec.id);
    v_n := v_n + 1;
  end loop;

  perform app.note(p_edition, 'feedback_released', 'feedback', null, jsonb_build_object('count', v_n));
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reminders — the one email no action triggers
--
-- Called by the scheduled sweep. Every scheduled booking starting within the
-- next p_hours gets one reminder, keyed so a second sweep writes nothing. A
-- booking made in the last two hours is skipped: its confirmation just went
-- out, and a second email saying the same thing is noise.
-- -----------------------------------------------------------------------------

create or replace function public.enqueue_reminders(p_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec  record;
  v_n  integer := 0;
begin
  for rec in
    select b.id, b.edition_id, b.application_id
    from bookings b
    join editions e on e.id = b.edition_id
    where b.cancelled_at is null
      and b.stage = 'scheduled'
      and e.status = 'active'
      and b.starts_at > now()
      and b.starts_at <= now() + make_interval(hours => greatest(p_hours, 1))
      and b.booked_at < now() - interval '2 hours'
  loop
    if app.enqueue_email(
         rec.edition_id, rec.application_id, 'reminder',
         app.booking_payload(rec.id),
         'reminder:' || rec.id::text) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Exports — the club's own copy, taken nightly and on demand
-- -----------------------------------------------------------------------------

create table exports (
  id           uuid primary key default gen_random_uuid(),
  edition_id   uuid not null references editions (id) on delete cascade,
  taken_on     date not null,
  object_path  text not null,
  counts       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (edition_id, taken_on)
);

-- Everything about one edition as one JSON document. CV files are not in it
-- (they are in the bucket); their paths are.
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
    'audit_log',    (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb) from audit_log l where l.edition_id = p_edition)
  )
$$;

create or replace function public.record_export(
  p_edition uuid, p_taken_on date, p_path text, p_counts jsonb, p_actor jsonb
)
returns exports
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v exports;
begin
  perform app.set_actor(p_actor);
  insert into exports (edition_id, taken_on, object_path, counts)
  values (p_edition, p_taken_on, p_path, coalesce(p_counts, '{}'::jsonb))
  on conflict (edition_id, taken_on) do update
    set object_path = excluded.object_path, counts = excluded.counts, created_at = now()
  returning * into v;
  perform app.note(p_edition, 'export_taken', 'exports', v.id::text, p_counts);
  return v;
end;
$$;

alter table feedback enable row level security;
alter table exports  enable row level security;
