-- =============================================================================
-- 0023 — Assets belong to Finance and the Presidency; everyone else asks.
--
-- Two changes, both of them data:
--
--   1. The asset register stops being club-readable. Only the Presidency
--      (President, Vice President, Super Admin) and the Director of the
--      FINANCE team see it — the second of those through a team override, the
--      same mechanism that gives HR its member powers in 0004. No policy and
--      no page changes, because none of them name a role or a team.
--
--   2. Because ordinary members can no longer check an asset out for
--      themselves, the way to get one is a request. So this adds an Asset
--      Request type routed to Finance. It is rows in request_types /
--      request_statuses / request_transitions and nothing else — the same
--      shape 0008 uses, and the same shape db:prove adds a type in.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Baseline: nobody below the Presidency touches assets.
-- -----------------------------------------------------------------------------

update role_permissions rp
   set scope = 'none'
  from roles r
 where r.id = rp.role_id
   and rp.permission_key in ('assets.view', 'assets.manage', 'assets.checkout')
   and r.key in ('team_director', 'project_manager', 'member', 'guest');

-- The Presidency keeps everything, unchanged from 0004 — restated so this file
-- describes the whole end state rather than only the part that moved.
update role_permissions rp
   set scope = 'all'
  from roles r
 where r.id = rp.role_id
   and rp.permission_key in ('assets.view', 'assets.manage', 'assets.checkout')
   and r.key in ('super_admin', 'president', 'vice_president');

-- -----------------------------------------------------------------------------
-- 2. The Finance Director's override.
--
-- 0004 gave asset management to IT's Director as an operating choice. The club
-- has moved custody to Finance, so that override is replaced rather than
-- added to — leaving it would give the club two asset owners.
-- -----------------------------------------------------------------------------

delete from role_permission_team_overrides o
 using roles r, teams t
 where o.role_id = r.id
   and o.team_id = t.id
   and r.key = 'team_director'
   and t.key = 'IT'
   and o.permission_key = 'assets.manage';

insert into role_permission_team_overrides (role_id, permission_key, team_id, scope)
select
  (select id from roles where key = 'team_director'),
  o.permission_key,
  (select id from teams where key = 'FINANCE'),
  'all'::permission_scope
from (values
  ('assets.view'),
  ('assets.manage'),
  ('assets.checkout')
) as o (permission_key)
on conflict (role_id, permission_key, team_id) do update
  set scope = excluded.scope;

-- -----------------------------------------------------------------------------
-- 3. Asset Request — routed to Finance.
--
-- The asset itself is free text rather than a picker: field_schema describes
-- static forms, and a member who cannot read the register has nothing to pick
-- from anyway. Finance reads the name and matches it to a row themselves.
-- -----------------------------------------------------------------------------

insert into request_types
  (key, name_en, name_ar, description_en, description_ar, owning_team_id, field_schema)
select
  'asset_request',
  'Asset Request',
  'طلب عهدة',
  'Ask Finance to hand out a piece of club equipment.',
  'طلب استلام عهدة من الفريق المالي.',
  t.id,
  '[
    {"key":"asset","type":"text","required":true,
     "label_en":"What do you need?","label_ar":"ما العهدة المطلوبة؟"},
    {"key":"purpose","type":"textarea","required":true,
     "label_en":"What is it for?","label_ar":"الغرض من الطلب"},
    {"key":"needed_from","type":"date","required":true,
     "label_en":"Needed from","label_ar":"مطلوبة من تاريخ"},
    {"key":"return_by","type":"date","required":true,
     "label_en":"Returning on","label_ar":"تاريخ الإرجاع"}
  ]'::jsonb
from teams t where t.key = 'FINANCE'
on conflict (key) do update
  set owning_team_id = excluded.owning_team_id,
      field_schema   = excluded.field_schema;

insert into request_statuses
  (request_type_id, key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order)
select rt.id, s.key, s.name_en, s.name_ar, s.is_initial, s.is_terminal, s.is_approved, s.sort_order
from request_types rt
cross join (values
  ('submitted',    'Submitted',        'مُقدَّم',        true,  false, false, 10),
  ('under_review', 'Under review',     'قيد المراجعة',  false, false, false, 20),
  ('needs_info',   'More info needed', 'بحاجة لمعلومات', false, false, false, 30),
  ('approved',     'Approved',         'تمت الموافقة',  false, true,  true,  40),
  ('rejected',     'Rejected',         'مرفوض',         false, true,  false, 50)
) as s (key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order)
where rt.key = 'asset_request'
on conflict (request_type_id, key) do update
  set name_en     = excluded.name_en,
      name_ar     = excluded.name_ar,
      is_initial  = excluded.is_initial,
      is_terminal = excluded.is_terminal,
      is_approved = excluded.is_approved;

insert into request_transitions
  (request_type_id, from_status, to_status, actor_rule, label_en, label_ar, sort_order)
select rt.id, t.from_status, t.to_status, t.actor_rule::request_actor_rule,
       t.label_en, t.label_ar, t.sort_order
from request_types rt
cross join (values
  ('submitted',    'under_review', 'target_approver', 'Start review',      'بدء المراجعة',    10),
  ('submitted',    'needs_info',   'target_approver', 'Ask for more info', 'طلب معلومات',     20),
  ('submitted',    'rejected',     'target_approver', 'Reject',            'رفض',             30),
  ('under_review', 'approved',     'target_approver', 'Approve',           'موافقة',          10),
  ('under_review', 'rejected',     'target_approver', 'Reject',            'رفض',             20),
  ('under_review', 'needs_info',   'target_approver', 'Ask for more info', 'طلب معلومات',     30),
  ('needs_info',   'submitted',    'requester',       'Send updated info', 'إرسال المعلومات', 10)
) as t (from_status, to_status, actor_rule, label_en, label_ar, sort_order)
where rt.key = 'asset_request'
on conflict (request_type_id, from_status, to_status) do update
  set actor_rule = excluded.actor_rule,
      label_en   = excluded.label_en,
      label_ar   = excluded.label_ar;
