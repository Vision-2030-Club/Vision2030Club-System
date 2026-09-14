-- =============================================================================
-- 0060 — A Project Manager sees their projects' tasks, not the club's.
--
-- `tasks.view` for project_manager was seeded as `all` (0004), the same as
-- for Directors until 0057 narrowed them to their team. Now `own_projects`:
-- the tasks of projects they manage, plus anything they are personally on
-- (tasks_select already ORs is_on_project / is_on_split / is_task_assignee).
-- What they may DO was already that narrow; only what they could see was
-- wider.
-- =============================================================================

update role_permissions rp
   set scope = 'own_projects'
  from roles r
 where r.id = rp.role_id
   and r.key = 'project_manager'
   and rp.permission_key = 'tasks.view';
