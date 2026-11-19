-- =============================================================================
-- Quroosh database — 0008: the booths' challenges, the second part of the
-- Quroosh market.
--
-- A booth at the event has a challenge: a few multiple-choice questions. A
-- guest (an account of 0006) scans the booth's QR code, answers once, and is
-- paid quroosh into their wallet (0007) for being right and for being quick.
--
--   challenges            one per booth, for one day or for every day
--   challenge_questions   its questions: a prompt, two to four options, the
--                         right one
--   challenge_attempts    one per account per challenge, ever
--   challenge_answers     what an attempt answered, and how fast
--
-- The clock is this database's, never the guest's phone. An attempt knows
-- which question it is on and when that question was shown (`shown_at`);
-- the time an answer took is `now() - shown_at`, cut at the challenge's
-- seconds per question. An answer that arrives after the time is up counts
-- as no answer. The right option never leaves this database until the
-- attempt is finished.
--
-- Points (the design left the formula open; managers set the two numbers):
--   each question is worth  max_points / the questions answered
--   a right answer earns    half of that for being right, and the other
--                           half scaled by the time left
-- so the whole challenge pays at most `max_points`, and a right answer in
-- the last second still pays half. Finishing writes one 'challenge' entry to
-- the ledger, in the same transaction, with the attempt as its source.
--
-- Nothing is deleted: a question is hidden, a challenge is switched off.
-- As everywhere in this database: Row Level Security on and NO policies,
-- every function executable by service_role only, and this database never
-- checks identity. Safe to re-run.
-- =============================================================================

create table if not exists challenges (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null,           -- the club database's projects.id
  -- What the booth's QR code holds. Made by the app.
  token                 text not null unique
                          constraint challenges_token_shape check (token ~ '^[0-9a-f]{48}$'),
  booth                 text not null
                          constraint challenges_booth_shape check (char_length(btrim(booth)) between 1 and 120),
  topic                 text
                          constraint challenges_topic_shape check (topic is null or char_length(topic) <= 200),
  -- The one day it can be played, on the club's calendar. Empty: any day.
  day                   date,
  seconds_per_question  integer not null default 20
                          constraint challenges_seconds_range check (seconds_per_question between 5 and 120),
  max_points            integer not null default 3000
                          constraint challenges_points_range check (max_points between 0 and 1000000),
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

create index if not exists challenges_project_idx on challenges (project_id, created_at);

create table if not exists challenge_questions (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references challenges (id),
  position      integer not null,
  prompt        text not null
                  constraint challenge_questions_prompt_shape check (char_length(btrim(prompt)) between 1 and 500),
  -- A JSON array of two to four strings.
  options       jsonb not null
                  constraint challenge_questions_options_shape
                  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  -- Which option is right, counted from 0.
  correct       smallint not null,
  created_at    timestamptz not null default now(),
  hidden_at     timestamptz,
  constraint challenge_questions_correct_range check (correct >= 0 and correct < jsonb_array_length(options))
);

create index if not exists challenge_questions_challenge_idx on challenge_questions (challenge_id, position);

create table if not exists challenge_attempts (
  id             uuid primary key default gen_random_uuid(),
  challenge_id   uuid not null references challenges (id),
  account_id     uuid not null references accounts (id),
  project_id     uuid not null,
  started_at     timestamptz not null default now(),
  -- The question it is on, and when that was shown. Empty once finished.
  question_id    uuid references challenge_questions (id),
  shown_at       timestamptz,
  finished_at    timestamptz,
  correct_count  integer,
  total_ms       integer,
  points         integer,
  constraint challenge_attempts_once unique (challenge_id, account_id)
);

create index if not exists challenge_attempts_account_idx on challenge_attempts (account_id);

create table if not exists challenge_answers (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references challenge_attempts (id),
  question_id  uuid not null references challenge_questions (id),
  -- Empty: the time ran out.
  choice       smallint,
  correct      boolean not null,
  ms           integer not null,
  answered_at  timestamptz not null default now(),
  constraint challenge_answers_once unique (attempt_id, question_id)
);

alter table challenges           enable row level security;
alter table challenge_questions  enable row level security;
alter table challenge_attempts   enable row level security;
alter table challenge_answers    enable row level security;

-- The event's day on the club's clock.
create or replace function app.quroosh_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;

-- -----------------------------------------------------------------------------
-- The guest
-- -----------------------------------------------------------------------------

-- The challenge behind a booth's QR code. No row: unknown code.
create or replace function public.challenge_by_token(p_token text)
returns table (
  id                    uuid,
  project_id            uuid,
  booth                 text,
  topic                 text,
  seconds_per_question  integer,
  max_points            integer,
  questions             bigint,
  playable              boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.project_id, c.booth, c.topic, c.seconds_per_question, c.max_points,
         (select count(*) from challenge_questions q where q.challenge_id = c.id and q.hidden_at is null),
         c.active and (c.day is null or c.day = app.quroosh_today())
    from challenges c
   where c.token = p_token;
$$;

-- Moves an attempt to its next question, or finishes it and pays. The caller
-- holds the attempt's row lock.
create or replace function app.challenge_advance(p_attempt uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt   challenge_attempts;
  v_challenge challenges;
  v_next      uuid;
  v_answered  integer;
  v_correct   integer;
  v_ms        integer;
  v_points    integer;
begin
  select * into v_attempt from challenge_attempts a where a.id = p_attempt;
  select * into v_challenge from challenges c where c.id = v_attempt.challenge_id;

  select q.id into v_next
    from challenge_questions q
   where q.challenge_id = v_attempt.challenge_id
     and q.hidden_at is null
     and not exists (select 1 from challenge_answers w where w.attempt_id = p_attempt and w.question_id = q.id)
   order by q.position, q.created_at
   limit 1;

  if v_next is not null then
    update challenge_attempts set question_id = v_next, shown_at = now() where id = p_attempt;
    return;
  end if;

  select count(*), count(*) filter (where w.correct), coalesce(sum(w.ms), 0)
    into v_answered, v_correct, v_ms
    from challenge_answers w where w.attempt_id = p_attempt;

  -- Each question is worth an equal share; a right answer earns half its
  -- share for being right and half scaled by the time left.
  select coalesce(round(sum(
           (v_challenge.max_points::numeric / v_answered)
           * (0.5 + 0.5 * (1 - least(w.ms, v_challenge.seconds_per_question * 1000)::numeric
                                 / (v_challenge.seconds_per_question * 1000)))
         ) filter (where w.correct)), 0)::integer
    into v_points
    from challenge_answers w where w.attempt_id = p_attempt;
  v_points := least(greatest(coalesce(v_points, 0), 0), v_challenge.max_points);

  update challenge_attempts
     set question_id = null, shown_at = null, finished_at = now(),
         correct_count = v_correct, total_ms = v_ms, points = v_points
   where id = p_attempt;

  if v_points > 0 then
    insert into wallet_entries (project_id, account_id, kind, amount, day, source_ref)
    values (v_attempt.project_id, v_attempt.account_id, 'challenge', v_points, app.quroosh_today(), p_attempt::text)
    on conflict do nothing;
  end if;
end;
$$;

-- Starts the guest's one attempt. Starting again changes nothing: the
-- attempt carries on where it was, with its clock still running.
create or replace function public.challenge_start(p_account uuid, p_challenge uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge challenges;
  v_attempt   uuid;
begin
  select * into v_challenge from challenges c where c.id = p_challenge;
  if not found then
    perform app.refuse('not_found', 'This challenge does not exist.');
  end if;
  if not exists (select 1 from accounts a
                  where a.id = p_account and a.project_id = v_challenge.project_id
                    and a.disabled_at is null and a.completed_at is not null) then
    perform app.refuse('forbidden', 'This account cannot play this challenge.');
  end if;

  select a.id into v_attempt from challenge_attempts a
   where a.challenge_id = p_challenge and a.account_id = p_account;
  if v_attempt is not null then
    return v_attempt;
  end if;

  if not v_challenge.active or (v_challenge.day is not null and v_challenge.day <> app.quroosh_today()) then
    perform app.refuse('challenge_closed', 'This challenge is not open today.');
  end if;
  if not exists (select 1 from challenge_questions q where q.challenge_id = p_challenge and q.hidden_at is null) then
    perform app.refuse('challenge_empty', 'This challenge has no questions yet.');
  end if;

  insert into challenge_attempts (challenge_id, account_id, project_id)
  values (p_challenge, p_account, v_challenge.project_id)
  on conflict on constraint challenge_attempts_once do nothing
  returning id into v_attempt;
  if v_attempt is null then
    -- Two presses at once: the other one made it.
    select a.id into v_attempt from challenge_attempts a
     where a.challenge_id = p_challenge and a.account_id = p_account;
    return v_attempt;
  end if;
  perform app.challenge_advance(v_attempt);
  return v_attempt;
end;
$$;

-- Answers the question the attempt is on. p_choice null: the time ran out.
-- An answer that arrives more than a second and a half after the time is up
-- counts as none. An answer to a question the attempt is no longer on (a
-- second press, an old tab) changes nothing.
create or replace function public.challenge_answer(p_account uuid, p_challenge uuid, p_question uuid, p_choice integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt   challenge_attempts;
  v_challenge challenges;
  v_question  challenge_questions;
  v_limit     integer;
  v_ms        integer;
  v_choice    integer := p_choice;
begin
  select * into v_attempt from challenge_attempts a
   where a.challenge_id = p_challenge and a.account_id = p_account
   for update;
  if not found then
    perform app.refuse('not_found', 'This challenge has not been started.');
  end if;
  if v_attempt.finished_at is not null or v_attempt.question_id is distinct from p_question then
    return;
  end if;

  select * into v_challenge from challenges c where c.id = v_attempt.challenge_id;
  select * into v_question from challenge_questions q where q.id = p_question;
  v_limit := v_challenge.seconds_per_question * 1000;
  v_ms := greatest((extract(epoch from now() - v_attempt.shown_at) * 1000)::integer, 0);
  if v_ms > v_limit + 1500 then
    v_choice := null;
  end if;
  if v_choice is not null and (v_choice < 0 or v_choice >= jsonb_array_length(v_question.options)) then
    v_choice := null;
  end if;

  insert into challenge_answers (attempt_id, question_id, choice, correct, ms)
  values (v_attempt.id, p_question, v_choice, coalesce(v_choice = v_question.correct, false), least(v_ms, v_limit))
  on conflict on constraint challenge_answers_once do nothing;

  perform app.challenge_advance(v_attempt.id);
end;
$$;

-- Where a guest is with a challenge, as one JSON object:
--   { status: 'new' }
--   { status: 'open', number, total, remaining_ms, seconds,
--     question: { id, prompt, options } }          (never the right option)
--   { status: 'done', correct, total, ms, points, place, players }
-- `place` is among the finished attempts of this challenge, by points.
create or replace function public.challenge_state(p_account uuid, p_challenge uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt   challenge_attempts;
  v_challenge challenges;
  v_question  challenge_questions;
  v_answered  integer;
  v_total     integer;
begin
  select * into v_attempt from challenge_attempts a
   where a.challenge_id = p_challenge and a.account_id = p_account;
  if not found then
    return jsonb_build_object('status', 'new');
  end if;
  select * into v_challenge from challenges c where c.id = p_challenge;
  select count(*) into v_answered from challenge_answers w where w.attempt_id = v_attempt.id;

  if v_attempt.finished_at is not null then
    return jsonb_build_object(
      'status', 'done',
      'correct', v_attempt.correct_count,
      'total', v_answered,
      'ms', v_attempt.total_ms,
      'points', v_attempt.points,
      'place', (select count(*) + 1 from challenge_attempts o
                 where o.challenge_id = p_challenge and o.finished_at is not null and o.points > v_attempt.points),
      'players', (select count(*) from challenge_attempts o
                   where o.challenge_id = p_challenge and o.finished_at is not null));
  end if;

  select * into v_question from challenge_questions q where q.id = v_attempt.question_id;
  select v_answered + count(*) into v_total
    from challenge_questions q
   where q.challenge_id = p_challenge and q.hidden_at is null
     and not exists (select 1 from challenge_answers w where w.attempt_id = v_attempt.id and w.question_id = q.id);
  return jsonb_build_object(
    'status', 'open',
    'number', v_answered + 1,
    'total', v_total,
    'seconds', v_challenge.seconds_per_question,
    'remaining_ms', greatest(v_challenge.seconds_per_question * 1000
                             - (extract(epoch from now() - v_attempt.shown_at) * 1000)::integer, 0),
    'question', jsonb_build_object('id', v_question.id, 'prompt', v_question.prompt, 'options', v_question.options));
end;
$$;

-- The challenges a guest can see today, with what they did in each.
--   status  'new', 'open' or 'done'
create or replace function public.challenges_for_account(p_account uuid)
returns table (
  id          uuid,
  booth       text,
  topic       text,
  questions   bigint,
  max_points  integer,
  status      text,
  points      integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.booth, c.topic,
         (select count(*) from challenge_questions q where q.challenge_id = c.id and q.hidden_at is null),
         c.max_points,
         case when t.id is null then 'new' when t.finished_at is null then 'open' else 'done' end,
         t.points
    from accounts a
    join challenges c on c.project_id = a.project_id
    left join challenge_attempts t on t.challenge_id = c.id and t.account_id = a.id
   where a.id = p_account
     and ((c.active and (c.day is null or c.day = app.quroosh_today())) or t.id is not null)
   order by (t.finished_at is not null), c.booth, c.created_at;
$$;

-- -----------------------------------------------------------------------------
-- Managers
-- -----------------------------------------------------------------------------

create or replace function public.challenge_list(p_project uuid)
returns table (
  id                    uuid,
  token                 text,
  booth                 text,
  topic                 text,
  day                   date,
  seconds_per_question  integer,
  max_points            integer,
  active                boolean,
  questions             bigint,
  attempts              bigint,
  average_points        integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.token, c.booth, c.topic, c.day, c.seconds_per_question, c.max_points, c.active,
         (select count(*) from challenge_questions q where q.challenge_id = c.id and q.hidden_at is null),
         (select count(*) from challenge_attempts t where t.challenge_id = c.id and t.finished_at is not null),
         (select coalesce(round(avg(t.points)), 0)::integer from challenge_attempts t
           where t.challenge_id = c.id and t.finished_at is not null)
    from challenges c
   where c.project_id = p_project
   order by c.day nulls first, c.booth, c.created_at;
$$;

-- Makes a challenge (p_id null, with the token the app made) or changes one.
-- Returns its id.
create or replace function public.challenge_save(
  p_project uuid,
  p_id uuid,
  p_token text,
  p_booth text,
  p_topic text,
  p_day date,
  p_seconds integer,
  p_max_points integer,
  p_active boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into challenges (project_id, token, booth, topic, day, seconds_per_question, max_points, active)
    values (p_project, p_token, btrim(p_booth), nullif(btrim(coalesce(p_topic, '')), ''), p_day,
            coalesce(p_seconds, 20), coalesce(p_max_points, 3000), coalesce(p_active, true))
    returning id into v_id;
  else
    update challenges c
       set booth = btrim(p_booth),
           topic = nullif(btrim(coalesce(p_topic, '')), ''),
           day = p_day,
           seconds_per_question = coalesce(p_seconds, c.seconds_per_question),
           max_points = coalesce(p_max_points, c.max_points),
           active = coalesce(p_active, c.active)
     where c.id = p_id and c.project_id = p_project
    returning c.id into v_id;
    if v_id is null then
      perform app.refuse('not_found', 'This challenge does not exist.');
    end if;
  end if;
  return v_id;
exception
  when check_violation or not_null_violation or unique_violation then
    perform app.refuse('challenge_invalid', 'The challenge could not be saved: ' || sqlerrm);
    return null;
end;
$$;

-- A challenge's questions, hidden ones included, with the right option.
create or replace function public.challenge_questions_list(p_project uuid, p_challenge uuid)
returns table (id uuid, "position" integer, prompt text, options jsonb, correct smallint, hidden boolean, answered bigint, right_answers bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.id, q.position, q.prompt, q.options, q.correct, q.hidden_at is not null,
         (select count(*) from challenge_answers w where w.question_id = q.id),
         (select count(*) from challenge_answers w where w.question_id = q.id and w.correct)
    from challenge_questions q
    join challenges c on c.id = q.challenge_id
   where c.id = p_challenge and c.project_id = p_project
   order by q.position, q.created_at;
$$;

-- Adds a question at the end (p_id null) or rewrites one.
create or replace function public.challenge_question_save(
  p_project uuid,
  p_challenge uuid,
  p_id uuid,
  p_prompt text,
  p_options jsonb,
  p_correct integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from challenges c where c.id = p_challenge and c.project_id = p_project) then
    perform app.refuse('not_found', 'This challenge does not exist.');
  end if;
  if p_id is null then
    insert into challenge_questions (challenge_id, position, prompt, options, correct)
    values (p_challenge,
            (select coalesce(max(q.position), 0) + 1 from challenge_questions q where q.challenge_id = p_challenge),
            btrim(p_prompt), p_options, p_correct)
    returning id into v_id;
  else
    update challenge_questions q
       set prompt = btrim(p_prompt), options = p_options, correct = p_correct
     where q.id = p_id and q.challenge_id = p_challenge
    returning q.id into v_id;
    if v_id is null then
      perform app.refuse('not_found', 'This question does not exist.');
    end if;
  end if;
  return v_id;
exception
  when check_violation or not_null_violation or numeric_value_out_of_range then
    perform app.refuse('question_invalid', 'The question could not be saved: ' || sqlerrm);
    return null;
end;
$$;

-- Hides a question from new attempts, or shows it again. Answers already
-- given to it stay.
create or replace function public.challenge_question_hide(p_project uuid, p_question uuid, p_hidden boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update challenge_questions q
     set hidden_at = case when p_hidden then coalesce(q.hidden_at, now()) end
    from challenges c
   where q.id = p_question and c.id = q.challenge_id and c.project_id = p_project;
  if not found then
    perform app.refuse('not_found', 'This question does not exist.');
  end if;
end;
$$;

-- The best finished attempts of a challenge, with full names: managers only.
create or replace function public.challenge_top(p_project uuid, p_challenge uuid, p_limit integer default 10)
returns table (account_id uuid, name text, points integer, correct_count integer, total_ms integer, finished_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.account_id, a.name, t.points, t.correct_count, t.total_ms, t.finished_at
    from challenge_attempts t
    join challenges c on c.id = t.challenge_id
    join accounts a on a.id = t.account_id
   where c.id = p_challenge and c.project_id = p_project and t.finished_at is not null
   order by t.points desc, t.total_ms
   limit least(greatest(p_limit, 1), 100);
$$;

-- -----------------------------------------------------------------------------
-- Server only: nobody but the secret key runs these.
-- -----------------------------------------------------------------------------

revoke execute on function app.challenge_advance(uuid) from public, anon, authenticated;
revoke execute on function public.challenge_by_token(text) from public, anon, authenticated;
revoke execute on function public.challenge_start(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.challenge_answer(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.challenge_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.challenges_for_account(uuid) from public, anon, authenticated;
revoke execute on function public.challenge_list(uuid) from public, anon, authenticated;
revoke execute on function public.challenge_save(uuid, uuid, text, text, text, date, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function public.challenge_questions_list(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.challenge_question_save(uuid, uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.challenge_question_hide(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.challenge_top(uuid, uuid, integer) from public, anon, authenticated;

grant execute on function app.quroosh_today() to service_role;
grant execute on function app.challenge_advance(uuid) to service_role;
grant execute on function public.challenge_by_token(text) to service_role;
grant execute on function public.challenge_start(uuid, uuid) to service_role;
grant execute on function public.challenge_answer(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.challenge_state(uuid, uuid) to service_role;
grant execute on function public.challenges_for_account(uuid) to service_role;
grant execute on function public.challenge_list(uuid) to service_role;
grant execute on function public.challenge_save(uuid, uuid, text, text, text, date, integer, integer, boolean) to service_role;
grant execute on function public.challenge_questions_list(uuid, uuid) to service_role;
grant execute on function public.challenge_question_save(uuid, uuid, uuid, text, jsonb, integer) to service_role;
grant execute on function public.challenge_question_hide(uuid, uuid, boolean) to service_role;
grant execute on function public.challenge_top(uuid, uuid, integer) to service_role;

notify pgrst, 'reload schema';
