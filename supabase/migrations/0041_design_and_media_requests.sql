-- =============================================================================
-- 0039 — Design and Media Requests, both on the task capability.
--
-- Two types, one flow, no code. Everything below is rows.
--
-- This REPLACES the Design Request flow from 0035. That version had its own
-- review step — deliver, then Approve or Revision Required — plus a file
-- upload. Both are gone: confirming the TASK is now the review, which means
-- the work reaches the KPI like all other work, and there is only one way in
-- the club to submit something and have it judged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Carrying a design request onward when its task moves
--
-- Registered as each type's `on_task_event_hook`. The task workflow reports
-- what happened; this decides what it means for the request.
-- -----------------------------------------------------------------------------

create or replace function app.hook_task_event_to_request(
  p_request uuid,
  p_task    uuid,
  p_event   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r requests%rowtype;
begin
  select * into r from requests where id = p_request;

  if p_event = 'submitted' and r.status = 'in_progress' then
    -- The work is in. §2's second meeting checkpoint lives in this status:
    -- from here the Director confirms, rejects, or asks to talk first.
    perform app.system_transition(p_request, 'in_review');

  elsif p_event = 'confirmed' and r.status in ('in_review', 'in_progress') then
    -- §1: confirming the task IS approving the request. There is no separate
    -- approval to make afterwards.
    perform app.system_transition(p_request, 'approved');

  elsif p_event = 'rejected' and r.status = 'in_review' then
    -- Back to work, with the new dates the Director supplied while rejecting.
    perform app.system_transition(p_request, 'in_progress');

  elsif p_event = 'not_done' and r.status in ('in_review', 'in_progress') then
    perform app.system_transition(p_request, 'rejected');
  end if;
end;
$$;

insert into request_hooks (name, function_schema, function_name, description)
values (
  'task_event_to_request',
  'app',
  'hook_task_event_to_request',
  'Moves a request along when the task it created is submitted, confirmed or rejected.'
)
on conflict (name) do update
  set function_schema = excluded.function_schema,
      function_name   = excluded.function_name,
      description     = excluded.description;

-- -----------------------------------------------------------------------------
-- Media Request — a new type
--
-- Two flavours, one type. Coverage of a real event carries `event_date`;
-- standalone content does not. `task_due_date_keys` reads
-- {event_date, delivery_date}, so nothing in code has to ask which it is.
--
-- On the event date: it is FIXED and separate, and it is deliberately NOT the
-- task's due date. Coverage happens on the day, but the edited photos land
-- afterwards — pinning the deadline to the event would score every coverage
-- task Late the moment it was delivered, through nobody's fault. So the event
-- date stays visible and immovable on the request, and the Director agrees a
-- Delivery Date that cannot fall before it.
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('media_requests.submit',
   'Ask the Media team for coverage or content',
   'طلب تغطية أو محتوى من فريق الإعلام')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

insert into role_permissions (role_id, permission_key, scope)
select r.id, 'media_requests.submit', 'none'::permission_scope
from roles r
on conflict (role_id, permission_key) do nothing;

-- Club Management: Presidency, every Team Director, every Project Manager.
update role_permissions rp
   set scope = 'all'
  from roles r
 where r.id = rp.role_id
   and rp.permission_key = 'media_requests.submit'
   and r.key in ('super_admin', 'president', 'vice_president',
                 'team_director', 'project_manager');

insert into request_types
  (key, name_en, name_ar, description_en, description_ar, owning_team_id, field_schema)
select
  'media_request',
  'Media Request',
  'طلب إعلامي',
  'Ask the Media team to cover an event or produce content.',
  'طلب تغطية فعالية أو إنتاج محتوى من فريق الإعلام.',
  t.id,
  '[]'::jsonb
from teams t where t.key = 'MEDIA'
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Both types: the capability, the gate, and the form
-- -----------------------------------------------------------------------------

update request_types
   set creates_task        = true,
       task_start_date_key = 'starting_date',
       task_requires_link  = true,
       on_task_event_hook  = 'task_event_to_request',
       on_meeting_confirmed_hook = 'resume_after_meeting',
       -- Design has no event; the Director's agreed date is the only source.
       task_due_date_keys  = '{delivery_date}',
       submit_permission   = 'design_requests.submit',
       field_schema = '[
         {"key":"title","type":"text","required":true,
          "label_en":"What do you need?","label_ar":"ما المطلوب؟"},
         {"key":"priority","type":"select","required":true,
          "label_en":"Priority","label_ar":"الأولوية",
          "options":[
            {"value":"urgent","label_en":"Urgent","label_ar":"عاجل"},
            {"value":"high","label_en":"High","label_ar":"عالية"},
            {"value":"medium","label_en":"Medium","label_ar":"متوسطة"},
            {"value":"low","label_en":"Low","label_ar":"منخفضة"}
          ]},
         {"key":"required_date","type":"date","required":true,
          "label_en":"Needed by","label_ar":"مطلوب بحلول"},
         {"key":"details","type":"textarea","required":true,
          "label_en":"Details and requirements","label_ar":"التفاصيل والمتطلبات"},
         {"key":"project_id","type":"select","required":false,
          "options_source":"projects",
          "label_en":"For a project? (optional)","label_ar":"لمشروع معيّن؟ (اختياري)"}
       ]'::jsonb
 where key = 'design_request';

update request_types
   set creates_task        = true,
       task_start_date_key = 'starting_date',
       task_requires_link  = true,
       on_task_event_hook  = 'task_event_to_request',
       on_meeting_confirmed_hook = 'resume_after_meeting',
       -- The one difference between the two types, and it is data: coverage
       -- cannot be delivered before the thing it covers has happened.
       task_due_date_keys      = '{delivery_date}',
       task_due_not_before_key = 'event_date',
       submit_permission   = 'media_requests.submit',
       field_schema = '[
         {"key":"title","type":"text","required":true,
          "label_en":"What do you need?","label_ar":"ما المطلوب؟"},
         {"key":"priority","type":"select","required":true,
          "label_en":"Priority","label_ar":"الأولوية",
          "options":[
            {"value":"urgent","label_en":"Urgent","label_ar":"عاجل"},
            {"value":"high","label_en":"High","label_ar":"عالية"},
            {"value":"medium","label_en":"Medium","label_ar":"متوسطة"},
            {"value":"low","label_en":"Low","label_ar":"منخفضة"}
          ]},
         {"key":"event_date","type":"date","required":false,
          "label_en":"Event date, if this is coverage of one",
          "label_ar":"تاريخ الفعالية، إن كانت تغطية"},
         {"key":"required_date","type":"date","required":true,
          "label_en":"Needed by","label_ar":"مطلوب بحلول"},
         {"key":"details","type":"textarea","required":true,
          "label_en":"Details and deliverables","label_ar":"التفاصيل والمخرجات"},
         {"key":"project_id","type":"select","required":false,
          "options_source":"projects",
          "label_en":"For a project? (optional)","label_ar":"لمشروع معيّن؟ (اختياري)"}
       ]'::jsonb
 where key = 'media_request';

-- -----------------------------------------------------------------------------
-- The flow, shared by both
-- -----------------------------------------------------------------------------

delete from request_transitions
 where request_type_id in
   (select id from request_types where key in ('design_request', 'media_request'));

update request_statuses
   set is_initial = false
 where request_type_id in
   (select id from request_types where key in ('design_request', 'media_request'));

insert into request_statuses
  (request_type_id, key, name_en, name_ar,
   is_initial, is_terminal, is_approved, sort_order, required_data_keys)
select rt.id, s.key, s.name_en, s.name_ar,
       s.is_initial, s.is_terminal, s.is_approved, s.sort_order, s.required
from request_types rt
cross join (values
  ('pending_review',   'Pending review',       'قيد المراجعة',      true,  false, false, 10, '{}'::text[]),
  ('awaiting_meeting', 'Waiting on a meeting', 'بانتظار اجتماع',    false, false, false, 20, '{}'::text[]),
  -- §1: accepting needs both dates, and so does restarting after a rejection.
  ('in_progress',      'In progress',          'قيد التنفيذ',       false, false, false, 30,
   '{starting_date,delivery_date}'::text[]),
  ('in_review',        'With the reviewer',    'لدى المراجع',       false, false, false, 40, '{}'::text[]),
  ('approved',         'Approved',             'معتمد',             false, true,  true,  50, '{}'::text[]),
  ('rejected',         'Rejected',             'مرفوض',             false, true,  false, 60, '{}'::text[])
) as s (key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order, required)
where rt.key in ('design_request', 'media_request')
on conflict (request_type_id, key) do update
  set name_en            = excluded.name_en,
      name_ar            = excluded.name_ar,
      is_initial         = excluded.is_initial,
      is_terminal        = excluded.is_terminal,
      is_approved        = excluded.is_approved,
      sort_order         = excluded.sort_order,
      required_data_keys = excluded.required_data_keys;

-- Anything mid-flight on the old design flow lands somewhere sensible. Triggers
-- off: this is a schema change, not a move anybody made. (See 0035 for the
-- longer note on why `app.system_move` is not the tool for this.)
alter table requests disable trigger user;

update requests
   set status = 'pending_review'
 where request_type_id in
   (select id from request_types where key in ('design_request', 'media_request'))
   and status in ('delivered', 'revision_required');

alter table requests enable trigger user;

delete from request_statuses
 where request_type_id in
   (select id from request_types where key in ('design_request', 'media_request'))
   and key not in ('pending_review', 'awaiting_meeting', 'in_progress',
                   'in_review', 'approved', 'rejected');

-- The meeting questions, asked identically at both checkpoints (§2). Written
-- once here and reused, because they are the same conversation either way.
create or replace function app.meeting_transition_fields()
returns jsonb
language sql
immutable
as $$
  select '[
    {"key":"meeting_title","type":"text","required":true,
     "label_en":"Meeting title","label_ar":"عنوان الاجتماع"},
    {"key":"meeting_reason","type":"textarea","required":false,
     "label_en":"What needs discussing?","label_ar":"ما الذي يحتاج نقاشاً؟"},
    {"key":"meeting_type","type":"select","required":true,
     "label_en":"Online or in person?","label_ar":"عن بُعد أم حضورياً؟",
     "options":[
       {"value":"online","label_en":"Online (Google Meet)","label_ar":"عن بُعد (Google Meet)"},
       {"value":"in_person","label_en":"In person","label_ar":"حضورياً"}
     ]},
    {"key":"room_id","type":"select","required":false,
     "options_source":"rooms",
     "label_en":"Room (in-person only)","label_ar":"القاعة (للاجتماع الحضوري)"},
    {"key":"proposed_start","type":"datetime","required":true,
     "label_en":"Proposed start","label_ar":"الوقت المقترح"},
    {"key":"proposed_end","type":"datetime","required":false,
     "label_en":"Proposed end","label_ar":"نهاية الوقت المقترح"}
  ]'::jsonb
$$;

insert into request_transitions
  (request_type_id, from_status, to_status, actor_rule,
   label_en, label_ar, sort_order, on_transition_hook, field_schema)
select rt.id, t.from_status, t.to_status, t.actor_rule::request_actor_rule,
       t.label_en, t.label_ar, t.sort_order, t.hook,
       case when t.fields = 'MEETING' then app.meeting_transition_fields()
            else t.fields::jsonb end
from request_types rt
cross join (values
  -- The Director reviewing the ask. Accepting creates the one real task.
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

  -- §2, checkpoint 1: talk before accepting.
  ('pending_review', 'awaiting_meeting', 'target_approver',
   'Require a meeting first', 'طلب اجتماع أولاً', 20, 'open_meeting', 'MEETING'),

  ('pending_review', 'rejected', 'target_approver', 'Reject', 'رفض', 30, null, '[]'),

  -- Parked. Confirmation of the meeting normally moves it; these are the way
  -- out if the meeting is rejected and it would otherwise sit forever.
  ('awaiting_meeting', 'pending_review', 'target_approver',
   'Carry on without the meeting', 'المتابعة دون اجتماع', 10, null, '[]'),
  ('awaiting_meeting', 'in_review', 'requester',
   'Back to the review', 'العودة إلى المراجعة', 20, null, '[]'),

  -- §2, checkpoint 2: talk before confirming or rejecting the delivered work.
  -- EITHER side may ask, which is what 0039's fourth actor rule is for — one
  -- row, because (type, from, to) is unique and this is genuinely one move.
  ('in_review', 'awaiting_meeting', 'either',
   'Require a meeting first', 'طلب اجتماع أولاً', 10, 'open_meeting', 'MEETING')
) as t (from_status, to_status, actor_rule, label_en, label_ar, sort_order, hook, fields)
where rt.key in ('design_request', 'media_request')
on conflict (request_type_id, from_status, to_status) do update
  set actor_rule         = excluded.actor_rule,
      label_en           = excluded.label_en,
      label_ar           = excluded.label_ar,
      on_transition_hook = excluded.on_transition_hook,
      field_schema       = excluded.field_schema;

/*
 * The moves the SYSTEM makes when the task reports in. They are configured as
 * transitions because `app.validate_request_transition` still checks that a
 * move exists even when the system is the one making it — the system flag
 * waives WHO may act, never WHETHER the move is allowed.
 *
 * `actor_rule` is `target_approver` because that is who would be doing it by
 * hand; in practice the hook gets there first.
 */
insert into request_transitions
  (request_type_id, from_status, to_status, actor_rule, label_en, label_ar, sort_order)
select rt.id, t.from_status, t.to_status, 'target_approver'::request_actor_rule,
       t.label_en, t.label_ar, 90
from request_types rt
cross join (values
  ('in_progress', 'in_review', 'Work submitted',  'تم تسليم العمل'),
  ('in_review',   'in_progress', 'Sent back',     'أُعيد للتعديل'),
  ('in_review',   'approved',  'Work confirmed',  'تم اعتماد العمل'),
  ('in_progress', 'approved',  'Work confirmed',  'تم اعتماد العمل'),
  ('in_review',   'rejected',  'Marked not done', 'اعتُبر غير منجز'),
  ('in_progress', 'rejected',  'Marked not done', 'اعتُبر غير منجز')
) as t (from_status, to_status, label_en, label_ar)
where rt.key in ('design_request', 'media_request')
on conflict (request_type_id, from_status, to_status) do nothing;

-- -----------------------------------------------------------------------------
-- The design-files bucket is no longer used (§1: link only)
--
-- Emptied and left in place rather than dropped: if anything did get uploaded
-- during the short life of the previous flow, silently deleting it would be
-- the wrong way to find out.
-- -----------------------------------------------------------------------------

do $$
declare
  v_objects integer := 0;
begin
  select count(*) into v_objects from storage.objects where bucket_id = 'design-files';

  if v_objects > 0 then
    raise warning
      'The design-files bucket still holds % object(s). Deliverables are links now; move anything worth keeping to Drive, then delete the bucket.',
      v_objects;
  else
    delete from storage.buckets where id = 'design-files';
  end if;
exception
  when insufficient_privilege or undefined_table then
    raise warning 'Could not tidy up the design-files bucket from SQL (%).', sqlerrm;
end
$$;
