-- =============================================================================
-- 0069 — Mock Interviews: receptionists.
--
-- The event needs people at the door who check students in and nothing else.
-- They are a third list next to 0062's organizers and HR people:
--
--   reception   chosen by whoever manages the project (its PMs, the
--               Presidency, the Super Admin) OR by whoever holds
--               members.manage (HR's Directors, by 0004's override). Either
--               side may add or remove them.
--
-- my_component_access() answers 'reception' for them. The strongest role
-- still wins (manager > hr > organizer > reception), so somebody listed as
-- both an organizer and a receptionist acts as an organizer. What a
-- receptionist may do is decided by the app (src/lib/interviews/access.ts):
-- the Reception tab, checking a student in and undoing it.
--
-- Nothing is deleted. Safe to re-run: the constraint and the policy are
-- dropped and made again, the function is replaced.
-- =============================================================================

alter table project_component_people drop constraint if exists project_component_people_role_check;
alter table project_component_people
  add constraint project_component_people_role_check
  check (role in ('organizer', 'hr', 'reception'));

-- 0062's policy, with the reception line added.
drop policy if exists project_component_people_write on project_component_people;
create policy project_component_people_write on project_component_people
  for all
  using (
    (role = 'organizer' and (select app.can_manage_project(project_id)))
    or (role = 'hr' and (select app.can('members.manage')))
    or (role = 'reception' and ((select app.can_manage_project(project_id))
                                or (select app.can('members.manage'))))
  )
  with check (
    (role = 'organizer' and (select app.can_manage_project(project_id)))
    or (role = 'hr' and (select app.can('members.manage')))
    or (role = 'reception' and ((select app.can_manage_project(project_id))
                                or (select app.can('members.manage'))))
  );

-- 0065's function, with the reception branch after the organizer's.
create or replace function public.my_component_access()
returns table (
  project_id     uuid,
  name_en        text,
  name_ar        text,
  component_key  text,
  external_ref   text,
  role           text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select
      pc.project_id, p.name_en, p.name_ar, pc.component_key, pc.external_ref,
      case
        when app.can('projects.manage', p_team => p.owning_team_id, p_project => p.id)
          then 'manager'
        -- Mock Interviews: HR and organizers, as 0062 defined them.
        when pc.component_key = 'mock_interviews'
         and (app.effective_scope('members.manage') = 'all'
              or exists (select 1 from project_component_people x
                          where x.project_id = pc.project_id
                            and x.member_id = app.current_member_id()
                            and x.role = 'hr'))
          then 'hr'
        when pc.component_key = 'mock_interviews'
         and exists (select 1 from project_component_people x
                      where x.project_id = pc.project_id
                        and x.member_id = app.current_member_id()
                        and x.role = 'organizer')
          then 'organizer'
        -- 0069: receptionists.
        when pc.component_key = 'mock_interviews'
         and exists (select 1 from project_component_people x
                      where x.project_id = pc.project_id
                        and x.member_id = app.current_member_id()
                        and x.role = 'reception')
          then 'reception'
        -- Outreach: everyone on the project works it; KPI viewers read it.
        when pc.component_key = 'outreach' and app.is_on_project(pc.project_id)
          then 'member'
        when pc.component_key = 'outreach' and app.can_view_kpi_for_project(pc.project_id)
          then 'viewer'
      end as role
    from project_components pc
    join projects p on p.id = pc.project_id
    where app.is_signed_in()
  )
  select * from mine where role is not null
  order by name_en
$$;

grant execute on function public.my_component_access() to authenticated;

notify pgrst, 'reload schema';
