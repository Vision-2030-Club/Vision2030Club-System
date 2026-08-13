-- =============================================================================
-- 0005 — Projects, tasks, and team posts (spec §1, §7).
--
-- Projects are owned by one team but staffed from any team; tasks can have
-- several owners; team posts stay inside their team.
-- =============================================================================

create type project_status as enum ('planned', 'active', 'completed', 'cancelled');
create type task_status    as enum ('todo', 'in_progress', 'blocked', 'done', 'cancelled');

create table projects (
  id              uuid primary key default gen_random_uuid(),
  name_en         text not null,
  name_ar         text not null,
  description     text,
  owning_team_id  uuid not null references teams (id),
  status          project_status not null default 'active',
  starts_on       date,
  ends_on         date,
  created_by      uuid references members (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Staffing is independent of a person's home team (spec §1).
create table project_members (
  project_id  uuid not null references projects (id) on delete cascade,
  member_id   uuid not null references members (id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (project_id, member_id)
);

-- Up to four Project Managers, and any one of them may act for the project.
create table project_managers (
  project_id  uuid not null references projects (id) on delete cascade,
  member_id   uuid not null references members (id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (project_id, member_id)
);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,

  -- A task belongs to a project OR stands alone at team level — never both,
  -- never neither.
  project_id   uuid references projects (id) on delete cascade,
  team_id      uuid references teams (id),

  status       task_status not null default 'todo',
  due_date     date,
  created_by   uuid references members (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint tasks_one_home check (
    (project_id is not null and team_id is null)
    or (project_id is null and team_id is not null)
  )
);

create index tasks_project_id_idx on tasks (project_id);
create index tasks_team_id_idx    on tasks (team_id);

-- Multiple owners per task (spec §1).
create table task_assignees (
  task_id    uuid not null references tasks (id) on delete cascade,
  member_id  uuid not null references members (id) on delete cascade,
  primary key (task_id, member_id)
);

create table team_posts (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams (id) on delete cascade,
  author_id   uuid references members (id),
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index team_posts_team_id_idx on team_posts (team_id, created_at desc);

create trigger projects_touch_updated_at
  before update on projects
  for each row execute function app.touch_updated_at();

create trigger tasks_touch_updated_at
  before update on tasks
  for each row execute function app.touch_updated_at();

create trigger team_posts_touch_updated_at
  before update on team_posts
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- "Up to 4 Project Managers" (spec §1)
-- -----------------------------------------------------------------------------

create or replace function app.enforce_max_project_managers()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  -- Lock the project row so two concurrent inserts can't both see 3 managers.
  perform 1 from projects where id = new.project_id for update;

  select count(*) into v_count
  from project_managers
  where project_id = new.project_id;

  if v_count >= 4 then
    raise exception 'A project can have at most 4 Project Managers'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger project_managers_max_four
  before insert on project_managers
  for each row execute function app.enforce_max_project_managers();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table projects         enable row level security;
alter table project_members  enable row level security;
alter table project_managers enable row level security;
alter table tasks            enable row level security;
alter table task_assignees   enable row level security;
alter table team_posts       enable row level security;

-- Projects -------------------------------------------------------------------
-- `app.can` covers the role side; `app.is_on_project` covers "I'm staffed on
-- this one", which is a fact about the row rather than about any role.

create policy projects_select on projects
  for select using (
    (select app.can('projects.view', p_team => owning_team_id, p_project => id))
    or (select app.is_on_project(id))
  );

create policy projects_write on projects
  for all
  using (
    (select app.can('projects.manage', p_team => owning_team_id, p_project => id))
  )
  with check (
    (select app.can('projects.manage', p_team => owning_team_id, p_project => id))
  );

create policy project_members_select on project_members
  for select using (
    (select app.can('projects.view', p_project => project_id))
    or (select app.is_on_project(project_id))
  );

create policy project_members_write on project_members
  for all
  using ((select app.can('projects.manage', p_project => project_id)))
  with check ((select app.can('projects.manage', p_project => project_id)));

create policy project_managers_select on project_managers
  for select using ((select app.is_signed_in()));

-- Note the permission used here: appointing a Project Manager is a projects
-- change, but it also decides who can act for the project, so it is limited to
-- whoever may configure roles or manage the project.
create policy project_managers_write on project_managers
  for all
  using (
    (select app.can('projects.manage', p_project => project_id))
    or (select app.can('roles.configure'))
  )
  with check (
    (select app.can('projects.manage', p_project => project_id))
    or (select app.can('roles.configure'))
  );

-- Tasks ----------------------------------------------------------------------

create policy tasks_select on tasks
  for select using (
    (select app.can('tasks.view', p_team => team_id, p_project => project_id))
    or (select app.is_on_project(project_id))
    or exists (
      select 1 from task_assignees ta
      where ta.task_id = tasks.id
        and ta.member_id = (select app.current_member_id())
    )
  );

create policy tasks_write on tasks
  for all
  using (
    (select app.can(
      'tasks.manage',
      p_team     => team_id,
      p_project  => project_id,
      p_owner    => created_by,
      p_assigned => exists (
        select 1 from task_assignees ta
        where ta.task_id = tasks.id
          and ta.member_id = (select app.current_member_id())
      )
    ))
  )
  with check (
    (select app.can(
      'tasks.manage',
      p_team     => team_id,
      p_project  => project_id,
      p_owner    => created_by,
      p_assigned => exists (
        select 1 from task_assignees ta
        where ta.task_id = tasks.id
          and ta.member_id = (select app.current_member_id())
      )
    ))
  );

create policy task_assignees_select on task_assignees
  for select using (
    exists (select 1 from tasks t where t.id = task_assignees.task_id)
  );

create policy task_assignees_write on task_assignees
  for all
  using (
    exists (
      select 1 from tasks t
      where t.id = task_assignees.task_id
        and (select app.can('tasks.manage', p_team => t.team_id,
                            p_project => t.project_id, p_owner => t.created_by))
    )
  )
  with check (
    exists (
      select 1 from tasks t
      where t.id = task_assignees.task_id
        and (select app.can('tasks.manage', p_team => t.team_id,
                            p_project => t.project_id, p_owner => t.created_by))
    )
  );

-- Team posts (spec §7) -------------------------------------------------------
-- Visible only inside the team, plus leadership (whose scope is 'all').

create policy team_posts_select on team_posts
  for select using ((select app.can('team_posts.view', p_team => team_id)));

create policy team_posts_write on team_posts
  for all
  using ((select app.can('team_posts.manage', p_team => team_id)))
  with check ((select app.can('team_posts.manage', p_team => team_id)));

grant select, insert, update, delete on all tables in schema public to authenticated;
