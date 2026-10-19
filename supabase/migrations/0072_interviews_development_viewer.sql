-- =============================================================================
-- 0072 — Mock Interviews: the Development team reads the visitor ratings.
--
-- The club decided (2026-10-19) that the Development team (teams.key =
-- 'DEVELOPMENT', التطوير) sees how visitors rated the event. They get the
-- role 'viewer' on every Mock Interviews project; the app shows a viewer only
-- the Visitor feedback tab (results, no names) and refuses every other page
-- and data feed (src/lib/interviews/access.ts, can.visitorResults).
--
-- The strongest role still wins (manager > hr > organizer > reception >
-- viewer): a Development member who is also an organizer acts as one.
--
-- Nothing is deleted. Safe to re-run: the function is replaced.
-- =============================================================================

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
