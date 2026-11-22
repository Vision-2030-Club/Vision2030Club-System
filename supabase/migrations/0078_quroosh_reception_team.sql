-- =============================================================================
-- 0078 — Quroosh: HR's Directors come in, and a reception team.
--
-- Two things the club asked for on 2026-11-22, both as Mock Interviews
-- already works (0062, 0069):
--
--   hr          whoever holds members.manage at scope all (HR's Directors,
--               by 0004's override) may open a project's Quroosh without
--               being on the project. They get its first page, Reception,
--               and the reception team's list. Nothing of the managers':
--               not the applications, the guests, the accounts, the wallet
--               or the challenges.
--
--   reception   members listed in `project_component_people` with the role
--               'reception'. They may open Quroosh for the Reception page,
--               and they work the gate of the same project's Event
--               attendance (0075) as a 'scanner': the scanner, finding an
--               attendee, checking in and undoing it. Until now the gate
--               was the managers' and the HR team's only; both keep it.
--
-- Who chooses the receptionists is already decided by 0069's policy on
-- `project_component_people`, and this file does not touch it: whoever
-- manages the project, or whoever holds members.manage. The list is the
-- project's, not a component's (the table has no component column): a
-- project that carried Mock Interviews as well would share one reception
-- list between the two.
--
-- A person's strongest role still wins. In Quroosh: manager, then member and
-- viewer (0074), then hr, then reception. At the gate: manager, then scanner.
--
-- Two functions are replaced, each from its latest version: 0075's
-- `app.event_attendance_role` and 0075's `my_component_access()`. No table
-- changes, nothing deleted. Safe to re-run.
-- =============================================================================

-- Listed as a receptionist of this project, and still an active member.
create or replace function app.is_receptionist(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from project_component_people x
    join members m on m.id = x.member_id
    where x.project_id = p_project
      and x.role = 'reception'
      and m.auth_user_id = auth.uid()
      and m.status = 'active'
  )
$$;

-- 0075's, with the last branch added: the receptionists work the gate too.
create or replace function app.event_attendance_role(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_project is null or not app.is_signed_in() then null
    when not exists (select 1 from project_components pc
                      where pc.project_id = p_project
                        and pc.component_key = 'event_attendance') then null
    when app.can_manage_project(p_project) then 'manager'
    when app.is_on_team('HR') then 'scanner'
    when app.is_receptionist(p_project) then 'scanner'
  end
$$;

-- 0075's, with Quroosh's hr and reception branches, and the receptionists
-- at the Event attendance gate.
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
        -- 0078 Quroosh: HR's Directors, then the reception team.
        when pc.component_key = 'quroosh' and app.effective_scope('members.manage') = 'all'
          then 'hr'
        when pc.component_key = 'quroosh' and app.is_receptionist(pc.project_id)
          then 'reception'
        -- 0075 Event attendance: the HR team works the gate; 0078: and the
        -- project's receptionists.
        when pc.component_key = 'event_attendance'
         and (app.is_on_team('HR') or app.is_receptionist(pc.project_id))
          then 'scanner'
      end as role
    from project_components pc
    join projects p on p.id = pc.project_id
    where app.is_signed_in()
  )
  select * from mine where role is not null
  order by name_en
$$;

-- As 0075 grants its own helpers.
grant execute on function app.is_receptionist(uuid) to anon, authenticated, service_role;
grant execute on function app.event_attendance_role(uuid) to anon, authenticated, service_role;
grant execute on function public.my_component_access() to authenticated;

notify pgrst, 'reload schema';
