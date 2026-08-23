-- =============================================================================
-- 0019 — One falling-behind flag per member per project.
--
-- 0012 grouped project_member_kpi by (project, member, split). That splits one
-- person into several rows — one per split plus one for their project-wide
-- work — so §6's "a falling-behind flag at the level of a specific Member"
-- came out fragmented: the same person could read On Track and At Risk at once
-- with no single answer for the project.
--
-- The split dimension is not lost; project_split_kpi already reports it, and
-- task_kpi still carries split_id, which is what §9 needs for the deferred
-- per-split/per-PM breakdown to be built later without a redesign.
-- =============================================================================

-- `create or replace view` cannot drop a column, so the old shape goes first.
drop view if exists public.project_member_kpi;

create view public.project_member_kpi
with (security_invoker = on) as
select
  k.project_id,
  k.assignee_id as member_id,
  count(*)                                                          as total_tasks,
  count(*) filter (where k.counts_toward_kpi)                       as scored_tasks,
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
group by k.project_id, k.assignee_id;

grant select on public.project_member_kpi to authenticated;
