-- =============================================================================
-- 0013 — Seed the KPI module's access configuration (addendum §8).
--
-- Configuration, not code — same as 0004. Every row below can be changed later
-- with a plain UPDATE or from the admin screens, and takes effect immediately.
-- Re-running this file is safe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The Development team.
--
-- The club has no Development team in 0004's list, and this module is that
-- team's first customisation, so the team itself is part of the addendum.
-- -----------------------------------------------------------------------------
insert into teams (key, name_en, name_ar) values
  ('DEVELOPMENT', 'Development', 'التطوير')
on conflict (key) do update
  set name_en = excluded.name_en,
      name_ar = excluded.name_ar;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  -- §8: View KPI is its OWN permission. It is deliberately not folded into
  -- members.view or tasks.view — holding either of those grants no KPI access.
  ('kpi.view',
   'See other people''s KPI figures',
   'الاطلاع على مؤشرات أداء الآخرين'),
  -- §2: confirming or rejecting submitted work, and marking a task Not Done.
  -- Separate from tasks.manage because creating a task and grading it are
  -- different powers.
  ('tasks.confirm',
   'Confirm, reject, or mark Not Done the tasks you are responsible for',
   'اعتماد المهام أو رفضها أو تعليمها غير منجزة')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

-- Same rule as 0004: every (role, permission) pair starts denied, then we
-- grant explicitly. A role nobody mentions below keeps 'none'.
insert into role_permissions (role_id, permission_key, scope)
select r.id, p.key, 'none'::permission_scope
from roles r
cross join permissions p
where p.key in ('kpi.view', 'tasks.confirm')
on conflict (role_id, permission_key) do nothing;

update role_permissions rp
set scope = grants.scope::permission_scope
from (values
  -- §8 default holders, part one: Presidency (President + VP). Super Admin
  -- carries everything, as in 0004.
  ('super_admin',    'kpi.view',      'all'),
  ('president',      'kpi.view',      'all'),
  ('vice_president', 'kpi.view',      'all'),

  -- §8: "Assignable later to other roles (Team Directors, Project Managers)."
  -- Left denied at baseline on purpose — granting it is an admin decision, and
  -- the scopes below are what it should be set to when that happens.
  ('team_director',   'kpi.view',     'none'),
  ('project_manager', 'kpi.view',     'none'),
  ('member',          'kpi.view',     'none'),
  ('guest',           'kpi.view',     'none'),

  -- §2's confirmers. A Director confirms their own team's work; a PM confirms
  -- the projects (and splits) they run; leadership can act anywhere.
  ('super_admin',     'tasks.confirm', 'all'),
  ('president',       'tasks.confirm', 'all'),
  ('vice_president',  'tasks.confirm', 'all'),
  ('team_director',   'tasks.confirm', 'own_team'),
  ('project_manager', 'tasks.confirm', 'own_projects'),
  -- §2: the assignee never confirms. Members hold nothing here.
  ('member',          'tasks.confirm', 'none'),
  ('guest',           'tasks.confirm', 'none')
) as grants (role_key, permission_key, scope)
where rp.role_id = (select id from roles where key = grants.role_key)
  and rp.permission_key = grants.permission_key;

-- -----------------------------------------------------------------------------
-- §8 default holders, part two: every Development team member.
--
-- "Every member of team X" is expressed the same data-driven way as HR's
-- member management in 0004 — a team override per role that exists inside that
-- team. Nothing in the code knows the word "Development"; deleting these three
-- rows removes the whole team's KPI access.
--
-- The scope is 'all' rather than 'own_team' on purpose: Development's job here
-- is club-wide KPI reporting, not reporting on themselves. (§8's "scoped to
-- their own team/project" applies to Directors and PMs who are granted the
-- permission later, which is what the 'none' baselines above are waiting for.)
-- -----------------------------------------------------------------------------
insert into role_permission_team_overrides (role_id, permission_key, team_id, scope)
select
  (select id from roles where key = o.role_key),
  o.permission_key,
  (select id from teams where key = o.team_key),
  o.scope::permission_scope
from (values
  ('member',          'kpi.view', 'DEVELOPMENT', 'all'),
  ('team_director',   'kpi.view', 'DEVELOPMENT', 'all'),
  ('project_manager', 'kpi.view', 'DEVELOPMENT', 'all')
) as o (role_key, permission_key, team_key, scope)
on conflict (role_id, permission_key, team_id) do update
  set scope = excluded.scope;
