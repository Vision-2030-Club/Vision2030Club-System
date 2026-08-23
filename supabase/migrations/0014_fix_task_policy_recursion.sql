-- =============================================================================
-- 0014 — Break the RLS recursion between tasks and task_assignees.
--
-- Exactly the same shape of bug 0011 fixed for the calendar, latent in 0005
-- since it was written:
--
--   tasks_select           -> EXISTS (… task_assignees …)
--   task_assignees_select  -> EXISTS (… tasks …)
--
-- Postgres evaluates the second while evaluating the first and raises
--   42P17: infinite recursion detected in policy for relation "tasks"
-- so EVERY read of `tasks` fails for a normal signed-in user. It went unnoticed
-- because the table was empty until now and the tasks page ignores the error,
-- rendering "no tasks" instead of surfacing it.
--
-- The fix is the 0011 one: reach task_assignees through a SECURITY DEFINER
-- function, which runs as the table owner so RLS does not re-enter. Visibility
-- is unchanged — the function applies exactly the test the inline EXISTS did.
-- =============================================================================

create or replace function app.is_task_assignee(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from task_assignees ta
    where ta.task_id = p_task
      and ta.member_id = app.current_member_id()
  )
$$;

drop policy if exists tasks_select on tasks;

create policy tasks_select on tasks
  for select using (
    (select app.can('tasks.view', p_team => team_id, p_project => project_id))
    or (select app.is_on_project(project_id))
    or (select app.is_on_split(split_id))
    or (select app.is_task_assignee(id))
  );

drop policy if exists tasks_write on tasks;

create policy tasks_write on tasks
  for all
  using (
    (select app.can(
      'tasks.manage',
      p_team     => team_id,
      p_project  => project_id,
      p_owner    => created_by,
      p_assigned => (select app.is_task_assignee(id))
    ))
  )
  with check (
    (select app.can(
      'tasks.manage',
      p_team     => team_id,
      p_project  => project_id,
      p_owner    => created_by,
      p_assigned => (select app.is_task_assignee(id))
    ))
  );

grant execute on function app.is_task_assignee(uuid) to anon, authenticated, service_role;
