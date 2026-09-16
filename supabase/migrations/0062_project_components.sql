-- =============================================================================
-- 0062 — Project components.
--
-- A club project can carry one COMPONENT: a self-contained system built into
-- the app whose data lives elsewhere. The first is Mock Interviews, whose
-- editions live in a separate Supabase project so that data can never be lost
-- with, or by, this one.
--
-- This file holds the club-side half only:
--
--   project_components         which project carries which component, and the
--                              id of its record in the other database
--   project_component_people   who else may enter it — organizers chosen by
--                              whoever manages the project, and HR people
--                              chosen by whoever manages members
--   my_component_access()      the one question the app asks: which
--                              components may I open, and as what
--
-- No role name appears here. "Manager" is whoever holds projects.manage over
-- the project (its PMs through own_projects; the Presidency and Super Admin
-- through all). "HR" is whoever holds members.manage at scope all — which
-- 0004 gives to HR's Directors by team override — plus anyone they add.
-- =============================================================================

create table project_components (
  project_id     uuid primary key references projects (id) on delete cascade,
  component_key  text not null check (component_key in ('mock_interviews')),
  -- The component's own record in its own database (an edition id).
  external_ref   text,
  attached_by    uuid references members (id),
  attached_at    timestamptz not null default now()
);

create table project_component_people (
  project_id  uuid not null references projects (id) on delete cascade,
  member_id   uuid not null references members (id) on delete cascade,
  role        text not null check (role in ('organizer', 'hr')),
  added_by    uuid references members (id),
  added_at    timestamptz not null default now(),
  primary key (project_id, member_id, role)
);

create index project_component_people_member_idx on project_component_people (member_id);

-- "May I manage this project?" as a definer function, so the policies below
-- can read `projects` without going through its own policy (0011's lesson).
create or replace function app.can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select app.can('projects.manage', p_team => p.owning_team_id, p_project => p.id)
     from projects p where p.id = p_project),
    false)
$$;

alter table project_components        enable row level security;
alter table project_component_people  enable row level security;

-- Everyone signed in may see which projects carry a component: the sidebar
-- needs it, and the roster is names, not secrets.
create policy project_components_select on project_components
  for select using ((select app.is_signed_in()));

create policy project_components_write on project_components
  for all
  using ((select app.can_manage_project(project_id)))
  with check ((select app.can_manage_project(project_id)));

create policy project_component_people_select on project_component_people
  for select using ((select app.is_signed_in()));

-- Organizers are the project's to choose; HR people are HR's to choose.
create policy project_component_people_write on project_component_people
  for all
  using (
    (role = 'organizer' and (select app.can_manage_project(project_id)))
    or (role = 'hr' and (select app.can('members.manage')))
  )
  with check (
    (role = 'organizer' and (select app.can_manage_project(project_id)))
    or (role = 'hr' and (select app.can('members.manage')))
  );

-- Which components may the caller open, and as what. The strongest role wins:
-- a PM who was also listed as an organizer is a manager.
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
        when app.effective_scope('members.manage') = 'all'
          or exists (select 1 from project_component_people x
                      where x.project_id = pc.project_id
                        and x.member_id = app.current_member_id()
                        and x.role = 'hr')
          then 'hr'
        when exists (select 1 from project_component_people x
                      where x.project_id = pc.project_id
                        and x.member_id = app.current_member_id()
                        and x.role = 'organizer')
          then 'organizer'
      end as role
    from project_components pc
    join projects p on p.id = pc.project_id
    where app.is_signed_in()
  )
  select * from mine where role is not null
  order by name_en
$$;

grant execute on function public.my_component_access() to authenticated;

grant select, insert, update, delete on project_components, project_component_people to authenticated;

-- The blanket grant elsewhere re-grants DELETE on task_scores; nothing here
-- does, so no revoke is needed. Kept as a reminder for the next file that
-- copies the `grant … on all tables` line.

notify pgrst, 'reload schema';
