-- =============================================================================
-- 0048 — Limit the member directory PAGE to the Presidency and HR's Directors.
--
-- WHY THIS IS A NEW PERMISSION AND NOT A CHANGE TO members.view
--
-- The obvious move was to take `members.view` away from everyone else. That
-- would have been wrong, and quietly so. `members.view` decides who can READ A
-- MEMBER ROW, and much of the app is built on top of it:
--
--   * the assignee dropdown on /tasks
--   * the people picker when staffing a project split
--   * choosing the person an individual meeting request is aimed at
--   * every team roster
--   * the audience picker on a calendar entry
--
-- All of those are plain selects against `members`, filtered by the
-- `members_select` policy in 0003. Revoking `members.view` would have left a
-- Team Director staring at a dropdown containing only their own name, unable
-- to give anybody work — the club would have stopped, not tightened.
--
-- So the directory screen gets its own, narrower permission, and `members.view`
-- is left exactly as it was.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
--
-- This is an organisational control: the directory stops being a screen the
-- whole club browses. It is NOT a privacy boundary — the same names are still
-- reachable through the pickers listed above, by design, because that is what
-- makes the app work.
--
-- The real boundary already exists and is untouched: `members.view_sensitive`
-- guards national IDs, and has always been the Presidency and HR alone.
-- =============================================================================

insert into permissions (key, description_en, description_ar) values
  ('members.directory',
   'Open the member directory page',
   'فتح صفحة دليل الأعضاء')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

-- Deny it to every role first, the same way 0004 establishes its baseline, so
-- that a role added later inherits "no" rather than an oversight.
insert into role_permissions (role_id, permission_key, scope)
select r.id, 'members.directory', 'none'::permission_scope
from roles r
on conflict (role_id, permission_key) do nothing;

-- The Presidency.
update role_permissions rp
set scope = 'all'::permission_scope
from roles r
where r.id = rp.role_id
  and rp.permission_key = 'members.directory'
  and r.key in ('super_admin', 'president', 'vice_president');

-- HR's Directors — through the same team-override mechanism 0004 already uses
-- for `members.manage`. Note that no policy and no line of application code
-- learns that "HR" is special: it stays a row in a table, which is the whole
-- point of the access model.
insert into role_permission_team_overrides (role_id, permission_key, team_id, scope)
select
  (select id from roles where key = 'team_director'),
  'members.directory',
  (select id from teams where key = 'HR'),
  'all'::permission_scope
on conflict (role_id, permission_key, team_id) do update
  set scope = excluded.scope;

notify pgrst, 'reload schema';
