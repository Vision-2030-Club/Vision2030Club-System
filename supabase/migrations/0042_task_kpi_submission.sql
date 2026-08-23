-- =============================================================================
-- 0042 — The task card needs to know it is delivered as a link.
--
-- `task_kpi` is what every task screen reads; if the link is not on it, the
-- card would have to make its own query per task to find out. Three columns:
-- where the work is, which request it came from, and whether a link is
-- expected at all.
--
-- Appended at the END of the select list on purpose — CREATE OR REPLACE VIEW
-- can add columns but not reorder or remove them, and member_kpi, project_kpi
-- and the two split views all read this one.
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
  app.quality_score(s.quality) as quality_score,
  d.completion_score,
  case
    when s.quality is null or d.completion_score is null then null
    else (app.quality_score(s.quality) + d.completion_score)::numeric / 2
  end as overall_score,
  (t.confirmed_at is not null or t.not_done_at is not null) as counts_toward_kpi,
  d.is_delayed,

  -- §3: an unclaimed task in a scope the caller belongs to.
  app.can_claim_task(t.id) as can_claim,
  -- §2: may confirm, reject, or mark Not Done. False on your own work.
  app.can_confirm_task(t.id) as can_confirm,
  -- §7: may delete. Same authority, without the self-exclusion.
  app.can_administer_task(t.id) as can_administer,
  -- Where the finished work is, and whether one is expected (0038). The card
  -- needs both: a task delivered as a link must ask for one when it is
  -- submitted, and show it afterwards.
  t.source_request_id,
  t.submission_url,
  coalesce(
    (select rt.task_requires_link
       from requests r
       join request_types rt on rt.id = r.request_type_id
      where r.id = t.source_request_id),
    false
  ) as requires_link
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

grant select on public.task_kpi to authenticated;
