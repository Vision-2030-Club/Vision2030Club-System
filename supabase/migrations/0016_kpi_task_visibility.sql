-- =============================================================================
-- 0016 — kpi.view has to reach the tasks it reports on.
--
-- 0012 gave Development club-wide kpi.view, but every KPI view reads through
-- `tasks` with security_invoker on, and a Development *Member* only holds
-- tasks.view = 'own_team'. The aggregates therefore came back empty: the
-- permission granted the numbers but not the rows they are computed from.
--
-- §9 settles which way to fix it — the dashboard must offer "Lists/tables —
-- the underlying rows (tasks, per-member %Performance, per-project health)".
-- Seeing the task rows is part of the feature, so kpi.view widens tasks_select.
--
-- This does NOT leak anyone's own KPI back to them: §8 is enforced on the
-- grade (task_scores' policy) and on the aggregates (member_kpi), not on the
-- existence of a task. A Development member reading their own task row still
-- gets null for quality_score and overall_score.
-- =============================================================================

-- Takes the row's columns rather than an id so the function never has to read
-- `tasks` from inside `tasks`'s own policy.
create or replace function app.can_view_kpi_for_task(
  p_project uuid,
  p_split   uuid,
  p_team    uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope permission_scope;
begin
  if app.current_member_id() is null then
    return false;
  end if;

  v_scope := app.effective_scope('kpi.view');

  if v_scope = 'none' then return false; end if;
  if v_scope = 'all'  then return true;  end if;

  if p_project is not null then
    return app.can_view_kpi_for_project(p_project)
        or app.is_split_manager(p_split);
  end if;

  -- A team-internal task, for a Director whose kpi.view was scoped to their
  -- own team (§8).
  if v_scope = 'own_team' then
    return p_team = app.current_team_id();
  end if;

  return false;
end;
$$;

drop policy if exists tasks_select on tasks;

create policy tasks_select on tasks
  for select using (
    (select app.can('tasks.view', p_team => team_id, p_project => project_id))
    or (select app.is_on_project(project_id))
    or (select app.is_on_split(split_id))
    or (select app.is_task_assignee(id))
    or (select app.can_view_kpi_for_task(project_id, split_id, team_id))
  );

grant execute on function app.can_view_kpi_for_task(uuid, uuid, uuid)
  to anon, authenticated, service_role;
