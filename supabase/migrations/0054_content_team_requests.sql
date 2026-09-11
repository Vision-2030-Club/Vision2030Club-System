-- =============================================================================
-- 0054 — Three requests for the Content team. Rows only, no code.
--
--   content_request         a script, an event agenda, or a thread — WORK,
--   legal_document_request  a contract, MoU, agreement or letter — WORK,
--   legal_review            "is this document/text compliant?" — an OPINION.
--
-- The two work types are the Media Request flow verbatim (0041): the Content
-- Director accepts, it becomes a task for someone in Content, it is delivered
-- as a link, the Director confirms it, and it counts in the KPI. The review is
-- the IT Ticket shape (0008): submitted → under review → a verdict, with
-- "more info" and "needs changes" both sending it back to the requester.
--
-- One submit permission covers all three, held by Club Management, as agreed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Who may submit
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('content_requests.submit',
   'Ask the Content team for content, a legal review, or a legal document',
   'طلب محتوى أو مراجعة قانونية أو مستند قانوني من فريق المحتوى')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

insert into role_permissions (role_id, permission_key, scope)
select r.id, 'content_requests.submit', 'none'::permission_scope
from roles r
on conflict (role_id, permission_key) do nothing;

-- Club Management: Presidency, every Team Director, every Project Manager.
update role_permissions rp
   set scope = 'all'
  from roles r
 where r.id = rp.role_id
   and rp.permission_key = 'content_requests.submit'
   and r.key in ('super_admin', 'president', 'vice_president',
                 'team_director', 'project_manager');

-- -----------------------------------------------------------------------------
-- The three types
-- -----------------------------------------------------------------------------

insert into request_types
  (key, name_en, name_ar, description_en, description_ar, owning_team_id,
   submit_permission, field_schema)
select t.key, t.name_en, t.name_ar, t.description_en, t.description_ar, tm.id,
       'content_requests.submit', '[]'::jsonb
from (values
  ('content_request',
   'Content Request', 'طلب محتوى',
   'Ask the Content team for a script, an event agenda, or a thread.',
   'طلب نص أو أجندة فعالية أو سلسلة تغريدات من فريق المحتوى.'),
  ('legal_document_request',
   'Legal Document Request', 'طلب مستند قانوني',
   'Ask the Content team to draft a contract, agreement, or official letter.',
   'طلب صياغة عقد أو اتفاقية أو خطاب رسمي من فريق المحتوى.'),
  ('legal_review',
   'Legal Review', 'مراجعة قانونية',
   'Ask the Content team to check a document or text for compliance.',
   'طلب مراجعة مستند أو نص للتأكد من توافقه من فريق المحتوى.')
) as t (key, name_en, name_ar, description_en, description_ar)
cross join teams tm
where tm.key = 'CONTENT'
on conflict (key) do update
  set name_en           = excluded.name_en,
      name_ar           = excluded.name_ar,
      description_en    = excluded.description_en,
      description_ar    = excluded.description_ar,
      owning_team_id    = excluded.owning_team_id,
      submit_permission = excluded.submit_permission;

-- --- Content Request: the form ---------------------------------------------

update request_types
   set creates_task              = true,
       task_start_date_key       = 'starting_date',
       task_due_date_keys        = '{delivery_date}',
       task_requires_link        = true,
       on_task_event_hook        = 'task_event_to_request',
       on_meeting_confirmed_hook = 'resume_after_meeting',
       field_schema = '[
         {"key":"content_type","type":"select","required":true,
          "label_en":"Type of content","label_ar":"نوع المحتوى",
          "options":[
            {"value":"script",       "label_en":"Script",       "label_ar":"نص"},
            {"value":"event_agenda", "label_en":"Event agenda", "label_ar":"أجندة فعالية"},
            {"value":"thread",       "label_en":"Thread",       "label_ar":"سلسلة تغريدات"},
            {"value":"other",        "label_en":"Other",        "label_ar":"أخرى"}
          ]},
         {"key":"content_type_other","type":"text","required":false,
          "label_en":"If other, what?","label_ar":"إن كانت أخرى، ما هي؟"},
         {"key":"title","type":"text","required":true,
          "label_en":"What do you need?","label_ar":"ما المطلوب؟"},
         {"key":"priority","type":"select","required":true,
          "label_en":"Priority","label_ar":"الأولوية",
          "options":[
            {"value":"urgent","label_en":"Urgent","label_ar":"عاجل"},
            {"value":"high",  "label_en":"High",  "label_ar":"عالية"},
            {"value":"medium","label_en":"Medium","label_ar":"متوسطة"},
            {"value":"low",   "label_en":"Low",   "label_ar":"منخفضة"}
          ]},
         {"key":"required_date","type":"date","required":true,
          "label_en":"Needed by","label_ar":"مطلوب بحلول"},
         {"key":"details","type":"textarea","required":true,
          "label_en":"Details and requirements","label_ar":"التفاصيل والمتطلبات"},
         {"key":"project_id","type":"select","required":false,
          "options_source":"projects",
          "label_en":"For a project? (optional)","label_ar":"لمشروع معيّن؟ (اختياري)"}
       ]'::jsonb
 where key = 'content_request';

-- --- Legal Document Request: the form ---------------------------------------

update request_types
   set creates_task              = true,
       task_start_date_key       = 'starting_date',
       task_due_date_keys        = '{delivery_date}',
       task_requires_link        = true,
       on_task_event_hook        = 'task_event_to_request',
       on_meeting_confirmed_hook = 'resume_after_meeting',
       field_schema = '[
         {"key":"document_type","type":"select","required":true,
          "label_en":"Type of document","label_ar":"نوع المستند",
          "options":[
            {"value":"contract",    "label_en":"Contract",              "label_ar":"عقد"},
            {"value":"mou",         "label_en":"Memorandum of understanding","label_ar":"مذكرة تفاهم"},
            {"value":"sponsorship", "label_en":"Sponsorship agreement", "label_ar":"اتفاقية رعاية"},
            {"value":"letter",      "label_en":"Official letter",       "label_ar":"خطاب رسمي"},
            {"value":"other",       "label_en":"Other",                 "label_ar":"أخرى"}
          ]},
         {"key":"document_type_other","type":"text","required":false,
          "label_en":"If other, what?","label_ar":"إن كان أخرى، ما هو؟"},
         {"key":"title","type":"text","required":true,
          "label_en":"What do you need?","label_ar":"ما المطلوب؟"},
         {"key":"other_party","type":"text","required":true,
          "label_en":"The other party","label_ar":"الطرف الآخر"},
         {"key":"purpose","type":"textarea","required":true,
          "label_en":"Purpose and key terms","label_ar":"الغرض والبنود الأساسية"},
         {"key":"priority","type":"select","required":true,
          "label_en":"Priority","label_ar":"الأولوية",
          "options":[
            {"value":"urgent","label_en":"Urgent","label_ar":"عاجل"},
            {"value":"high",  "label_en":"High",  "label_ar":"عالية"},
            {"value":"medium","label_en":"Medium","label_ar":"متوسطة"},
            {"value":"low",   "label_en":"Low",   "label_ar":"منخفضة"}
          ]},
         {"key":"required_date","type":"date","required":true,
          "label_en":"Needed by","label_ar":"مطلوب بحلول"},
         {"key":"project_id","type":"select","required":false,
          "options_source":"projects",
          "label_en":"For a project? (optional)","label_ar":"لمشروع معيّن؟ (اختياري)"}
       ]'::jsonb
 where key = 'legal_document_request';

-- --- Legal Review: the form (no task) ---------------------------------------

update request_types
   set creates_task = false,
       field_schema = '[
         {"key":"title","type":"text","required":true,
          "label_en":"What is being reviewed?","label_ar":"ما الذي تريد مراجعته؟"},
         {"key":"link","type":"text","required":false,
          "label_en":"Link to the document (optional)","label_ar":"رابط المستند (اختياري)"},
         {"key":"content","type":"textarea","required":true,
          "label_en":"The text to review — or, for a link, what to look at",
          "label_ar":"النص المطلوب مراجعته — أو ما ينبغي النظر فيه إن أرفقت رابطاً"},
         {"key":"priority","type":"select","required":true,
          "label_en":"Priority","label_ar":"الأولوية",
          "options":[
            {"value":"urgent","label_en":"Urgent","label_ar":"عاجل"},
            {"value":"high",  "label_en":"High",  "label_ar":"عالية"},
            {"value":"medium","label_en":"Medium","label_ar":"متوسطة"},
            {"value":"low",   "label_en":"Low",   "label_ar":"منخفضة"}
          ]},
         {"key":"required_date","type":"date","required":true,
          "label_en":"Needed by","label_ar":"مطلوب بحلول"},
         {"key":"project_id","type":"select","required":false,
          "options_source":"projects",
          "label_en":"For a project? (optional)","label_ar":"لمشروع معيّن؟ (اختياري)"}
       ]'::jsonb
 where key = 'legal_review';

-- -----------------------------------------------------------------------------
-- The work flow — the same rows 0041 gives Design and Media
-- -----------------------------------------------------------------------------

insert into request_statuses
  (request_type_id, key, name_en, name_ar,
   is_initial, is_terminal, is_approved, sort_order, required_data_keys)
select rt.id, s.key, s.name_en, s.name_ar,
       s.is_initial, s.is_terminal, s.is_approved, s.sort_order, s.required
from request_types rt
cross join (values
  ('pending_review',   'Pending review',       'قيد المراجعة',   true,  false, false, 10, '{}'::text[]),
  ('awaiting_meeting', 'Waiting on a meeting', 'بانتظار اجتماع', false, false, false, 20, '{}'::text[]),
  ('in_progress',      'In progress',          'قيد التنفيذ',    false, false, false, 30,
   '{starting_date,delivery_date}'::text[]),
  ('in_review',        'With the reviewer',    'لدى المراجع',    false, false, false, 40, '{}'::text[]),
  ('approved',         'Approved',             'معتمد',          false, true,  true,  50, '{}'::text[]),
  ('rejected',         'Rejected',             'مرفوض',          false, true,  false, 60, '{}'::text[])
) as s (key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order, required)
where rt.key in ('content_request', 'legal_document_request')
on conflict (request_type_id, key) do update
  set name_en            = excluded.name_en,
      name_ar            = excluded.name_ar,
      is_initial         = excluded.is_initial,
      is_terminal        = excluded.is_terminal,
      is_approved        = excluded.is_approved,
      sort_order         = excluded.sort_order,
      required_data_keys = excluded.required_data_keys;

insert into request_transitions
  (request_type_id, from_status, to_status, actor_rule,
   label_en, label_ar, sort_order, on_transition_hook, field_schema)
select rt.id, t.from_status, t.to_status, t.actor_rule::request_actor_rule,
       t.label_en, t.label_ar, t.sort_order, t.hook,
       case when t.fields = 'MEETING' then app.meeting_transition_fields()
            else t.fields::jsonb end
from request_types rt
cross join (values
  ('pending_review', 'in_progress', 'target_approver',
   'Accept and start the work', 'قبول وبدء العمل', 10, 'create_task_from_request', '[
     {"key":"starting_date","type":"date","required":true,
      "label_en":"Starting date","label_ar":"تاريخ البدء"},
     {"key":"delivery_date","type":"date","required":true,
      "label_en":"Delivery date","label_ar":"تاريخ التسليم"},
     {"key":"assignee_id","type":"select","required":false,
      "options_source":"assignable_members",
      "label_en":"Assign to (leave empty to let the team claim it)",
      "label_ar":"إسناد إلى (اتركه فارغاً ليختاره أحد الفريق)"}
   ]'),
  ('pending_review', 'awaiting_meeting', 'target_approver',
   'Require a meeting first', 'طلب اجتماع أولاً', 20, 'open_meeting', 'MEETING'),
  ('pending_review', 'rejected', 'target_approver', 'Reject', 'رفض', 30, null, '[]'),
  ('awaiting_meeting', 'pending_review', 'target_approver',
   'Carry on without the meeting', 'المتابعة دون اجتماع', 10, null, '[]'),
  ('awaiting_meeting', 'in_review', 'requester',
   'Back to the review', 'العودة إلى المراجعة', 20, null, '[]'),
  ('in_review', 'awaiting_meeting', 'either',
   'Require a meeting first', 'طلب اجتماع أولاً', 10, 'open_meeting', 'MEETING')
) as t (from_status, to_status, actor_rule, label_en, label_ar, sort_order, hook, fields)
where rt.key in ('content_request', 'legal_document_request')
on conflict (request_type_id, from_status, to_status) do update
  set actor_rule         = excluded.actor_rule,
      label_en           = excluded.label_en,
      label_ar           = excluded.label_ar,
      on_transition_hook = excluded.on_transition_hook,
      field_schema       = excluded.field_schema;

-- The moves the task makes on the request's behalf (see 0041 for why these
-- are rows even though nobody presses them).
insert into request_transitions
  (request_type_id, from_status, to_status, actor_rule, label_en, label_ar, sort_order)
select rt.id, t.from_status, t.to_status, 'target_approver'::request_actor_rule,
       t.label_en, t.label_ar, 90
from request_types rt
cross join (values
  ('in_progress', 'in_review',   'Work submitted',  'تم تسليم العمل'),
  ('in_review',   'in_progress', 'Sent back',       'أُعيد للتعديل'),
  ('in_review',   'approved',    'Work confirmed',  'تم اعتماد العمل'),
  ('in_progress', 'approved',    'Work confirmed',  'تم اعتماد العمل'),
  ('in_review',   'rejected',    'Marked not done', 'اعتُبر غير منجز'),
  ('in_progress', 'rejected',    'Marked not done', 'اعتُبر غير منجز')
) as t (from_status, to_status, label_en, label_ar)
where rt.key in ('content_request', 'legal_document_request')
on conflict (request_type_id, from_status, to_status) do nothing;

-- -----------------------------------------------------------------------------
-- The review flow — a verdict, not a deliverable
--
-- "Needs changes" and "More info needed" both hand it back to the requester;
-- they differ in what is being asked for. Resubmitting returns it to the top
-- so the reviewer sees it again as new.
-- -----------------------------------------------------------------------------

insert into request_statuses
  (request_type_id, key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order)
select rt.id, s.key, s.name_en, s.name_ar, s.is_initial, s.is_terminal, s.is_approved, s.sort_order
from request_types rt
cross join (values
  ('submitted',     'Submitted',        'مُقدَّم',        true,  false, false, 10),
  ('under_review',  'Under review',     'قيد المراجعة',   false, false, false, 20),
  ('needs_info',    'More info needed', 'بحاجة لمعلومات', false, false, false, 30),
  ('needs_changes', 'Needs changes',    'يحتاج تعديلات',  false, false, false, 40),
  ('approved',      'Approved',         'معتمد',          false, true,  true,  50),
  ('not_approved',  'Not approved',     'غير معتمد',      false, true,  false, 60)
) as s (key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order)
where rt.key = 'legal_review'
on conflict (request_type_id, key) do update
  set name_en     = excluded.name_en,
      name_ar     = excluded.name_ar,
      is_initial  = excluded.is_initial,
      is_terminal = excluded.is_terminal,
      is_approved = excluded.is_approved,
      sort_order  = excluded.sort_order;

insert into request_transitions
  (request_type_id, from_status, to_status, actor_rule, label_en, label_ar, sort_order)
select rt.id, t.from_status, t.to_status, t.actor_rule::request_actor_rule,
       t.label_en, t.label_ar, t.sort_order
from request_types rt
cross join (values
  -- The reviewer.
  ('submitted',     'under_review',  'target_approver', 'Start review',           'بدء المراجعة',           10),
  ('submitted',     'needs_info',    'target_approver', 'Ask for more info',      'طلب معلومات إضافية',      20),
  ('submitted',     'not_approved',  'target_approver', 'Not approved',           'عدم اعتماد',              30),
  ('under_review',  'approved',      'target_approver', 'Approve',                'اعتماد',                  10),
  ('under_review',  'needs_changes', 'target_approver', 'Request changes',        'طلب تعديلات',             20),
  ('under_review',  'needs_info',    'target_approver', 'Ask for more info',      'طلب معلومات إضافية',      30),
  ('under_review',  'not_approved',  'target_approver', 'Not approved',           'عدم اعتماد',              40),
  -- The requester, answering.
  ('needs_info',    'submitted',     'requester',       'Send updated info',      'إرسال المعلومات المحدّثة', 10),
  ('needs_changes', 'submitted',     'requester',       'Resubmit after changes', 'إعادة الإرسال بعد التعديل', 10)
) as t (from_status, to_status, actor_rule, label_en, label_ar, sort_order)
where rt.key = 'legal_review'
on conflict (request_type_id, from_status, to_status) do update
  set actor_rule = excluded.actor_rule,
      label_en   = excluded.label_en,
      label_ar   = excluded.label_ar,
      sort_order = excluded.sort_order;

notify pgrst, 'reload schema';
