-- =============================================================================
-- 0063 — Hours on a task, and the month as a unit of the KPI.
--
-- The teams' own trackers (Design, HR, Finance) total task hours per member
-- per month. The system scored quality and timeliness but recorded no effort,
-- so a Director comparing the KPI page with their sheet had nothing to put
-- against that column. Now:
--
--   tasks.hours              set by the member when they submit, correctable
--                            by the confirmer when they confirm — never by a
--                            plain update (the workflow guard covers it)
--   task_kpi.hours           the same value where every task list reads it
--   member_month_kpi         per member per month: tasks finished, completed,
--                            not done, hours, and the month's average score.
--                            The month is the one the work was submitted in,
--                            on the club's clock. §8 applies: a person never
--                            sees their own rows.
--
-- `submit_task_for_review` and `confirm_task` gain a trailing optional
-- `p_hours`. The previous signatures are dropped rather than left as
-- overloads: PostgREST cannot choose between two functions when the shorter
-- one's arguments are a prefix of the longer one's.
-- =============================================================================

alter table tasks
  add column if not exists hours numeric(6, 1)
  check (hours is null or (hours >= 0 and hours <= 999));

comment on column tasks.hours is
  'Effort the member reported on submitting, as corrected by the confirmer. Only the workflow functions may set it.';

-- -----------------------------------------------------------------------------
-- The guard (0045's version) now covers hours too.
-- -----------------------------------------------------------------------------

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
       or new.not_done_by is not null
       or new.submission_url is not null
       or new.hours is not null then
      raise exception
        'A task cannot be created already submitted, confirmed, marked Not Done, delivered, or with hours'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.submitted_at is distinct from old.submitted_at
     or new.confirmed_at is distinct from old.confirmed_at
     or new.confirmed_by is distinct from old.confirmed_by
     or new.not_done_at  is distinct from old.not_done_at
     or new.not_done_by  is distinct from old.not_done_by
     or new.rejected_at  is distinct from old.rejected_at
     or new.submission_url is distinct from old.submission_url
     or new.hours is distinct from old.hours then
    raise exception
      'Task status and hours are set by the workflow. Use submit_task_for_review, confirm_task, reject_task, or mark_task_not_done'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Submitting records the hours; confirming may correct them.
-- -----------------------------------------------------------------------------

drop function if exists public.submit_task_for_review(uuid);
drop function if exists public.submit_task_for_review(uuid, text);
drop function if exists public.submit_task_for_review(uuid, text, text);

create or replace function public.submit_task_for_review(
  p_task  uuid,
  p_url   text    default null,
  p_note  text    default null,
  p_hours numeric default null
)
returns void
language plpgsql
as $$
declare
  v_task tasks;
  v_me   uuid := app.current_member_id();
begin
  if v_me is null or not app.is_task_assignee(p_task) then
    raise exception 'Only an assignee can submit this task for review'
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

  if app.task_requires_link(p_task)
     and nullif(btrim(coalesce(p_url, '')), '') is null then
    raise exception 'This task is delivered as a link. Paste the URL to the file or folder.'
      using errcode = '23514';
  end if;

  if p_hours is not null and (p_hours < 0 or p_hours > 999) then
    raise exception 'Hours must be between 0 and 999' using errcode = '23514';
  end if;

  perform set_config('app.task_workflow', 'on', true);
  update tasks
     set submitted_at    = now(),
         rejected_at     = null,
         review_note     = null,
         submission_url  = coalesce(nullif(btrim(coalesce(p_url, '')), ''), submission_url),
         submission_note = nullif(btrim(coalesce(p_note, '')), ''),
         hours           = coalesce(p_hours, hours)
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

grant execute on function public.submit_task_for_review(uuid, text, text, numeric) to authenticated;

drop function if exists public.confirm_task(uuid, text);
drop function if exists public.confirm_task(uuid, text, text);

create or replace function public.confirm_task(
  p_task    uuid,
  p_quality text,
  p_note    text    default null,
  p_hours   numeric default null
)
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

  if p_hours is not null and (p_hours < 0 or p_hours > 999) then
    raise exception 'Hours must be between 0 and 999' using errcode = '23514';
  end if;

  perform set_config('app.task_workflow', 'on', true);

  update tasks
     set confirmed_at = now(),
         confirmed_by = v_me,
         review_note  = nullif(btrim(coalesce(p_note, '')), ''),
         hours        = coalesce(p_hours, hours)
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

grant execute on function public.confirm_task(uuid, text, text, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- task_kpi carries hours (0058's shape, one column appended at the end —
-- `create or replace view` may add trailing columns but not reorder them).
-- -----------------------------------------------------------------------------

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
  app.quality_score(s.quality) as quality_score,
  d.completion_score,
  case
    when s.quality is null or d.completion_score is null then null
    else (app.quality_score(s.quality) + d.completion_score)::numeric / 2
  end as overall_score,
  (t.confirmed_at is not null or t.not_done_at is not null) as counts_toward_kpi,
  d.is_delayed,
  app.can_claim_task(t.id) as can_claim,
  app.can_confirm_task(t.id) as can_confirm,
  app.can_administer_task(t.id) as can_administer,
  t.source_request_id,
  t.submission_url,
  coalesce(
    (select rt.task_requires_link
       from requests r
       join request_types rt on rt.id = r.request_type_id
      where r.id = t.source_request_id),
    false
  ) as requires_link,
  t.description,
  t.submission_note,
  t.review_note,
  t.created_by,
  t.hours
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
      when b.days_remaining <  0            then 'overdue'
      when b.days_remaining <= 2            then 'high'
      when b.days_remaining <= 5            then 'medium'
      else 'low'
    end::task_risk as risk,
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
    c.risk in ('medium', 'high', 'overdue') as is_delayed
) d;

-- -----------------------------------------------------------------------------
-- The month as a unit: what each person finished, and how long it took.
-- -----------------------------------------------------------------------------

create or replace view public.member_month_kpi
with (security_invoker = on) as
select
  k.assignee_id as member_id,
  to_char(coalesce(k.submitted_at, k.not_done_at) at time zone 'Asia/Riyadh', 'YYYY-MM') as month,
  count(*)                                                          as tasks,
  count(*) filter (where k.state = 'completed')                     as completed_tasks,
  count(*) filter (where k.state = 'not_done')                      as not_done_tasks,
  count(*) filter (where k.state = 'pending_confirmation')          as pending_tasks,
  coalesce(sum(k.hours), 0)                                         as hours,
  round(avg(k.overall_score) filter (where k.counts_toward_kpi), 1) as performance
from public.task_kpi k
where k.assignee_id is not null
  and coalesce(k.submitted_at, k.not_done_at) is not null
  and app.can_view_kpi_for_member(k.assignee_id)
group by k.assignee_id, 2;

comment on view public.member_month_kpi is
  'Per member per month (Asia/Riyadh, by the date the work was submitted or marked Not Done): tasks, completed, not done, still pending, hours, and the average Overall score. §8 self-exclusion applies through can_view_kpi_for_member.';

grant select on public.task_kpi to authenticated;
grant select on public.member_month_kpi to authenticated;

notify pgrst, 'reload schema';
