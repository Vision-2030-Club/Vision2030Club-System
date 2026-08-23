-- =============================================================================
-- 0012 — Development team KPI module (addendum §1–§9).
--
-- The point of this module is that KPI numbers are DERIVED from the same tasks
-- everyone else already uses. So there is no "kpi_results" table anywhere
-- below: every score, status, risk tier and health rating is computed live by
-- a view over `tasks`. Nothing is denormalised, which is also what makes §7's
-- "deleting a task recalculates everything" free — remove the row and the
-- averages simply stop seeing it.
--
-- Only two facts are stored that cannot be derived: the moment work was
-- submitted (§2.2 — fixed at submission, not at review) and the confirmer's
-- Quality judgement (§4). Everything else falls out of dates.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The club's wall clock.
--
-- "On or before the Due Date" (§4) has to be decided in one fixed timezone.
-- Supabase runs in UTC, so a submission at 02:00 Riyadh on the due date would
-- otherwise read as the previous day and score 100 where it should score 50.
-- -----------------------------------------------------------------------------
create or replace function app.club_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date
$$;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- §4's five Quality values. The 0–100 numbers live in app.quality_score() so
-- the scale can be re-tuned without an enum migration.
create type task_quality as enum ('excellent', 'very_good', 'good', 'poor', 'not_done');

-- §1's lifecycle. Never stored — public.task_kpi derives it from events.
create type task_state as enum (
  'not_started',
  'in_progress',
  'pending_confirmation',
  'completed',
  'not_done'
);

-- §4's live read. 'overdue' is deliberately its own value rather than a flavour
-- of 'high': the addendum asks for it to be visually distinct, not the same
-- label.
create type task_risk as enum (
  'low',
  'medium',
  'high',
  'overdue',
  'pending_review',   -- submitted; the clock is no longer the assignee's problem
  'completed',
  'not_done',
  'none'              -- open, but no due date to measure against
);

create type project_health as enum ('on_track', 'needs_attention', 'at_risk');

-- =============================================================================
-- §3 — Splits
-- =============================================================================

create table project_splits (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  name        text not null,          -- §3: free text, a PM's own wording
  created_by  uuid references members (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, name)
);

-- Lets `tasks` carry a composite FK proving its split is in the same project.
alter table project_splits
  add constraint project_splits_id_project_key unique (id, project_id);

create trigger project_splits_touch_updated_at
  before update on project_splits
  for each row execute function app.touch_updated_at();

-- §3: "one or more PMs", and one PM may run several splits in a project.
create table project_split_managers (
  split_id   uuid not null references project_splits (id) on delete cascade,
  member_id  uuid not null references members (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (split_id, member_id)
);

-- §3: a person may belong to more than one split in the same project. That is
-- independent of the club-wide "one team per member" rule, which only governs
-- members.team_id.
create table project_split_members (
  split_id   uuid not null references project_splits (id) on delete cascade,
  member_id  uuid not null references members (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (split_id, member_id)
);

create index project_splits_project_idx        on project_splits (project_id);
create index project_split_managers_member_idx on project_split_managers (member_id);
create index project_split_members_member_idx  on project_split_members (member_id);

-- =============================================================================
-- §1/§2 — Tasks lose their manual status and gain workflow events
-- =============================================================================

-- §1: "Nobody sets a task's status by hand, anywhere in the system, for any
-- task." A writable status column is the only way to do that, so it goes.
-- (The table was verified empty before this migration was written; there is
-- nothing to preserve.)
alter table tasks drop column status;
drop type task_status;

alter table tasks
  add column split_id     uuid references project_splits (id) on delete set null,
  -- §3: claiming sets this, NOT the moment the task was posted.
  add column assigned_at  timestamptz,
  -- §2.2: the Completion Date, fixed at "Submit for Review".
  add column submitted_at timestamptz,
  add column confirmed_at timestamptz,
  add column confirmed_by uuid references members (id),
  add column not_done_at  timestamptz,
  add column not_done_by  uuid references members (id),
  add column rejected_at  timestamptz,
  add column review_note  text;

-- A split-scoped task must sit in that split's own project. MATCH SIMPLE means
-- the FK simply does not apply when either column is null, which is exactly
-- right for team tasks and for project-wide tasks.
alter table tasks add constraint tasks_split_matches_project
  foreign key (split_id, project_id)
  references project_splits (id, project_id)
  on delete set null;

alter table tasks
  add constraint tasks_split_needs_project
    check (split_id is null or project_id is not null),
  -- §2: Completed and Not Done are terminal and mutually exclusive.
  add constraint tasks_one_terminal_state
    check (not (confirmed_at is not null and not_done_at is not null)),
  -- §2.4: confirmation only ever follows a submission.
  add constraint tasks_confirmed_after_submission
    check (confirmed_at is null or submitted_at is not null),
  -- §2.5: Not Done is only for tasks where nothing was ever submitted.
  add constraint tasks_not_done_without_submission
    check (not_done_at is null or submitted_at is null);

create index tasks_split_id_idx     on tasks (split_id);
create index tasks_due_date_idx     on tasks (due_date);
create index tasks_confirmed_at_idx on tasks (confirmed_at);

-- One assignee per task, so §5's per-person average is unambiguous.
-- task_assignees survives as the join table so existing policies keep working.
create unique index task_assignees_one_per_task on task_assignees (task_id);

-- =============================================================================
-- §4 — Scores live in their own table
--
-- Same reasoning as member_sensitive in 0001. §8 says "nobody can view their
-- own KPI, under any circumstance", and the cheapest way to guarantee that is
-- a separate table with its own policy. Leaving `quality` as a column on
-- `tasks` would let an assignee read their own grade straight off a row they
-- are already allowed to select.
-- =============================================================================

create table task_scores (
  task_id    uuid primary key references tasks (id) on delete cascade,
  quality    task_quality not null,
  scored_by  uuid references members (id),
  scored_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- §4's Quality scale, in one place.
create or replace function app.quality_score(p_quality task_quality)
returns integer
language sql
immutable
as $$
  select case p_quality
    when 'excellent' then 100
    when 'very_good' then 75
    when 'good'      then 50
    when 'poor'      then 25
    when 'not_done'  then 0
  end
$$;

-- =============================================================================
-- Relationship helpers (§2's "who confirms")
--
-- As everywhere else in this system, no role name appears below. Authority is
-- the caller's SCOPE for a permission, compared against the row.
-- =============================================================================

create or replace function app.is_split_manager(p_split uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_split is null then
    return false;
  end if;
  return exists (
    select 1 from project_split_managers m
    where m.split_id = p_split
      and m.member_id = app.current_member_id()
  );
end;
$$;

create or replace function app.is_on_split(p_split uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_split is null then
    return false;
  end if;
  return exists (
    select 1 from project_split_members m
    where m.split_id = p_split
      and m.member_id = app.current_member_id()
  ) or app.is_split_manager(p_split);
end;
$$;

create or replace function app.task_assignee(p_task uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member_id from task_assignees where task_id = p_task
$$;

-- "A Director or PM with authority over that task" (§2, §7):
--
--   team-internal task      -> a Director of the ASSIGNEE's team
--   project task in a split -> a PM of that split
--   project-wide task       -> a PM of the project
--
-- Exactly one such person acting is enough; this returns true for each of them
-- independently, and nothing anywhere waits for all of them.
create or replace function app.can_administer_task(p_task uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_task  tasks;
  v_scope permission_scope;
  v_team  uuid;
begin
  if app.current_member_id() is null then
    return false;
  end if;

  select * into v_task from tasks where id = p_task;
  if not found then
    return false;
  end if;

  v_scope := app.effective_scope('tasks.confirm');

  if v_scope = 'none' then return false; end if;
  if v_scope = 'all'  then return true;  end if;

  if v_task.project_id is not null then
    if v_scope <> 'own_projects' then
      return false;
    end if;
    -- A split's work is confirmed by that split's PMs. A PM running a
    -- different split of the same project is not an authority here.
    if v_task.split_id is not null then
      return app.is_split_manager(v_task.split_id);
    end if;
    return app.is_project_manager(v_task.project_id);
  end if;

  if v_scope <> 'own_team' then
    return false;
  end if;

  -- The assignee's team decides, falling back to the task's own team while
  -- nobody is assigned yet.
  select m.team_id into v_team
  from task_assignees ta
  join members m on m.id = ta.member_id
  where ta.task_id = p_task;

  return coalesce(v_team, v_task.team_id) = app.current_team_id();
end;
$$;

-- §2: "The assignee's only two actions on their own task, ever: claim it and
-- Submit for Review. They cannot confirm or score their own work." That holds
-- even when the assignee happens to be the Director or PM who would otherwise
-- be the confirmer.
create or replace function app.can_confirm_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.can_administer_task(p_task)
     and coalesce(app.task_assignee(p_task) <> app.current_member_id(), true)
$$;

-- =============================================================================
-- §8 — Who may see whose KPI
-- =============================================================================

create or replace function app.can_view_kpi_for_member(p_member uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := app.current_member_id();
  v_scope permission_scope;
begin
  if v_me is null or p_member is null then
    return false;
  end if;

  -- §8: "Nobody can view their own KPI, under any circumstance." First check,
  -- before any scope is even read, so no grant can ever reach past it.
  if p_member = v_me then
    return false;
  end if;

  v_scope := app.effective_scope('kpi.view');

  if v_scope = 'none' then return false; end if;
  if v_scope = 'all'  then return true;  end if;

  -- §8: granted to a Director or PM, it is scoped to their own team/project.
  if v_scope = 'own_team' then
    return (select team_id from members where id = p_member) = app.current_team_id();
  end if;

  if v_scope = 'own_projects' then
    return exists (
      select 1
      from tasks t
      join task_assignees ta on ta.task_id = t.id
      where ta.member_id = p_member
        and t.project_id is not null
        and (app.is_project_manager(t.project_id) or app.is_split_manager(t.split_id))
    );
  end if;

  return false;
end;
$$;

create or replace function app.can_view_kpi_for_project(p_project uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope permission_scope;
begin
  if app.current_member_id() is null or p_project is null then
    return false;
  end if;

  v_scope := app.effective_scope('kpi.view');

  if v_scope = 'none' then return false; end if;
  if v_scope = 'all'  then return true;  end if;
  if v_scope = 'own_projects' then return app.is_project_manager(p_project); end if;
  if v_scope = 'own_team' then
    return (select owning_team_id from projects where id = p_project)
           = app.current_team_id();
  end if;

  return false;
end;
$$;

-- A confirmer must be able to read back the grade they just gave, so holding
-- authority over the task is an independent route in. Self-exclusion still
-- wins over both routes.
create or replace function app.can_view_task_score(p_task uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignee uuid := app.task_assignee(p_task);
begin
  if v_assignee is not null and v_assignee = app.current_member_id() then
    return false;
  end if;
  return app.can_administer_task(p_task)
      or (v_assignee is not null and app.can_view_kpi_for_member(v_assignee));
end;
$$;

-- =============================================================================
-- §1/§4 — The derived read. This view IS the KPI engine.
-- =============================================================================

create or replace view public.task_kpi
with (security_invoker = on) as
select
  t.id,
  t.title,
  t.project_id,
  t.team_id,
  t.split_id,
  t.due_date,
  t.created_at,
  t.assigned_at,
  t.submitted_at,
  t.confirmed_at,
  t.not_done_at,
  t.rejected_at,
  ta.member_id as assignee_id,
  s.quality,
  d.state,
  d.days_remaining,
  d.risk,
  -- §4: 100 / 75 / 50 / 25 / 0. Null when the viewer may not see the grade —
  -- task_scores' own policy drops the joined row, which is how §8 is enforced.
  app.quality_score(s.quality) as quality_score,
  d.completion_score,
  -- §4: Overall = (Quality + Completion) / 2. Null follows Quality.
  case
    when s.quality is null or d.completion_score is null then null
    else (app.quality_score(s.quality) + d.completion_score)::numeric / 2
  end as overall_score,
  -- §5: In Progress is excluded from averages entirely — not counted as a 0.
  (t.confirmed_at is not null or t.not_done_at is not null) as counts_toward_kpi,
  d.is_delayed
from tasks t
left join task_assignees ta on ta.task_id = t.id
left join task_scores s     on s.task_id  = t.id
cross join lateral (
  select
    case
      when t.not_done_at  is not null then 'not_done'
      when t.confirmed_at is not null then 'completed'
      when t.submitted_at is not null then 'pending_confirmation'
      when ta.member_id   is not null then 'in_progress'
      else 'not_started'
    end::task_state as state,
    case when t.due_date is null then null
         else t.due_date - app.club_today() end as days_remaining
) b
cross join lateral (
  select
    b.state,
    b.days_remaining,
    case
      when b.state = 'completed'            then 'completed'
      when b.state = 'not_done'             then 'not_done'
      when b.state = 'pending_confirmation' then 'pending_review'
      when b.days_remaining is null         then 'none'
      -- §4: Overdue means the due date passed with nothing submitted.
      when b.days_remaining <  0            then 'overdue'
      when b.days_remaining <= 2            then 'high'
      when b.days_remaining <= 5            then 'medium'
      else 'low'
    end::task_risk as risk,
    -- §4: On time 100 · Late (any amount, no sliding scale) 50 · Not Done 0.
    case
      when t.not_done_at is not null then 0
      when t.confirmed_at is not null then
        case
          when t.due_date is null then 100
          when (t.submitted_at at time zone 'Asia/Riyadh')::date <= t.due_date then 100
          else 50
        end
      else null
    end as completion_score
) c
cross join lateral (
  select
    c.state, c.days_remaining, c.risk, c.completion_score,
    -- "Delayed" = assigned but no longer On Track by elapsed time. On Track is
    -- §4's Low tier, so anything tighter counts, and an overdue task is by
    -- definition behind schedule too.
    c.risk in ('medium', 'high', 'overdue') as is_delayed
) d;

comment on view public.task_kpi is
  'Live per-task derivation: state, risk tier, and the two §4 scores. Nothing
   here is stored. quality_score/overall_score come back null when the viewer
   is barred from the grade (§8), because task_scores'' policy drops the join.';

-- -----------------------------------------------------------------------------
-- §5 — %Performance per member
--
-- A plain average of Overall across every task that counts, over all time. No
-- rolling window, no per-semester reset.
-- -----------------------------------------------------------------------------
create or replace view public.member_kpi
with (security_invoker = on) as
select
  k.assignee_id as member_id,
  count(*)                                                              as total_tasks,
  count(*) filter (where k.counts_toward_kpi)                           as scored_tasks,
  count(*) filter (where k.state = 'completed')                         as completed_tasks,
  count(*) filter (where k.state = 'not_done')                          as not_done_tasks,
  count(*) filter (where k.state = 'in_progress')                       as in_progress_tasks,
  count(*) filter (where k.state = 'pending_confirmation')              as pending_tasks,
  count(*) filter (where k.is_delayed)                                  as delayed_tasks,
  count(*) filter (where k.risk = 'high')                               as high_risk_tasks,
  count(*) filter (where k.risk = 'overdue')                            as overdue_tasks,
  round(avg(k.overall_score) filter (where k.counts_toward_kpi), 1)     as performance,
  -- §9: the profile page shows these two side by side.
  round(avg(k.overall_score)
        filter (where k.counts_toward_kpi and k.team_id is not null), 1) as team_performance,
  round(avg(k.overall_score)
        filter (where k.counts_toward_kpi and k.project_id is not null), 1)
                                                                         as project_performance,
  -- §6's three-tier rule, applied to one person's workload.
  case
    when count(*) filter (where k.risk = 'high') >= 3 then 'at_risk'
    when count(*) filter (where k.is_delayed)
       > count(*) filter (where k.state = 'completed') then 'needs_attention'
    else 'on_track'
  end::project_health as health
from public.task_kpi k
where k.assignee_id is not null
  -- §8, again at the aggregate level.
  and app.can_view_kpi_for_member(k.assignee_id)
group by k.assignee_id;

comment on view public.member_kpi is
  'Per-member %Performance (§5). Rows the caller may not see — their own above
   all — never appear, so this view can be selected from freely.';

-- -----------------------------------------------------------------------------
-- §6 — Project-level numbers
-- -----------------------------------------------------------------------------
create or replace view public.project_kpi
with (security_invoker = on) as
select
  p.id as project_id,
  count(k.id)                                                          as total_tasks,
  count(*) filter (where k.counts_toward_kpi)                          as scored_tasks,
  count(*) filter (where k.state = 'completed')                        as completed_tasks,
  count(*) filter (where k.state = 'not_done')                         as not_done_tasks,
  count(*) filter (where k.is_delayed)                                 as delayed_tasks,
  count(*) filter (where k.risk = 'high')                              as high_risk_tasks,
  count(*) filter (where k.risk = 'overdue')                           as overdue_tasks,
  -- Computed live, never typed in by a PM (§6).
  round(avg(k.overall_score) filter (where k.counts_toward_kpi), 1)    as completion_pct,
  case
    when count(*) filter (where k.risk = 'high') >= 3 then 'at_risk'
    when count(*) filter (where k.is_delayed)
       > count(*) filter (where k.state = 'completed') then 'needs_attention'
    else 'on_track'
  end::project_health as health
from projects p
left join public.task_kpi k on k.project_id = p.id
where app.can_view_kpi_for_project(p.id)
group by p.id;

-- §6: "the system must be able to show a falling-behind flag at the level of a
-- specific PM or a specific Member, not only at the whole-project level".
-- These two views are that requirement.
create or replace view public.project_member_kpi
with (security_invoker = on) as
select
  k.project_id,
  k.assignee_id as member_id,
  k.split_id,
  count(*)                                                          as total_tasks,
  count(*) filter (where k.state = 'completed')                     as completed_tasks,
  count(*) filter (where k.state = 'not_done')                      as not_done_tasks,
  count(*) filter (where k.is_delayed)                              as delayed_tasks,
  count(*) filter (where k.risk = 'high')                           as high_risk_tasks,
  count(*) filter (where k.risk = 'overdue')                        as overdue_tasks,
  round(avg(k.overall_score) filter (where k.counts_toward_kpi), 1) as performance,
  case
    when count(*) filter (where k.risk = 'high') >= 3 then 'at_risk'
    when count(*) filter (where k.is_delayed)
       > count(*) filter (where k.state = 'completed') then 'needs_attention'
    else 'on_track'
  end::project_health as health
from public.task_kpi k
where k.project_id is not null
  and k.assignee_id is not null
  and app.can_view_kpi_for_member(k.assignee_id)
group by k.project_id, k.assignee_id, k.split_id;

create or replace view public.project_split_kpi
with (security_invoker = on) as
select
  s.id   as split_id,
  s.project_id,
  s.name,
  count(k.id)                                                       as total_tasks,
  count(*) filter (where k.state = 'completed')                     as completed_tasks,
  count(*) filter (where k.state = 'not_done')                      as not_done_tasks,
  count(*) filter (where k.is_delayed)                              as delayed_tasks,
  count(*) filter (where k.risk = 'high')                           as high_risk_tasks,
  count(*) filter (where k.risk = 'overdue')                        as overdue_tasks,
  round(avg(k.overall_score) filter (where k.counts_toward_kpi), 1) as completion_pct,
  case
    when count(*) filter (where k.risk = 'high') >= 3 then 'at_risk'
    when count(*) filter (where k.is_delayed)
       > count(*) filter (where k.state = 'completed') then 'needs_attention'
    else 'on_track'
  end::project_health as health
from project_splits s
left join public.task_kpi k on k.split_id = s.id
where app.can_view_kpi_for_project(s.project_id)
group by s.id, s.project_id, s.name;

-- =============================================================================
-- §2 — The completion workflow
--
-- These five functions are the ONLY legal way to move a task through its
-- lifecycle. app.enforce_task_workflow() below rejects any other write to the
-- workflow columns, so a Member with tasks.manage = 'assigned' cannot reach
-- past "Submit for Review" by PATCHing the row directly.
-- =============================================================================

create or replace function app.enforce_task_workflow()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.task_workflow', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.submitted_at is not null
       or new.confirmed_at is not null
       or new.not_done_at is not null
       or new.confirmed_by is not null
       or new.not_done_by is not null then
      raise exception 'A task cannot be created already submitted, confirmed, or marked Not Done'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.submitted_at is distinct from old.submitted_at
     or new.confirmed_at is distinct from old.confirmed_at
     or new.confirmed_by is distinct from old.confirmed_by
     or new.not_done_at  is distinct from old.not_done_at
     or new.not_done_by  is distinct from old.not_done_by
     or new.rejected_at  is distinct from old.rejected_at then
    raise exception 'Task status is computed, not set. Use submit_task_for_review, confirm_task, reject_task, or mark_task_not_done'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger tasks_enforce_workflow
  before insert or update on tasks
  for each row execute function app.enforce_task_workflow();

-- Same guard for the grade itself.
create or replace function app.enforce_score_workflow()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.task_workflow', true), '') <> 'on' then
    raise exception 'Task scores are set by confirm_task or mark_task_not_done'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger task_scores_enforce_workflow
  before insert or update or delete on task_scores
  for each row execute function app.enforce_score_workflow();

-- §3: claiming an unclaimed task. Sets Assigned Date to the moment of
-- claiming, not whenever the task was posted.
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

  if v_task.project_id is null then
    raise exception 'Only project tasks can be claimed' using errcode = '42501';
  end if;

  if exists (select 1 from task_assignees where task_id = p_task) then
    raise exception 'This task has already been claimed' using errcode = '42501';
  end if;

  -- §3: scoped either to the whole project or to one specific split.
  if v_task.split_id is not null then
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
  update tasks set assigned_at = now() where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

-- §2.2: the assignee, once done. Fixes the Completion Date at this moment.
create or replace function public.submit_task_for_review(p_task uuid)
returns void
language plpgsql
as $$
declare
  v_task tasks;
  v_me   uuid := app.current_member_id();
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

  perform set_config('app.task_workflow', 'on', true);
  update tasks
     set submitted_at = now(),
         rejected_at  = null,
         review_note  = null
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

-- §2.4: confirm — record Quality, and the status becomes Completed. The
-- Completion score is never passed in; task_kpi computes it from the dates.
create or replace function public.confirm_task(p_task uuid, p_quality text)
returns void
language plpgsql
as $$
declare
  v_task    tasks;
  v_quality task_quality;
  v_me      uuid := app.current_member_id();
begin
  if not app.can_confirm_task(p_task) then
    raise exception 'You are not the confirmer for this task'
      using errcode = '42501';
  end if;

  v_quality := p_quality::task_quality;
  if v_quality = 'not_done' then
    raise exception 'Not Done is set by mark_task_not_done, not by confirming'
      using errcode = '22023';
  end if;

  select * into v_task from tasks where id = p_task;
  if v_task.submitted_at is null then
    raise exception 'This task has not been submitted for review yet'
      using errcode = '42501';
  end if;
  if v_task.confirmed_at is not null or v_task.not_done_at is not null then
    raise exception 'This task is already finished' using errcode = '42501';
  end if;

  perform set_config('app.task_workflow', 'on', true);

  update tasks
     set confirmed_at = now(),
         confirmed_by = v_me
   where id = p_task;

  insert into task_scores (task_id, quality, scored_by)
  values (p_task, v_quality, v_me)
  on conflict (task_id) do update
    set quality   = excluded.quality,
        scored_by = excluded.scored_by,
        scored_at = now();

  perform set_config('app.task_workflow', '', true);
end;
$$;

-- §2.4: reject — back to In Progress, and NO scores are recorded.
create or replace function public.reject_task(p_task uuid, p_note text default null)
returns void
language plpgsql
as $$
declare
  v_task tasks;
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

  perform set_config('app.task_workflow', 'on', true);
  -- Clearing submitted_at is what returns the task to In Progress, and it also
  -- discards the old Completion Date: the next submission sets a fresh one.
  update tasks
     set submitted_at = null,
         rejected_at  = now(),
         review_note  = p_note
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

-- §2.5: due date passed with nothing ever submitted. Sets BOTH scores to a
-- literal 0 (via quality 'not_done' plus the completion_score branch in
-- task_kpi), and unlike an untouched In Progress task this one counts.
create or replace function public.mark_task_not_done(p_task uuid)
returns void
language plpgsql
as $$
declare
  v_task tasks;
  v_me   uuid := app.current_member_id();
begin
  if not app.can_confirm_task(p_task) then
    raise exception 'You do not have authority over this task'
      using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task;

  if v_task.confirmed_at is not null or v_task.not_done_at is not null then
    raise exception 'This task is already finished' using errcode = '42501';
  end if;
  if v_task.submitted_at is not null then
    raise exception 'This task has been submitted; confirm or reject it instead'
      using errcode = '42501';
  end if;
  if v_task.due_date is null or v_task.due_date >= app.club_today() then
    raise exception 'Not Done only applies once the due date has passed'
      using errcode = '42501';
  end if;

  perform set_config('app.task_workflow', 'on', true);

  update tasks
     set not_done_at = now(),
         not_done_by = v_me
   where id = p_task;

  insert into task_scores (task_id, quality, scored_by)
  values (p_task, 'not_done', v_me)
  on conflict (task_id) do update
    set quality   = 'not_done',
        scored_by = excluded.scored_by,
        scored_at = now();

  perform set_config('app.task_workflow', '', true);
end;
$$;

-- §7: deletion. The cascade on task_scores removes the grade with it, and
-- because every KPI number is an average computed live, every affected
-- person's %Performance and every affected project's figures are recalculated
-- as though the task never existed. There is nothing to "recompute" by hand.
create or replace function public.delete_task(p_task uuid)
returns void
language plpgsql
as $$
begin
  if not app.can_administer_task(p_task) then
    raise exception 'You do not have authority over this task'
      using errcode = '42501';
  end if;

  perform set_config('app.task_workflow', 'on', true);
  delete from tasks where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table project_splits         enable row level security;
alter table project_split_managers enable row level security;
alter table project_split_members  enable row level security;
alter table task_scores            enable row level security;

create policy project_splits_select on project_splits
  for select using (
    (select app.can('projects.view', p_project => project_id))
    or (select app.is_on_project(project_id))
  );

create policy project_splits_write on project_splits
  for all
  using ((select app.can('projects.manage', p_project => project_id)))
  with check ((select app.can('projects.manage', p_project => project_id)));

create policy project_split_managers_select on project_split_managers
  for select using ((select app.is_signed_in()));

create policy project_split_managers_write on project_split_managers
  for all
  using (
    exists (select 1 from project_splits s
            where s.id = split_id
              and (select app.can('projects.manage', p_project => s.project_id)))
  )
  with check (
    exists (select 1 from project_splits s
            where s.id = split_id
              and (select app.can('projects.manage', p_project => s.project_id)))
  );

create policy project_split_members_select on project_split_members
  for select using (
    exists (select 1 from project_splits s where s.id = split_id)
  );

-- A split's own PMs staff it, as well as anyone who can manage the project.
create policy project_split_members_write on project_split_members
  for all
  using (
    (select app.is_split_manager(split_id))
    or exists (select 1 from project_splits s
               where s.id = split_id
                 and (select app.can('projects.manage', p_project => s.project_id)))
  )
  with check (
    (select app.is_split_manager(split_id))
    or exists (select 1 from project_splits s
               where s.id = split_id
                 and (select app.can('projects.manage', p_project => s.project_id)))
  );

-- §8's hard boundary. Writes are already blocked by the trigger above; this
-- policy is what stops the assignee from ever READING their own grade.
create policy task_scores_select on task_scores
  for select using ((select app.can_view_task_score(task_id)));

create policy task_scores_write on task_scores
  for all
  using ((select app.can_confirm_task(task_id)))
  with check ((select app.can_confirm_task(task_id)));

-- Project tasks must also be visible to the split they belong to.
drop policy tasks_select on tasks;
create policy tasks_select on tasks
  for select using (
    (select app.can('tasks.view', p_team => team_id, p_project => project_id))
    or (select app.is_on_project(project_id))
    or (select app.is_on_split(split_id))
    or exists (
      select 1 from task_assignees ta
      where ta.task_id = tasks.id
        and ta.member_id = (select app.current_member_id())
    )
  );

-- §7: a Director or PM with authority over the task may delete it. This sits
-- alongside the tasks.manage policy from 0005 rather than replacing it.
create policy tasks_delete_by_authority on tasks
  for delete using ((select app.can_administer_task(id)));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.task_kpi, public.member_kpi, public.project_kpi,
                public.project_member_kpi, public.project_split_kpi to authenticated;

grant execute on function public.claim_task(uuid)               to authenticated;
grant execute on function public.submit_task_for_review(uuid)   to authenticated;
grant execute on function public.confirm_task(uuid, text)       to authenticated;
grant execute on function public.reject_task(uuid, text)        to authenticated;
grant execute on function public.mark_task_not_done(uuid)       to authenticated;
grant execute on function public.delete_task(uuid)              to authenticated;

grant usage on schema app to anon, authenticated, service_role;
grant execute on all functions in schema app to anon, authenticated, service_role;
