-- =============================================================================
-- 0008 — Seed the first request types.
--
-- Everything below is DATA. Each type is one row in request_types plus its
-- statuses and its allowed transitions. Adding a fifth type later requires
-- nothing but more rows of exactly this shape — see 0012 for the proof.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Meeting Request — the negotiation loop (spec §3)
--
-- Directors and Project Managers add meetings inside their own authority
-- directly. Anything reaching outside it lands here. The Counter loop below is
-- the real test of the engine: `countered_by_target` and
-- `countered_by_requester` point at each other, so the back-and-forth can run
-- as many rounds as the two sides need. Nothing caps it, because a cap would
-- have to be code.
-- -----------------------------------------------------------------------------

insert into request_types
  (key, name_en, name_ar, description_en, description_ar,
   owning_team_id, on_approval_hook, field_schema)
values (
  'meeting_request',
  'Meeting Request',
  'طلب اجتماع',
  'Ask another team, project, or the Presidency for a meeting.',
  'طلب اجتماع مع فريق آخر أو مشروع آخر أو الرئاسة.',
  null,                      -- not owned by a single team
  'create_calendar_entry',   -- §6: the calendar entry appears only on approval
  '[
    {"key":"title","type":"text","required":true,
     "label_en":"Meeting title","label_ar":"عنوان الاجتماع"},
    {"key":"description","type":"textarea","required":false,
     "label_en":"What is it about?","label_ar":"موضوع الاجتماع"},
    {"key":"proposed_start","type":"datetime","required":true,
     "label_en":"Proposed start","label_ar":"الوقت المقترح للبداية"},
    {"key":"proposed_end","type":"datetime","required":false,
     "label_en":"Proposed end","label_ar":"الوقت المقترح للنهاية"},
    {"key":"location","type":"text","required":false,
     "label_en":"Location","label_ar":"المكان"}
  ]'::jsonb
)
on conflict (key) do update
  set on_approval_hook = excluded.on_approval_hook,
      field_schema     = excluded.field_schema;

insert into request_statuses
  (request_type_id, key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order)
select rt.id, s.key, s.name_en, s.name_ar, s.is_initial, s.is_terminal, s.is_approved, s.sort_order
from request_types rt
cross join (values
  ('pending',                 'Pending',                   'قيد الانتظار',           true,  false, false, 10),
  ('under_review',            'Under review',              'قيد المراجعة',           false, false, false, 20),
  ('countered_by_target',     'New time suggested',        'اقتُرح وقت آخر',          false, false, false, 30),
  ('countered_by_requester',  'New time suggested back',   'اقتُرح وقت بديل',         false, false, false, 40),
  ('approved',                'Approved',                  'تمت الموافقة',           false, true,  true,  50),
  ('rejected',                'Rejected',                  'مرفوض',                  false, true,  false, 60)
) as s (key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order)
where rt.key = 'meeting_request'
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
  -- The approving side: approve, reject, or suggest a different time.
  ('pending',                'under_review',           'target_approver', 'Start review',        'بدء المراجعة',        10),
  ('pending',                'approved',               'target_approver', 'Approve',             'موافقة',              20),
  ('pending',                'rejected',               'target_approver', 'Reject',              'رفض',                 30),
  ('pending',                'countered_by_target',    'target_approver', 'Suggest another time','اقتراح وقت آخر',      40),
  ('under_review',           'approved',               'target_approver', 'Approve',             'موافقة',              20),
  ('under_review',           'rejected',               'target_approver', 'Reject',              'رفض',                 30),
  ('under_review',           'countered_by_target',    'target_approver', 'Suggest another time','اقتراح وقت آخر',      40),

  -- Back with the requester: accept (which finalises), withdraw, or counter.
  ('countered_by_target',    'approved',               'requester',       'Accept this time',    'قبول الوقت المقترح',  10),
  ('countered_by_target',    'rejected',               'requester',       'Withdraw',            'سحب الطلب',           20),
  ('countered_by_target',    'countered_by_requester', 'requester',       'Suggest another time','اقتراح وقت آخر',      30),

  -- …and back with the target again. These two rows are the loop: it can run
  -- as many rounds as needed, with no limit anywhere.
  ('countered_by_requester', 'approved',               'target_approver', 'Accept this time',    'قبول الوقت المقترح',  10),
  ('countered_by_requester', 'rejected',               'target_approver', 'Reject',              'رفض',                 20),
  ('countered_by_requester', 'countered_by_target',    'target_approver', 'Suggest another time','اقتراح وقت آخر',      30)
) as t (from_status, to_status, actor_rule, label_en, label_ar, sort_order)
where rt.key = 'meeting_request'
on conflict (request_type_id, from_status, to_status) do update
  set actor_rule = excluded.actor_rule,
      label_en   = excluded.label_en,
      label_ar   = excluded.label_ar;

-- -----------------------------------------------------------------------------
-- 2. Money Request — routed to Finance
-- -----------------------------------------------------------------------------

insert into request_types
  (key, name_en, name_ar, description_en, description_ar, owning_team_id, field_schema)
select
  'money_request',
  'Money Request',
  'طلب مالي',
  'Ask Finance to approve a purchase or reimbursement.',
  'طلب موافقة الفريق المالي على شراء أو تعويض.',
  t.id,
  '[
    {"key":"amount","type":"number","required":true,
     "label_en":"Amount (SAR)","label_ar":"المبلغ (ريال)"},
    {"key":"purpose","type":"text","required":true,
     "label_en":"What is it for?","label_ar":"الغرض"},
    {"key":"justification","type":"textarea","required":true,
     "label_en":"Justification","label_ar":"المبرر"},
    {"key":"needed_by","type":"date","required":false,
     "label_en":"Needed by","label_ar":"مطلوب قبل"}
  ]'::jsonb
from teams t where t.key = 'FINANCE'
on conflict (key) do update set field_schema = excluded.field_schema;

-- -----------------------------------------------------------------------------
-- 3. Design Request — routed to Design
-- -----------------------------------------------------------------------------

insert into request_types
  (key, name_en, name_ar, description_en, description_ar, owning_team_id, field_schema)
select
  'design_request',
  'Design Request',
  'طلب تصميم',
  'Ask the Design team for artwork or brand material.',
  'طلب تصميم أو مواد بصرية من فريق التصميم.',
  t.id,
  '[
    {"key":"deliverable","type":"select","required":true,
     "label_en":"Deliverable","label_ar":"المطلوب",
     "options":[
       {"value":"poster","label_en":"Poster","label_ar":"ملصق"},
       {"value":"social","label_en":"Social media post","label_ar":"منشور تواصل"},
       {"value":"banner","label_en":"Banner","label_ar":"بانر"},
       {"value":"other","label_en":"Other","label_ar":"أخرى"}
     ]},
    {"key":"details","type":"textarea","required":true,
     "label_en":"Details","label_ar":"التفاصيل"},
    {"key":"deadline","type":"date","required":true,
     "label_en":"Deadline","label_ar":"الموعد النهائي"}
  ]'::jsonb
from teams t where t.key = 'DESIGN'
on conflict (key) do update set field_schema = excluded.field_schema;

-- -----------------------------------------------------------------------------
-- 4. IT Ticket — routed to IT
-- -----------------------------------------------------------------------------

insert into request_types
  (key, name_en, name_ar, description_en, description_ar, owning_team_id, field_schema)
select
  'it_ticket',
  'IT Ticket',
  'بلاغ تقني',
  'Report a problem or ask IT for help.',
  'الإبلاغ عن مشكلة أو طلب مساعدة من فريق تقنية المعلومات.',
  t.id,
  '[
    {"key":"urgency","type":"select","required":true,
     "label_en":"Urgency","label_ar":"الأولوية",
     "options":[
       {"value":"low","label_en":"Low","label_ar":"منخفضة"},
       {"value":"normal","label_en":"Normal","label_ar":"عادية"},
       {"value":"high","label_en":"High","label_ar":"عالية"}
     ]},
    {"key":"description","type":"textarea","required":true,
     "label_en":"What is happening?","label_ar":"وصف المشكلة"}
  ]'::jsonb
from teams t where t.key = 'IT'
on conflict (key) do update set field_schema = excluded.field_schema;

-- -----------------------------------------------------------------------------
-- The three team-routed types share one simple flow, so seed them together.
-- (Same table, same columns — only the rows differ.)
-- -----------------------------------------------------------------------------

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
where rt.key in ('money_request', 'design_request', 'it_ticket')
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
  ('submitted',    'under_review', 'target_approver', 'Start review',      'بدء المراجعة',     10),
  ('submitted',    'needs_info',   'target_approver', 'Ask for more info', 'طلب معلومات',      20),
  ('submitted',    'rejected',     'target_approver', 'Reject',            'رفض',              30),
  ('under_review', 'approved',     'target_approver', 'Approve',           'موافقة',           10),
  ('under_review', 'rejected',     'target_approver', 'Reject',            'رفض',              20),
  ('under_review', 'needs_info',   'target_approver', 'Ask for more info', 'طلب معلومات',      30),
  -- Another loop, and again it is only data: a request can bounce between
  -- "needs info" and review any number of times.
  ('needs_info',   'submitted',    'requester',       'Send updated info', 'إرسال المعلومات',  10)
) as t (from_status, to_status, actor_rule, label_en, label_ar, sort_order)
where rt.key in ('money_request', 'design_request', 'it_ticket')
on conflict (request_type_id, from_status, to_status) do update
  set actor_rule = excluded.actor_rule,
      label_en   = excluded.label_en,
      label_ar   = excluded.label_ar;
