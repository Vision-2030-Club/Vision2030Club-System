-- =============================================================================
-- 0018 — kpi.view has to reach projects and splits too.
--
-- The same gap 0016 closed for `tasks`, one level up. project_kpi and
-- project_split_kpi are security_invoker views selecting from `projects` and
-- `project_splits`, so a Development Member — who holds projects.view =
-- 'own_team' and is not staffed on anything — matched no rows and got an empty
-- dashboard even with kpi.view = 'all'.
--
-- §9 requires per-project health and a per-split breakdown in that dashboard,
-- so the rows have to be reachable. Both policies below are widened by exactly
-- one OR-ed clause and are otherwise the 0005/0012 originals.
-- =============================================================================

drop policy if exists projects_select on projects;

create policy projects_select on projects
  for select using (
    (select app.can('projects.view', p_team => owning_team_id, p_project => id))
    or (select app.is_on_project(id))
    or (select app.can_view_kpi_for_project(id))
  );

drop policy if exists project_splits_select on project_splits;

create policy project_splits_select on project_splits
  for select using (
    (select app.can('projects.view', p_project => project_id))
    or (select app.is_on_project(project_id))
    or (select app.can_view_kpi_for_project(project_id))
  );

-- project_member_kpi resolves names through `members`, which every signed-in
-- role can already read (0003), so nothing is needed there.
