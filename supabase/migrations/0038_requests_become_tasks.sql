-- =============================================================================
-- 0038 — A request type can turn into one real Task.
--
-- Some workflows end in work: somebody accepts the request and then somebody
-- does the thing. Until now those two halves were separate — a request had its
-- own little review flow bolted on, which meant a second way to submit work, a
-- second way to review it, and work that never reached anybody's KPI.
--
-- This makes "becomes a task" an OPTIONAL CAPABILITY any request type can turn
-- on, the same way a type optionally has an approval hook. Every existing type
-- is untouched: the flag defaults to false, so Fund, IT, Asset and Meeting
-- requests behave exactly as they did.
--
-- Nothing here names Design or Media. Two types use it today; the shape does
-- not care how many use it tomorrow.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The capability, on the type
-- -----------------------------------------------------------------------------

alter table request_types
  add column if not exists creates_task boolean not null default false,
  add column if not exists task_start_date_key text not null default 'starting_date',
  add column if not exists task_due_date_keys text[] not null default '{delivery_date}',
  add column if not exists task_requires_link boolean not null default false,
  add column if not exists on_task_event_hook text references request_hooks (name);

comment on column request_types.task_due_date_keys is
  'Ordered list of data keys to take the task''s due date from; the FIRST one
   present wins. This is what lets one type carry two flavours without a branch
   in code — a Media Request reads {event_date, delivery_date}, so coverage of
   a real event is pinned to that event while standalone content uses whatever
   date the Director agreed.';

comment on column request_types.on_task_event_hook is
  'Run when the task this request created is submitted, confirmed or rejected.
   The task workflow knows nothing about requests; it only reports what
   happened, and this decides what that means.';

-- -----------------------------------------------------------------------------
-- 2. The link between a task and the request that made it
-- -----------------------------------------------------------------------------

alter table tasks
  add column if not exists source_request_id uuid references requests (id) on delete set null,
  -- Where the finished work is. §1: a link, never an upload — the club already
  -- keeps design and media files in Drive, and a 200 MB video does not belong
  -- in a Postgres bucket.
  add column if not exists submission_url text;

create index if not exists tasks_source_request_idx on tasks (source_request_id);

comment on column tasks.submission_url is
  'Supplied when submitting for review, and REQUIRED when the task came from a
   request type with task_requires_link. Ordinary tasks are unaffected.';

/*
 * `app.enforce_task_workflow` (0012) rejects writes to the workflow columns
 * unless one of the workflow functions signalled itself. `submission_url` is
 * part of submitting, so it has to be added to that guarded set — otherwise
 * anyone could PATCH a link onto a task they do not own.
 */
create or replace function app.enforce_task_workflow()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.task_workflow', true), '') = 'on' then
    return new;
  end if;

  if new.assigned_at    is distinct from old.assigned_at
     or new.submitted_at  is distinct from old.submitted_at
     or new.confirmed_at  is distinct from old.confirmed_at
     or new.confirmed_by  is distinct from old.confirmed_by
     or new.not_done_at   is distinct from old.not_done_at
     or new.not_done_by   is distinct from old.not_done_by
     or new.rejected_at   is distinct from old.rejected_at
     or new.review_note   is distinct from old.review_note
     or new.submission_url is distinct from old.submission_url
  then
    raise exception
      'Task progress is changed through claim_task / submit_task_for_review / confirm_task / reject_task / mark_task_not_done, not by writing these columns'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Creating the task
--
-- Registered as a TRANSITION hook, so which move creates the task is
-- configuration. The transition collects the dates and the assignee; this
-- reads them by the key names the type declares.
-- -----------------------------------------------------------------------------

create or replace function app.hook_create_task_from_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          requests%rowtype;
  t          request_types%rowtype;
  v_task     uuid;
  v_start    date;
  v_due      date;
  v_key      text;
  v_assignee uuid;
begin
  select * into r from requests where id = p_request;
  select * into t from request_types where id = r.request_type_id;

  if not t.creates_task then
    return;
  end if;

  -- One request, one task (§1). A second accept after a rejection must not
  -- spawn a rival.
  if exists (select 1 from tasks where source_request_id = p_request) then
    return;
  end if;

  v_start := nullif(btrim(coalesce(r.data ->> t.task_start_date_key, '')), '')::date;

  -- First declared key that actually has a value. For Media that is the event
  -- date when there is an event, and the agreed delivery date when there is not.
  foreach v_key in array t.task_due_date_keys loop
    v_due := nullif(btrim(coalesce(r.data ->> v_key, '')), '')::date;
    exit when v_due is not null;
  end loop;

  if v_start is null or v_due is null then
    raise exception 'This step needs both a starting date and a delivery date'
      using errcode = '23514';
  end if;

  v_assignee := nullif(btrim(coalesce(r.data ->> 'assignee_id', '')), '')::uuid;

  /*
   * The task belongs to the team that DOES the work — the type's owning team —
   * not to any project the request happens to name. The person designing the
   * poster is on Design, so it is Design's numbers that should move. The
   * project link stays on the request as context.
   */
  insert into tasks (
    title, description, team_id, due_date, created_by, source_request_id, assigned_at
  ) values (
    coalesce(nullif(r.data ->> 'title', ''), t.name_en),
    r.data ->> 'details',
    t.owning_team_id,
    v_due,
    app.current_member_id(),
    p_request,
    -- §1: Assigned Date = Starting Date. Set here even when nobody is assigned
    -- yet, because it is when the work is meant to start, not when somebody
    -- picked it up.
    v_start::timestamptz
  )
  returning id into v_task;

  -- Assigned outright, or left for someone on the team to claim (§1). Assigning
  -- to yourself is an ordinary assignment; nothing special about it.
  if v_assignee is not null then
    insert into task_assignees (task_id, member_id) values (v_task, v_assignee);
  end if;
end;
$$;

insert into request_hooks (name, function_schema, function_name, description)
values (
  'create_task_from_request',
  'app',
  'hook_create_task_from_request',
  'Creates the one real Task an accepted request becomes, using the dates and assignee the accepting transition collected.'
)
on conflict (name) do update
  set function_schema = excluded.function_schema,
      function_name   = excluded.function_name,
      description     = excluded.description;

-- -----------------------------------------------------------------------------
-- 4. Reporting back
--
-- The task workflow says WHAT happened; the request type decides what it MEANS.
-- Deliberately the same shape as app.notify_meeting_confirmed (0034), so the
-- task module stays as ignorant of requests as the meetings module is.
-- -----------------------------------------------------------------------------

create or replace function app.notify_task_event(
  p_request uuid,
  p_task    uuid,
  p_event   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hook     text;
  v_schema   text;
  v_function text;
begin
  select t.on_task_event_hook into v_hook
  from requests r
  join request_types t on t.id = r.request_type_id
  where r.id = p_request;

  if v_hook is null then
    return;   -- nothing is listening; a perfectly normal answer
  end if;

  select h.function_schema, h.function_name
    into v_schema, v_function
  from request_hooks h
  where h.name = v_hook;

  if v_function is null then
    raise exception 'Request type refers to unknown task-event hook "%"', v_hook;
  end if;

  execute format('select %I.%I($1, $2, $3)', v_schema, v_function)
    using p_request, p_task, p_event;
end;
$$;

create or replace function app.report_task_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text;
begin
  if new.source_request_id is null then
    return null;
  end if;

  if new.submitted_at is distinct from old.submitted_at and new.submitted_at is not null then
    v_event := 'submitted';
  elsif new.confirmed_at is distinct from old.confirmed_at and new.confirmed_at is not null then
    v_event := 'confirmed';
  elsif new.rejected_at is distinct from old.rejected_at and new.rejected_at is not null then
    v_event := 'rejected';
  elsif new.not_done_at is distinct from old.not_done_at and new.not_done_at is not null then
    v_event := 'not_done';
  else
    return null;
  end if;

  perform app.notify_task_event(new.source_request_id, new.id, v_event);
  return null;
end;
$$;

create trigger tasks_report_event
  after update on tasks
  for each row execute function app.report_task_event();

-- -----------------------------------------------------------------------------
-- 5. Submitting with a link (§1)
--
-- The URL argument is optional in the signature so every existing caller keeps
-- working; it is REQUIRED only for tasks whose type asked for one.
-- -----------------------------------------------------------------------------

create or replace function public.submit_task_for_review(
  p_task uuid,
  p_url  text default null
)
returns void
language plpgsql
as $$
declare
  v_task     tasks;
  v_me       uuid := app.current_member_id();
  v_requires boolean := false;
begin
  if v_me is null or app.task_assignee(p_task) is distinct from v_me then
    raise exception 'Only the assignee can submit this task for review'
      using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task;

  if v_task.confirmed_at is not null or v_task.not_done_at is not null then
    raise exception 'This task is already finished' using errcode = '42501';
  end if;
  if v_task.submitted_at is not null then
    raise exception 'This task is already waiting for confirmation'
      using errcode = '42501';
  end if;

  if v_task.source_request_id is not null then
    select t.task_requires_link into v_requires
    from requests r
    join request_types t on t.id = r.request_type_id
    where r.id = v_task.source_request_id;
  end if;

  if coalesce(v_requires, false)
     and nullif(btrim(coalesce(p_url, '')), '') is null then
    raise exception 'This task is delivered as a link. Paste the URL to the file or folder.'
      using errcode = '23514';
  end if;

  perform set_config('app.task_workflow', 'on', true);
  update tasks
     set submitted_at   = now(),
         rejected_at    = null,
         review_note    = null,
         submission_url = coalesce(nullif(btrim(coalesce(p_url, '')), ''), submission_url)
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

grant execute on function public.submit_task_for_review(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Rejecting, with the new dates (§1)
--
-- "The old dates don't just carry over." The Director supplies the new ones as
-- part of rejecting, so the task goes straight back to In Progress with a
-- deadline its assignee can actually see.
--
-- Worth knowing: Completion is scored against `due_date`, so a re-dated task is
-- measured from its NEW deadline. A badly-missed first attempt can still score
-- 100 on the second. That follows from the club asking for fresh dates on every
-- rejection, and is a policy choice rather than an oversight.
-- -----------------------------------------------------------------------------

create or replace function public.reject_task(
  p_task  uuid,
  p_note  text default null,
  p_start date default null,
  p_due   date default null
)
returns void
language plpgsql
as $$
declare
  v_task     tasks;
  v_requires boolean := false;
begin
  if not app.can_confirm_task(p_task) then
    raise exception 'You are not the confirmer for this task'
      using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task;
  if v_task.submitted_at is null then
    raise exception 'This task is not waiting for confirmation'
      using errcode = '42501';
  end if;
  if v_task.confirmed_at is not null or v_task.not_done_at is not null then
    raise exception 'This task is already finished' using errcode = '42501';
  end if;

  -- Only work that came from a request insists on re-dating; an ordinary task
  -- keeps the deadline it always had.
  if v_task.source_request_id is not null then
    select t.creates_task into v_requires
    from requests r
    join request_types t on t.id = r.request_type_id
    where r.id = v_task.source_request_id;
  end if;

  if coalesce(v_requires, false) and (p_start is null or p_due is null) then
    raise exception 'Sending this back needs a new starting date and a new delivery date'
      using errcode = '23514';
  end if;

  if p_due is not null and p_start is not null and p_due < p_start then
    raise exception 'The delivery date cannot be before the starting date'
      using errcode = '23514';
  end if;

  perform set_config('app.task_workflow', 'on', true);
  -- Clearing submitted_at is what returns the task to In Progress, and it also
  -- discards the old Completion Date: the next submission sets a fresh one.
  update tasks
     set submitted_at = null,
         rejected_at  = now(),
         review_note  = p_note,
         assigned_at  = coalesce(p_start::timestamptz, assigned_at),
         due_date     = coalesce(p_due, due_date)
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

grant execute on function public.reject_task(uuid, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Claiming, for work that came from a request
--
-- Two problems, both found by reading the existing functions rather than by
-- assuming:
--
--   a) `app.can_claim_task` refuses team tasks outright — "team-internal work
--      is assigned, not claimed" (§3). But a request-created task IS a team
--      task, and §1 explicitly lets the Director post it unclaimed for someone
--      on the team to pick up. So requests are the one exception, and it is
--      written as an exception rather than by loosening the rule for everyone.
--
--   b) `claim_task` set `assigned_at = now()`, which was right when that column
--      only meant "when somebody picked this up". §1 gives it a second meaning
--      — Assigned Date = the Starting Date the Director set — and claiming
--      three days later would have quietly erased it. `coalesce` keeps both
--      readings, because an ordinary task's assigned_at is null until claimed.
-- -----------------------------------------------------------------------------

create or replace function app.can_claim_task(p_task uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_task tasks;
begin
  if app.current_member_id() is null then
    return false;
  end if;

  select * into v_task from tasks where id = p_task;
  if not found then
    return false;
  end if;

  -- "An UNCLAIMED task is posted…"
  if exists (select 1 from task_assignees ta where ta.task_id = p_task) then
    return false;
  end if;

  if v_task.project_id is null then
    -- §3: ordinary team-internal work is assigned, not claimed.
    if v_task.source_request_id is null then
      return false;
    end if;
    -- §1: except when it came from a request the Director chose not to assign.
    -- Then it is open to that team.
    return exists (
      select 1 from members m
      where m.id = app.current_member_id() and m.team_id = v_task.team_id
    );
  end if;

  -- Posted to one specific split, or to the whole project.
  if v_task.split_id is not null then
    return app.is_on_split(v_task.split_id);
  end if;

  return app.is_on_project(v_task.project_id);
end;
$$;

/*
 * `claim_task` keeps its own readable errors rather than deferring to the
 * boolean above — "this task has already been claimed" is more use than "you
 * cannot claim this". The two must agree, so both branches are mirrored.
 */
create or replace function public.claim_task(p_task uuid)
returns void
language plpgsql
as $$
declare
  v_task tasks;
  v_me   uuid := app.current_member_id();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task;
  if not found then
    raise exception 'Task not found, or you are not allowed to see it'
      using errcode = '42501';
  end if;

  if exists (select 1 from task_assignees where task_id = p_task) then
    raise exception 'This task has already been claimed' using errcode = '42501';
  end if;

  if v_task.project_id is null then
    if v_task.source_request_id is null then
      raise exception 'Only project tasks can be claimed' using errcode = '42501';
    end if;
    if not exists (
      select 1 from members m where m.id = v_me and m.team_id = v_task.team_id
    ) then
      raise exception 'Only members of this team can claim this task'
        using errcode = '42501';
    end if;

  -- §3: scoped either to the whole project or to one specific split.
  elsif v_task.split_id is not null then
    if not app.is_on_split(v_task.split_id) then
      raise exception 'Only members of this split can claim this task'
        using errcode = '42501';
    end if;
  elsif not app.is_on_project(v_task.project_id) then
    raise exception 'Only members of this project can claim this task'
      using errcode = '42501';
  end if;

  insert into task_assignees (task_id, member_id) values (p_task, v_me);

  perform set_config('app.task_workflow', 'on', true);
  update tasks set assigned_at = coalesce(assigned_at, now()) where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

grant execute on function public.claim_task(uuid) to authenticated;

-- The old two-argument shapes would now be ambiguous against the new defaults.
drop function if exists public.submit_task_for_review(uuid);
drop function if exists public.reject_task(uuid, text);
