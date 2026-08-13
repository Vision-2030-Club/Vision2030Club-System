-- =============================================================================
-- 0004 — Seed the access configuration.
--
-- This is configuration, not code. Everything below can be edited later with
-- plain UPDATEs (or through the admin screens) and takes effect immediately —
-- no deploy, no migration. Re-running this file is safe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Teams
-- -----------------------------------------------------------------------------

insert into teams (key, name_en, name_ar) values
  ('DESIGN',     'Design',          'التصميم'),
  ('MEDIA',      'Media',           'الإعلام'),
  ('CONTENT',    'Content',         'المحتوى'),
  ('TECHNICAL',  'Technical',       'الفني'),
  ('FINANCE',    'Finance',         'المالية'),
  ('PR',         'Public Relations','العلاقات العامة'),
  ('HR',         'Human Resources', 'الموارد البشرية'),
  ('IT',         'IT',              'تقنية المعلومات'),
  ('CLUB_MGMT',  'Club Management', 'إدارة النادي')
on conflict (key) do update
  set name_en = excluded.name_en,
      name_ar = excluded.name_ar;

-- -----------------------------------------------------------------------------
-- Roles — exactly these seven, one per person (spec §2)
-- -----------------------------------------------------------------------------

insert into roles (key, name_en, name_ar, sort_order) values
  ('super_admin',     'Super Admin',     'مدير النظام',   10),
  ('president',       'President',       'الرئيس',        20),
  ('vice_president',  'Vice President',  'نائب الرئيس',   30),
  ('team_director',   'Team Director',   'مدير الفريق',   40),
  ('project_manager', 'Project Manager', 'مدير المشروع',  50),
  ('member',          'Member',          'عضو',           60),
  ('guest',           'Guest',           'ضيف',           70)
on conflict (key) do update
  set name_en    = excluded.name_en,
      name_ar    = excluded.name_ar,
      sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('members.view',            'See the member directory',              'عرض دليل الأعضاء'),
  ('members.manage',          'Edit member records and move members between teams', 'تعديل بيانات الأعضاء ونقلهم بين الفرق'),
  ('members.view_sensitive',  'Read national IDs',                     'الاطلاع على أرقام الهوية'),
  ('roles.configure',         'Change roles and the permission map',   'تعديل الأدوار وصلاحياتها'),
  ('import.run',              'Import members from CSV',               'استيراد الأعضاء من ملف CSV'),
  ('teams.manage',            'Create and edit teams',                 'إنشاء الفرق وتعديلها'),
  ('team_posts.view',         'Read team announcements',               'قراءة إعلانات الفريق'),
  ('team_posts.manage',       'Post team announcements',               'نشر إعلانات الفريق'),
  ('projects.view',           'See projects',                          'عرض المشاريع'),
  ('projects.manage',         'Create and edit projects',              'إنشاء المشاريع وتعديلها'),
  ('tasks.view',              'See tasks',                             'عرض المهام'),
  ('tasks.manage',            'Create and edit tasks',                 'إنشاء المهام وتعديلها'),
  ('requests.view',           'See requests',                          'عرض الطلبات'),
  ('requests.submit',         'Submit requests',                       'تقديم الطلبات'),
  ('requests.approve',        'Act on requests routed to you',         'اتخاذ قرار في الطلبات الموجهة إليك'),
  ('request_types.configure', 'Add and edit request types',            'إضافة أنواع الطلبات وتعديلها'),
  ('calendar.view_all',       'See every calendar entry regardless of audience', 'عرض كل مواعيد التقويم بغض النظر عن الجمهور'),
  ('calendar.manage',         'Create and edit calendar entries',      'إنشاء مواعيد التقويم وتعديلها'),
  ('assets.view',             'See club assets',                       'عرض عهد النادي'),
  ('assets.manage',           'Add and edit assets',                   'إضافة العهد وتعديلها'),
  ('assets.checkout',         'Check assets out and back in',          'استلام العهد وإرجاعها'),
  ('attendance.view',         'Read attendance records',               'الاطلاع على سجلات الحضور'),
  ('attendance.manage',       'Record attendance',                     'تسجيل الحضور')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

-- -----------------------------------------------------------------------------
-- Baseline scopes
--
-- Start from "deny everything" for every (role, permission) pair, then grant
-- explicitly. Anything a future permission forgets to mention stays denied.
-- -----------------------------------------------------------------------------

insert into role_permissions (role_id, permission_key, scope)
select r.id, p.key, 'none'::permission_scope
from roles r
cross join permissions p
on conflict (role_id, permission_key) do nothing;

update role_permissions rp
set scope = grants.scope::permission_scope
from (values
  -- Super Admin: everything, including role/permission configuration.
  ('super_admin', 'members.view',            'all'),
  ('super_admin', 'members.manage',          'all'),
  ('super_admin', 'members.view_sensitive',  'all'),
  ('super_admin', 'roles.configure',         'all'),
  ('super_admin', 'import.run',              'all'),
  ('super_admin', 'teams.manage',            'all'),
  ('super_admin', 'team_posts.view',         'all'),
  ('super_admin', 'team_posts.manage',       'all'),
  ('super_admin', 'projects.view',           'all'),
  ('super_admin', 'projects.manage',         'all'),
  ('super_admin', 'tasks.view',              'all'),
  ('super_admin', 'tasks.manage',            'all'),
  ('super_admin', 'requests.view',           'all'),
  ('super_admin', 'requests.submit',         'all'),
  ('super_admin', 'requests.approve',        'all'),
  ('super_admin', 'request_types.configure', 'all'),
  ('super_admin', 'calendar.view_all',       'all'),
  ('super_admin', 'calendar.manage',         'all'),
  ('super_admin', 'assets.view',             'all'),
  ('super_admin', 'assets.manage',           'all'),
  ('super_admin', 'assets.checkout',         'all'),
  ('super_admin', 'attendance.view',         'all'),
  ('super_admin', 'attendance.manage',       'all'),

  -- President: everything EXCEPT role/permission configuration.
  ('president', 'members.view',            'all'),
  ('president', 'members.manage',          'all'),
  ('president', 'members.view_sensitive',  'all'),
  ('president', 'import.run',              'none'),
  ('president', 'teams.manage',            'all'),
  ('president', 'team_posts.view',         'all'),
  ('president', 'team_posts.manage',       'all'),
  ('president', 'projects.view',           'all'),
  ('president', 'projects.manage',         'all'),
  ('president', 'tasks.view',              'all'),
  ('president', 'tasks.manage',            'all'),
  ('president', 'requests.view',           'all'),
  ('president', 'requests.submit',         'all'),
  ('president', 'requests.approve',        'all'),
  ('president', 'request_types.configure', 'all'),
  ('president', 'calendar.view_all',       'all'),
  ('president', 'calendar.manage',         'all'),
  ('president', 'assets.view',             'all'),
  ('president', 'assets.manage',           'all'),
  ('president', 'assets.checkout',         'all'),
  ('president', 'attendance.view',         'all'),
  ('president', 'attendance.manage',       'all'),

  -- Vice President: same as President.
  ('vice_president', 'members.view',            'all'),
  ('vice_president', 'members.manage',          'all'),
  ('vice_president', 'members.view_sensitive',  'all'),
  ('vice_president', 'import.run',              'none'),
  ('vice_president', 'teams.manage',            'all'),
  ('vice_president', 'team_posts.view',         'all'),
  ('vice_president', 'team_posts.manage',       'all'),
  ('vice_president', 'projects.view',           'all'),
  ('vice_president', 'projects.manage',         'all'),
  ('vice_president', 'tasks.view',              'all'),
  ('vice_president', 'tasks.manage',            'all'),
  ('vice_president', 'requests.view',           'all'),
  ('vice_president', 'requests.submit',         'all'),
  ('vice_president', 'requests.approve',        'all'),
  ('vice_president', 'request_types.configure', 'all'),
  ('vice_president', 'calendar.view_all',       'all'),
  ('vice_president', 'calendar.manage',         'all'),
  ('vice_president', 'assets.view',             'all'),
  ('vice_president', 'assets.manage',           'all'),
  ('vice_president', 'assets.checkout',         'all'),
  ('vice_president', 'attendance.view',         'all'),
  ('vice_president', 'attendance.manage',       'all'),

  -- Team Director: their own team's OPERATIONAL data only.
  -- members.manage and members.view_sensitive stay 'none' here on purpose —
  -- see the HR overrides below (spec §2, deliberate rollback).
  ('team_director', 'members.view',      'all'),
  ('team_director', 'teams.manage',      'own_team'),
  ('team_director', 'team_posts.view',   'own_team'),
  ('team_director', 'team_posts.manage', 'own_team'),
  ('team_director', 'projects.view',     'all'),
  ('team_director', 'projects.manage',   'own_team'),
  ('team_director', 'tasks.view',        'all'),
  ('team_director', 'tasks.manage',      'own_team'),
  ('team_director', 'requests.view',     'own_team'),
  ('team_director', 'requests.submit',   'all'),
  ('team_director', 'requests.approve',  'own_team'),
  ('team_director', 'calendar.manage',   'own_team'),
  ('team_director', 'assets.view',       'all'),
  ('team_director', 'assets.checkout',   'all'),

  -- Project Manager: full rights on projects they run, read elsewhere.
  ('project_manager', 'members.view',    'all'),
  ('project_manager', 'team_posts.view', 'own_team'),
  ('project_manager', 'projects.view',   'all'),
  ('project_manager', 'projects.manage', 'own_projects'),
  ('project_manager', 'tasks.view',      'all'),
  ('project_manager', 'tasks.manage',    'own_projects'),
  ('project_manager', 'requests.view',   'own_projects'),
  ('project_manager', 'requests.submit', 'all'),
  ('project_manager', 'requests.approve','own_projects'),
  ('project_manager', 'calendar.manage', 'own_projects'),
  ('project_manager', 'assets.view',     'all'),
  ('project_manager', 'assets.checkout', 'all'),

  -- Member: only what is assigned to them or submitted by them.
  ('member', 'members.view',    'all'),
  ('member', 'team_posts.view', 'own_team'),
  ('member', 'projects.view',   'own_team'),
  ('member', 'tasks.view',      'own_team'),
  ('member', 'tasks.manage',    'assigned'),
  ('member', 'requests.view',   'own'),
  ('member', 'requests.submit', 'all'),
  ('member', 'assets.view',     'all'),
  ('member', 'assets.checkout', 'all')

  -- Guest: nothing. Guests see only what is explicitly public to signed-in
  -- users, which in this system means club-wide calendar entries (spec §6).
) as grants (role_key, permission_key, scope)
where rp.role_id = (select id from roles where key = grants.role_key)
  and rp.permission_key = grants.permission_key;

-- -----------------------------------------------------------------------------
-- Team-specific overrides
--
-- These are the only reason a Director of one team can do something a
-- Director of another cannot. Deleting a row here removes the power; no code
-- anywhere knows that "HR" or "IT" is special.
-- -----------------------------------------------------------------------------

insert into role_permission_team_overrides (role_id, permission_key, team_id, scope)
select
  (select id from roles where key = o.role_key),
  o.permission_key,
  (select id from teams where key = o.team_key),
  o.scope::permission_scope
from (values
  -- Spec §2: member management belongs to HR's Directors, nobody else's.
  ('team_director', 'members.manage',         'HR', 'all'),
  ('team_director', 'members.view_sensitive', 'HR', 'all'),
  -- Spec §9: attendance visibility defaults to HR and leadership.
  ('team_director', 'attendance.view',        'HR', 'all'),
  ('team_director', 'attendance.manage',      'HR', 'all'),
  -- Operating choice, not a system rule: IT looks after club equipment.
  ('team_director', 'assets.manage',          'IT', 'all')
) as o (role_key, permission_key, team_key, scope)
on conflict (role_id, permission_key, team_id) do update
  set scope = excluded.scope;

-- -----------------------------------------------------------------------------
-- Skills — a fixed list, but the list is data (spec §10).
-- -----------------------------------------------------------------------------

insert into skills (key, name_en, name_ar) values
  ('graphic_design',    'Graphic Design',    'التصميم الجرافيكي'),
  ('video_editing',     'Video Editing',     'مونتاج الفيديو'),
  ('photography',       'Photography',       'التصوير'),
  ('copywriting',       'Copywriting',       'كتابة المحتوى'),
  ('public_speaking',   'Public Speaking',   'الإلقاء'),
  ('event_management',  'Event Management',  'تنظيم الفعاليات'),
  ('web_development',   'Web Development',   'تطوير الويب'),
  ('data_analysis',     'Data Analysis',     'تحليل البيانات'),
  ('social_media',      'Social Media',      'التواصل الاجتماعي'),
  ('translation',       'Translation',       'الترجمة'),
  ('accounting',        'Accounting',        'المحاسبة'),
  ('sponsorship',       'Sponsorship',       'الرعايات')
on conflict (key) do update
  set name_en = excluded.name_en,
      name_ar = excluded.name_ar;
