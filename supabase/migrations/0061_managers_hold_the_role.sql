-- =============================================================================
-- 0061 — A project's managers hold the Project Manager role.
--
-- `project_managers` (and the split PMs under it) took any member. The
-- role is what gives a person the `own_projects` scopes — tasks, requests,
-- rooms, the calendar — so a Member made "manager" of a project could see
-- it but do nothing for it. Now the row is refused unless the person's role
-- is project_manager; the add-manager list offers only those people, and
-- this is the rule behind it.
-- =============================================================================

create or replace function app.enforce_manager_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from members m
    join roles r on r.id = m.role_id
    where m.id = new.member_id
      and r.key = 'project_manager'
  ) then
    raise exception 'Only a person holding the Project Manager role can manage a project'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists project_managers_require_role on project_managers;
create trigger project_managers_require_role
  before insert on project_managers
  for each row execute function app.enforce_manager_role();

drop trigger if exists project_split_managers_require_role on project_split_managers;
create trigger project_split_managers_require_role
  before insert on project_split_managers
  for each row execute function app.enforce_manager_role();
