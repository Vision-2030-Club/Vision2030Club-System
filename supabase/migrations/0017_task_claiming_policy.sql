-- =============================================================================
-- 0017 — Let a member actually claim an unclaimed task (§3).
--
-- task_assignees_write (0005) gates every assignment behind tasks.manage. That
-- is right for a PM assigning someone, but it makes §3's self-service claiming
-- impossible: a Member holds tasks.manage = 'assigned', and on an unclaimed
-- task they are not yet the assignee, so the check can never pass. claim_task()
-- failed with "new row violates row-level security policy".
--
-- The fix is a second, narrow INSERT policy. Permissive policies OR together,
-- so this adds one specific route without loosening the existing one: you may
-- insert an assignment naming YOURSELF, on a project task that nobody has
-- claimed, whose scope you are inside.
-- =============================================================================

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

  -- §3 is about project tasks. Team-internal work is assigned, not claimed.
  if v_task.project_id is null then
    return false;
  end if;

  -- "An UNCLAIMED task is posted…"
  if exists (select 1 from task_assignees ta where ta.task_id = p_task) then
    return false;
  end if;

  -- Posted to one specific split, or to the whole project.
  if v_task.split_id is not null then
    return app.is_on_split(v_task.split_id);
  end if;

  return app.is_on_project(v_task.project_id);
end;
$$;

create policy task_assignees_claim on task_assignees
  for insert
  with check (
    member_id = (select app.current_member_id())
    and (select app.can_claim_task(task_id))
  );

grant execute on function app.can_claim_task(uuid) to anon, authenticated, service_role;
