-- =============================================================================
-- 0074 — Quroosh (قروش): a project component of its own.
--
-- The Quroosh project (renamed from Shark Tank in 0073) gets its own section
-- in the system, wearing its own identity, like Mock Interviews does. This
-- migration only lets a project carry it and says who may open it; the
-- component's own tables come with its first real screens.
--
-- Who may open it, until the club decides otherwise (the Outreach rule,
-- 0065):
--   manager  whoever holds projects.manage over the project
--   member   on the project
--   viewer   may see the project's KPI
--
-- The function below is 0072's, unchanged except for the two Quroosh lines.
-- Nothing is deleted. Safe to re-run: the constraint is dropped and re-added,
-- the function replaced.
-- =============================================================================

alter table project_components
  drop constraint if exists project_components_component_key_check;
alter table project_components
  add constraint project_components_component_key_check
  check (component_key in ('mock_interviews', 'outreach', 'quroosh'));

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
        -- 0072: the Development team reads the visitor ratings.
        when pc.component_key = 'mock_interviews'
         and exists (select 1 from members m join teams t on t.id = m.team_id
                      where m.id = app.current_member_id()
                        and t.key = 'DEVELOPMENT')
          then 'viewer'
        -- Outreach: everyone on the project works it; KPI viewers read it.
        when pc.component_key = 'outreach' and app.is_on_project(pc.project_id)
          then 'member'
        when pc.component_key = 'outreach' and app.can_view_kpi_for_project(pc.project_id)
          then 'viewer'
        -- 0074 Quroosh: the same as Outreach until its own roles are decided.
        when pc.component_key = 'quroosh' and app.is_on_project(pc.project_id)
          then 'member'
        when pc.component_key = 'quroosh' and app.can_view_kpi_for_project(pc.project_id)
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
