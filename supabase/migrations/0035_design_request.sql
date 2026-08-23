-- =============================================================================
-- 0035 — The Design Request (§7).
--
-- A request type, its statuses, its transitions, and two hooks. There is no
-- Design Request table, no Design Request screen, and — importantly — no
-- meeting logic: "Require Meeting" creates an ordinary meeting request and
-- waits, and from that point it is the Meetings component's business entirely,
-- with the same negotiation, room hold, recipients and Meet link as any other
-- meeting in the club.
--
-- One thing worth stating up front, because it looks like a departure: §7
-- writes "Pending Review" twice, meaning two different things — the Design
-- Director reviewing the ASK, and the submitter reviewing the DELIVERED work.
-- The engine decides who may act from the (from_status -> to_status) pair, and
-- one status key cannot carry two opposite actors. So there are two keys,
-- `pending_review` and `delivered`. Their display names can say whatever the
-- club prefers; only the internals differ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Who may submit one (§7: Club Management only, enforced at BOTH layers)
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('design_requests.submit',
   'Ask the Design team for work',
   'طلب عمل من فريق التصميم')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

insert into role_permissions (role_id, permission_key, scope)
select r.id, 'design_requests.submit', 'none'::permission_scope
from roles r
on conflict (role_id, permission_key) do nothing;

-- Presidency + every Team Director + every Project Manager. That IS Club
-- Management, and it is spelled out as data here rather than as a role test in
-- code — moving a role in or out is one UPDATE.
update role_permissions rp
   set scope = 'all'
  from roles r
 where r.id = rp.role_id
   and rp.permission_key = 'design_requests.submit'
   and r.key in ('super_admin', 'president', 'vice_president',
                 'team_director', 'project_manager');

-- -----------------------------------------------------------------------------
-- Hook 1 — "Require Meeting"
--
-- Creates a meeting request and parks the design request until it is agreed.
--
-- What this does NOT do is worth more than what it does: it does not negotiate,
-- hold a room, pick recipients or talk to Google. It inserts a row into
-- `requests` of type `meeting_request` with the answers the transition just
-- collected, and everything after that is the Meetings component reacting to
-- an ordinary meeting exactly as it would to one somebody filed by hand.
-- -----------------------------------------------------------------------------

create or replace function app.hook_open_meeting(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r            requests%rowtype;
  v_from       text;
  v_meeting    uuid;
  v_type       uuid;
  v_initial    text;
  v_target_kind    request_target_kind;
  v_target_team    uuid;
  v_target_member  uuid;
begin
  select * into r from requests where id = p_request;

  -- Where it is coming back to. Read from the history row this very move
  -- wrote, which is why `requests_hook_on_transition` is named to sort after
  -- `requests_history_write`.
  select h.from_status into v_from
  from request_status_history h
  where h.request_id = p_request
  order by h.created_at desc, h.id desc
  limit 1;

  update requests
     set data = data || jsonb_build_object('resume_status', v_from)
   where id = p_request;

  /*
   * Who meets whom depends on which side asked, and that is the only thing
   * this hook decides:
   *
   *   from pending_review — the Design Director wants to talk to the person
   *                         who asked, so the target is that person.
   *   from delivered      — the submitter wants to talk to Design, so the
   *                         target is the team that owns this request type.
   */
  if v_from = 'delivered' then
    v_target_kind := 'team';
    select owning_team_id into v_target_team from request_types where id = r.request_type_id;
  else
    v_target_kind := 'individual';
    v_target_member := r.submitted_by;
  end if;

  select id into v_type from request_types where key = 'meeting_request';
  select key into v_initial
  from request_statuses
  where request_type_id = v_type and is_initial;

  insert into requests (
    request_type_id, submitted_by, status,
    target_kind, target_team_id, target_member_id,
    data
  ) values (
    v_type,
    app.current_member_id(),
    v_initial,
    v_target_kind,
    v_target_team,
    v_target_member,
    jsonb_build_object(
      'title', coalesce(nullif(r.data ->> 'meeting_title', ''), 'About a design request'),
      'description', r.data ->> 'meeting_reason',
      'meeting_type', coalesce(r.data ->> 'meeting_type', 'online'),
      'proposed_start', r.data ->> 'proposed_start',
      'proposed_end', r.data ->> 'proposed_end',
      'room_id', r.data ->> 'room_id',
      'proposer_identity', r.data ->> 'proposer_identity'
    )
  )
  returning id into v_meeting;

  -- The one link between the two. From here the Meetings component knows only
  -- "something spawned me"; it never asks what kind of something.
  update meeting_details
     set origin_request_id = p_request
   where request_id = v_meeting;
end;
$$;

insert into request_hooks (name, function_schema, function_name, description)
values (
  'open_meeting',
  'app',
  'hook_open_meeting',
  'Creates a meeting request through the shared Meetings component and parks the origin until it is agreed.'
)
on conflict (name) do update
  set function_schema = excluded.function_schema,
      function_name   = excluded.function_name,
      description     = excluded.description;

-- -----------------------------------------------------------------------------
-- Hook 2 — carry on where we left off
--
-- Called by the Meetings component when a meeting it spawned is confirmed. The
-- request goes back to the status it parked from, which was recorded above.
-- -----------------------------------------------------------------------------

create or replace function app.hook_resume_after_meeting(
  p_origin  uuid,
  p_meeting uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        requests%rowtype;
  v_resume text;
begin
  select * into r from requests where id = p_origin;

  if r.status <> 'awaiting_meeting' then
    return;   -- somebody already moved it on; nothing to do
  end if;

  v_resume := coalesce(nullif(r.data ->> 'resume_status', ''), 'pending_review');

  -- The system is acting, not a person, so the actor rules are waived — but
  -- the move still has to be one the configuration allows. See 0034.
  perform app.system_transition(p_origin, v_resume);
end;
$$;

insert into request_hooks (name, function_schema, function_name, description)
values (
  'resume_after_meeting',
  'app',
  'hook_resume_after_meeting',
  'Returns a parked request to the status it left when its meeting is confirmed.'
)
on conflict (name) do update
  set function_schema = excluded.function_schema,
      function_name   = excluded.function_name,
      description     = excluded.description;

-- -----------------------------------------------------------------------------
-- The type (§7)
--
-- Required Date is the ASK and never changes. Starting Date and Delivery Date
-- are what Design commits to, collected with the move into In Progress — and
-- collected again on every revision cycle, because `required_data_keys` is
-- checked on every transition INTO the status, not once.
-- -----------------------------------------------------------------------------

update request_types
   set field_schema = '[
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
      "label_en":"What do you need, and what are the requirements?",
      "label_ar":"ما المطلوب وما المتطلبات؟"},
     {"key":"project_id","type":"select","required":false,
      "options_source":"projects",
      "label_en":"For a project? (optional)","label_ar":"لمشروع معيّن؟ (اختياري)"}
   ]'::jsonb,
       submit_permission = 'design_requests.submit',
       on_meeting_confirmed_hook = 'resume_after_meeting',
       description_en = 'Ask the Design team for artwork or brand material.',
       description_ar = 'طلب تصميم أو مواد بصرية من فريق التصميم.'
 where key = 'design_request';

-- -----------------------------------------------------------------------------
-- Replacing the flow seeded in 0008
--
-- Not a delete-and-recreate: `requests.status` is a foreign key into
-- `request_statuses`, so a design request already in flight would take the old
-- rows down with it. The order below is the whole trick — make room, add the
-- new statuses, MOVE the live requests onto them, and only then remove what is
-- genuinely unused.
-- -----------------------------------------------------------------------------

-- Transitions first: nothing points at them, and the new set is unrelated.
delete from request_transitions
 where request_type_id = (select id from request_types where key = 'design_request');

-- Only one status per type may be `is_initial`, so the old one has to stand
-- down before the new one can claim it.
update request_statuses
   set is_initial = false
 where request_type_id = (select id from request_types where key = 'design_request');

insert into request_statuses
  (request_type_id, key, name_en, name_ar,
   is_initial, is_terminal, is_approved, sort_order, required_data_keys)
select rt.id, s.key, s.name_en, s.name_ar,
       s.is_initial, s.is_terminal, s.is_approved, s.sort_order, s.required
from request_types rt
cross join (values
  ('pending_review',    'Pending review',    'قيد المراجعة',       true,  false, false, 10, '{}'::text[]),
  ('awaiting_meeting',  'Waiting on a meeting', 'بانتظار اجتماع',  false, false, false, 20, '{}'::text[]),
  -- §7: cannot enter In Progress without BOTH dates. One row, and it holds for
  -- the first acceptance and for every revision cycle afterwards.
  ('in_progress',       'In progress',       'قيد التنفيذ',        false, false, false, 30,
   '{starting_date,delivery_date}'::text[]),
  ('delivered',         'Pending your review', 'بانتظار مراجعتك',  false, false, false, 40, '{}'::text[]),
  ('revision_required', 'Revision required', 'يحتاج تعديلاً',      false, false, false, 50, '{}'::text[]),
  ('approved',          'Approved',          'معتمد',              false, true,  true,  60, '{}'::text[]),
  ('rejected',          'Rejected',          'مرفوض',              false, true,  false, 70, '{}'::text[])
) as s (key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order, required)
where rt.key = 'design_request'
on conflict (request_type_id, key) do update
  set name_en            = excluded.name_en,
      name_ar            = excluded.name_ar,
      is_initial         = excluded.is_initial,
      is_terminal        = excluded.is_terminal,
      is_approved        = excluded.is_approved,
      sort_order         = excluded.sort_order,
      required_data_keys = excluded.required_data_keys;

/*
 * Anything already in flight moves onto the new flow. The old shape was
 * submitted -> under_review -> needs_info -> approved / rejected; all three of
 * the live ones mean "Design has not started yet", which is `pending_review`.
 * The two terminal statuses keep their keys and so need no move.
 *
 * The triggers come off for this one statement, and that is the point rather
 * than a shortcut. `app.validate_request_transition` refuses any move that is
 * not a configured transition, and "submitted -> pending_review" deliberately
 * is not one — it is a schema change, not something a person did. Leaving the
 * triggers on would also write a fictional row into request_status_history
 * saying somebody made that move.
 *
 * `app.system_move` from 0034 is NOT the tool here: it waives who may act, not
 * whether the transition exists.
 */
alter table requests disable trigger user;

update requests
   set status = 'pending_review'
 where request_type_id = (select id from request_types where key = 'design_request')
   and status in ('submitted', 'under_review', 'needs_info');

alter table requests enable trigger user;

-- Now that nothing points at them, the statuses that are not part of the new
-- flow can go.
delete from request_statuses
 where request_type_id = (select id from request_types where key = 'design_request')
   and key not in ('pending_review', 'awaiting_meeting', 'in_progress',
                   'delivered', 'revision_required', 'approved', 'rejected');

-- The questions each move asks. Note there is no separate "meeting form": a
-- Require Meeting transition collects the same answers the meeting request
-- form would, and the hook copies them across.
insert into request_transitions
  (request_type_id, from_status, to_status, actor_rule,
   label_en, label_ar, sort_order, on_transition_hook, field_schema)
select rt.id, t.from_status, t.to_status, t.actor_rule::request_actor_rule,
       t.label_en, t.label_ar, t.sort_order, t.hook, t.fields::jsonb
from request_types rt
cross join (values
  -- Design Director reviewing the ask.
  ('pending_review', 'in_progress', 'target_approver', 'Accept and schedule', 'قبول وتحديد المواعيد', 10, null, '[
     {"key":"starting_date","type":"date","required":true,
      "label_en":"Starting date","label_ar":"تاريخ البدء"},
     {"key":"delivery_date","type":"date","required":true,
      "label_en":"Delivery date","label_ar":"تاريخ التسليم"}
   ]'),
  ('pending_review', 'awaiting_meeting', 'target_approver', 'Require a meeting', 'طلب اجتماع', 20, 'open_meeting', '[
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
     {"key":"proposer_identity","type":"select","required":false,
      "options_source":"booking_identities",
      "label_en":"Booking the room as","label_ar":"حجز القاعة باسم"},
     {"key":"room_id","type":"select","required":false,
      "options_source":"rooms",
      "label_en":"Room (in-person only)","label_ar":"القاعة (للاجتماع الحضوري)"},
     {"key":"proposed_start","type":"datetime","required":true,
      "label_en":"Proposed start","label_ar":"الوقت المقترح"},
     {"key":"proposed_end","type":"datetime","required":false,
      "label_en":"Proposed end","label_ar":"نهاية الوقت المقترح"}
   ]'),
  ('pending_review', 'rejected', 'target_approver', 'Reject', 'رفض', 30, null, '[]'),

  -- Parked. Normally the meeting''s confirmation moves it; these rows are the
  -- way out if the meeting is rejected and it would otherwise sit forever.
  ('awaiting_meeting', 'pending_review', 'target_approver', 'Carry on without the meeting', 'المتابعة دون اجتماع', 10, null, '[]'),
  ('awaiting_meeting', 'delivered', 'requester', 'Back to my review', 'العودة إلى مراجعتي', 20, null, '[]'),

  -- Design doing the work.
  ('in_progress', 'delivered', 'target_approver', 'Submit the design', 'تسليم التصميم', 10, null, '[
     {"key":"design_url","type":"text","required":false,
      "label_en":"Link to the design","label_ar":"رابط التصميم"},
     {"key":"design_file","type":"file","required":false,
      "label_en":"Or attach a file","label_ar":"أو أرفق ملفاً"},
     {"key":"delivery_note","type":"textarea","required":false,
      "label_en":"Anything to say about it?","label_ar":"ملاحظات على التسليم"}
   ]'),

  -- The submitter reviewing the work. This loops as many times as it needs to.
  ('delivered', 'approved', 'requester', 'Approve', 'اعتماد', 10, null, '[]'),
  ('delivered', 'revision_required', 'requester', 'Ask for changes', 'طلب تعديلات', 20, null, '[
     {"key":"revision_comments","type":"textarea","required":true,
      "label_en":"What needs changing?","label_ar":"ما الذي يحتاج تعديلاً؟"}
   ]'),
  ('delivered', 'awaiting_meeting', 'requester', 'Require a meeting', 'طلب اجتماع', 30, 'open_meeting', '[
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
     {"key":"proposer_identity","type":"select","required":false,
      "options_source":"booking_identities",
      "label_en":"Booking the room as","label_ar":"حجز القاعة باسم"},
     {"key":"room_id","type":"select","required":false,
      "options_source":"rooms",
      "label_en":"Room (in-person only)","label_ar":"القاعة (للاجتماع الحضوري)"},
     {"key":"proposed_start","type":"datetime","required":true,
      "label_en":"Proposed start","label_ar":"الوقت المقترح"},
     {"key":"proposed_end","type":"datetime","required":false,
      "label_en":"Proposed end","label_ar":"نهاية الوقت المقترح"}
   ]'),

  -- Back round: new dates required before work can restart (§7).
  ('revision_required', 'in_progress', 'target_approver', 'Re-schedule and continue', 'إعادة الجدولة والمتابعة', 10, null, '[
     {"key":"starting_date","type":"date","required":true,
      "label_en":"New starting date","label_ar":"تاريخ البدء الجديد"},
     {"key":"delivery_date","type":"date","required":true,
      "label_en":"New delivery date","label_ar":"تاريخ التسليم الجديد"}
   ]')
) as t (from_status, to_status, actor_rule, label_en, label_ar, sort_order, hook, fields)
where rt.key = 'design_request';

-- -----------------------------------------------------------------------------
-- Where a delivered file goes
--
-- A private bucket, like profile photos. 10 MB is enough for a proof or a PDF;
-- anything larger is what the link field is for, and saying so is kinder than
-- an upload that fails at the end.
-- -----------------------------------------------------------------------------

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'design-files', 'design-files', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
          'image/svg+xml', 'application/pdf']
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Readable by anyone who can see the request it belongs to. The first path
  -- segment is the request id, and `requests_select` decides the rest — so a
  -- design file is exactly as visible as the request that delivered it.
  drop policy if exists design_files_select on storage.objects;
  create policy design_files_select on storage.objects
    for select using (
      bucket_id = 'design-files'
      and exists (
        select 1 from requests r
        where r.id::text = (storage.foldername(name))[1]
      )
    );

  drop policy if exists design_files_write on storage.objects;
  create policy design_files_write on storage.objects
    for all
    using (
      bucket_id = 'design-files'
      and exists (
        select 1 from requests r
        where r.id::text = (storage.foldername(name))[1]
          and app.can_act_on_request(r.target_team_id, r.target_project_id, r.target_member_id)
      )
    )
    with check (
      bucket_id = 'design-files'
      and exists (
        select 1 from requests r
        where r.id::text = (storage.foldername(name))[1]
          and app.can_act_on_request(r.target_team_id, r.target_project_id, r.target_member_id)
      )
    );
exception
  when insufficient_privilege or undefined_table then
    raise warning
      'Could not configure the `design-files` bucket from SQL (%). Create a PRIVATE bucket of that name in the Supabase dashboard and add the two policies from this migration by hand.',
      sqlerrm;
end
$$;
