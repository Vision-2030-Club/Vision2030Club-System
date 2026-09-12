-- =============================================================================
-- 0057 — What the first round of real testing decided.
--
-- The IT team used the system for an afternoon and sent fifteen comments.
-- Read against the database they had produced, the comments split into bugs
-- with one right answer and questions with several; the latter were put to
-- the club and answered. This file holds every database-side consequence of
-- both, in the order the comments came:
--
--   A. A Director sees their own team's tasks, not the club's.
--      `tasks.view` for team_director was seeded as `all` (0004) — a Finance
--      Director had Design's tasks on their board. Now `own_team`; project
--      tasks still reach them where they are on the project (tasks_select
--      already ORs is_on_project / is_on_split / is_task_assignee).
--
--   B. Directors do not run projects. `projects.manage` for team_director
--      goes from `own_team` to `none`: projects are created by the Presidency
--      and run by their Project Managers. (This also retires the bug where a
--      Director could create a project but never add a split to it, because
--      project_splits_write passed no p_team — moot once nobody's project
--      authority is team-scoped.)
--
--   C. Members do not ask for meetings. The meeting request gains a submit
--      permission held by Club Management, the same group that may submit
--      Content, Media and Design requests. A Member can still be the person
--      a meeting is aimed at. (This also retires "we could not work out which
--      group is booking this room": only people who may book a room can now
--      propose one.)
--
--   D. A meeting has a start and a length, never an end typed by hand. The
--      testers produced ends before starts and ends in 2016, and the two
--      constraints that caught them answered with their own names. The
--      direct Room Booking page already only offers 30 minutes or 1 hour
--      (0026); the meeting request and every counter-offer now do the same.
--      `proposed_start` is marked `no_past`; the app refuses a past start on
--      the club's clock.
--
--   E. A task can be held by more than one person. `task_assignees` always
--      allowed it (0005); what changes here is what depended on there being
--      one: the confirm-task self-exclusion checked only the FIRST assignee,
--      and the project/split KPI counted a task once per assignee. Each
--      assignee is scored in their own KPI, as the club chose; a project
--      counts the task once.
--
--   F. `assignable_members` (0040) returned nobody for a Project Manager —
--      it only passed p_team, and a PM's scope is own_projects. Same shape
--      as the split bug in B. Members of a project the caller manages are
--      now offered.
--
--   G. Experience cannot start or end in the future.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Directors see their own team's tasks
-- -----------------------------------------------------------------------------

update role_permissions rp
   set scope = 'own_team'
  from roles r
 where r.id = rp.role_id
   and r.key = 'team_director'
   and rp.permission_key = 'tasks.view';

-- -----------------------------------------------------------------------------
-- B. Directors do not run projects
-- -----------------------------------------------------------------------------

update role_permissions rp
   set scope = 'none'
  from roles r
 where r.id = rp.role_id
   and r.key = 'team_director'
   and rp.permission_key = 'projects.manage';

-- -----------------------------------------------------------------------------
-- C. Who may ask for a meeting
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('meeting_requests.submit',
   'Ask for a meeting with a team, a project, the Presidency, or a person',
   'طلب اجتماع مع فريق أو مشروع أو الرئاسة أو شخص')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

insert into role_permissions (role_id, permission_key, scope)
select r.id, 'meeting_requests.submit', 'none'::permission_scope
from roles r
on conflict (role_id, permission_key) do nothing;

update role_permissions rp
   set scope = 'all'
  from roles r
 where r.id = rp.role_id
   and rp.permission_key = 'meeting_requests.submit'
   and r.key in ('super_admin', 'president', 'vice_president',
                 'team_director', 'project_manager');

update request_types
   set submit_permission = 'meeting_requests.submit'
 where key = 'meeting_request';

-- -----------------------------------------------------------------------------
-- D. A start and a length
-- -----------------------------------------------------------------------------

-- Prefers the length; still honours a `proposed_end` already sitting in an
-- in-flight request from before today.
create or replace function app.meeting_end(p_data jsonb)
returns timestamptz
language sql
immutable
as $$
  select coalesce(
    app.meeting_start(p_data)
      + make_interval(mins => nullif(p_data ->> 'duration_minutes', '')::int),
    nullif(p_data ->> 'proposed_end', '')::timestamptz,
    app.meeting_start(p_data) + interval '1 hour'
  )
$$;

-- Swaps one field for another in place, so the form keeps its order.
create or replace function app.field_replace(
  p_schema    jsonb,
  p_old_key   text,
  p_new_field jsonb
)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (select jsonb_agg(
       case when f ->> 'key' = p_old_key then p_new_field else f end
       order by o)
     from jsonb_array_elements(p_schema) with ordinality as x (f, o)),
    p_schema)
$$;

update request_types
   set field_schema = app.field_replace(field_schema, 'proposed_end', '{
     "key":"duration_minutes","type":"select","required":true,
     "label_en":"Duration","label_ar":"المدة",
     "options":[
       {"value":"30","label_en":"30 minutes","label_ar":"٣٠ دقيقة"},
       {"value":"60","label_en":"1 hour","label_ar":"ساعة واحدة"}
     ]
   }'::jsonb)
 where field_schema @> '[{"key": "proposed_end"}]'::jsonb;

update request_transitions
   set field_schema = app.field_replace(field_schema, 'proposed_end', '{
     "key":"duration_minutes","type":"select","required":true,
     "label_en":"Duration","label_ar":"المدة",
     "options":[
       {"value":"30","label_en":"30 minutes","label_ar":"٣٠ دقيقة"},
       {"value":"60","label_en":"1 hour","label_ar":"ساعة واحدة"}
     ]
   }'::jsonb)
 where field_schema @> '[{"key": "proposed_end"}]'::jsonb;

-- No past starts — the marker the form and the action both read.
update request_types
   set field_schema = (
     select jsonb_agg(
       case when f ->> 'key' = 'proposed_start' then f || '{"no_past": true}'::jsonb
            else f end
       order by o)
     from jsonb_array_elements(field_schema) with ordinality as x (f, o))
 where field_schema @> '[{"key": "proposed_start"}]'::jsonb;

update request_transitions
   set field_schema = (
     select jsonb_agg(
       case when f ->> 'key' = 'proposed_start' then f || '{"no_past": true}'::jsonb
            else f end
       order by o)
     from jsonb_array_elements(field_schema) with ordinality as x (f, o))
 where field_schema @> '[{"key": "proposed_start"}]'::jsonb;

-- The template the "require a meeting first" checkpoints are stamped from
-- (0041, 0054), so the next type to use it gets the same shape.
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
     "show_when":{"key":"meeting_type","value":"in_person"},
     "label_en":"Room","label_ar":"القاعة"},
    {"key":"proposed_start","type":"datetime","required":true,
     "no_past":true,
     "label_en":"Proposed start","label_ar":"الوقت المقترح"},
    {"key":"duration_minutes","type":"select","required":true,
     "label_en":"Duration","label_ar":"المدة",
     "options":[
       {"value":"30","label_en":"30 minutes","label_ar":"٣٠ دقيقة"},
       {"value":"60","label_en":"1 hour","label_ar":"ساعة واحدة"}
     ]}
  ]'::jsonb
$$;

-- -----------------------------------------------------------------------------
-- E. More than one person on a task
--
-- 0012 made "one assignee per task" a rule in three places: a unique index,
-- and two checks that read THE assignee (`app.task_assignee`) and compared it
-- to the caller. The index goes; the checks become "is the caller among the
-- assignees" (`app.is_task_assignee`, 0014), which is what they meant.
-- -----------------------------------------------------------------------------

drop index if exists task_assignees_one_per_task;

-- Any assignee may submit the work.
create or replace function public.submit_task_for_review(
  p_task uuid,
  p_url  text default null
)
returns void
language plpgsql
as $$
declare
  v_task tasks;
  v_me   uuid := app.current_member_id();
begin
  if v_me is null or not app.is_task_assignee(p_task) then
    raise exception 'Only an assignee can submit this task for review'
      using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task;

  if v_task.confirmed_at is not null or v_task.not_done_at is not null then
    raise exception 'This task is already finished' using errcode = '42501';
  end if;
  if v_task.submitted_at is not null then
    raise exception 'This task is already waiting for confirmation'
      using errcode = '42501';
  end if;

  if app.task_requires_link(p_task)
     and nullif(btrim(coalesce(p_url, '')), '') is null then
    raise exception 'This task is delivered as a link. Paste the URL to the file or folder.'
      using errcode = '23514';
  end if;

  perform set_config('app.task_workflow', 'on', true);
  update tasks
     set submitted_at   = now(),
         rejected_at    = null,
         review_note    = null,
         submission_url = coalesce(nullif(btrim(coalesce(p_url, '')), ''), submission_url)
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

-- No assignee confirms their own work — checked against all of them, not
-- the first. With two on a task, the second used to get through.
create or replace function app.can_confirm_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.can_administer_task(p_task)
     and not app.is_task_assignee(p_task)
$$;

-- §8 on the grade: none of the assignees sees it; a confirmer, or anyone
-- who may view the KPI of any of them, does.
create or replace function app.can_view_task_score(p_task uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if app.is_task_assignee(p_task) then
    return false;
  end if;
  return app.can_administer_task(p_task)
      or exists (
        select 1 from task_assignees ta
        where ta.task_id = p_task
          and app.can_view_kpi_for_member(ta.member_id)
      );
end;
$$;

-- task_kpi is one row per (task, assignee) on purpose — that is how each
-- person is scored. A PROJECT is not scored per person: it counts the task
-- once, whoever and however many hold it.
create or replace view public.project_kpi
with (security_invoker = on) as
select
  p.id as project_id,
  count(k.id)                                                          as total_tasks,
  count(*) filter (where k.counts_toward_kpi)                          as scored_tasks,
  count(*) filter (where k.state = 'completed')                        as completed_tasks,
  count(*) filter (where k.state = 'not_done')                         as not_done_tasks,
  count(*) filter (where k.is_delayed)                                 as delayed_tasks,
  count(*) filter (where k.risk = 'high')                              as high_risk_tasks,
  count(*) filter (where k.risk = 'overdue')                           as overdue_tasks,
  round(avg(k.overall_score) filter (where k.counts_toward_kpi), 1)    as completion_pct,
  case
    when count(*) filter (where k.risk = 'high') >= 3 then 'at_risk'
    when count(*) filter (where k.is_delayed)
       > count(*) filter (where k.state = 'completed') then 'needs_attention'
    else 'on_track'
  end::project_health as health
from projects p
left join (select distinct on (id) * from public.task_kpi order by id, assignee_id) k
  on k.project_id = p.id
where app.can_view_kpi_for_project(p.id)
group by p.id;

create or replace view public.project_split_kpi
with (security_invoker = on) as
select
  s.id   as split_id,
  s.project_id,
  s.name,
  count(k.id)                                                       as total_tasks,
  count(*) filter (where k.state = 'completed')                     as completed_tasks,
  count(*) filter (where k.state = 'not_done')                      as not_done_tasks,
  count(*) filter (where k.is_delayed)                              as delayed_tasks,
  count(*) filter (where k.risk = 'high')                           as high_risk_tasks,
  count(*) filter (where k.risk = 'overdue')                        as overdue_tasks,
  round(avg(k.overall_score) filter (where k.counts_toward_kpi), 1) as completion_pct,
  case
    when count(*) filter (where k.risk = 'high') >= 3 then 'at_risk'
    when count(*) filter (where k.is_delayed)
       > count(*) filter (where k.state = 'completed') then 'needs_attention'
    else 'on_track'
  end::project_health as health
from project_splits s
left join (select distinct on (id) * from public.task_kpi order by id, assignee_id) k
  on k.split_id = s.id
where app.can_view_kpi_for_project(s.project_id)
group by s.id, s.project_id, s.name;

-- -----------------------------------------------------------------------------
-- F. A Project Manager can be offered someone to assign
-- -----------------------------------------------------------------------------

create or replace view public.assignable_members
with (security_invoker = on) as
select m.id, m.name_en, m.name_ar
from members m
where m.status = 'active'
  and (
    app.can('tasks.manage', p_team => m.team_id)
    or exists (
      select 1
      from project_members pm
      join project_managers own on own.project_id = pm.project_id
      where pm.member_id = m.id
        and own.member_id = app.current_member_id()
    )
  );

-- -----------------------------------------------------------------------------
-- G. Experience is in the past
--
-- On the club's date, not the server's: `current_date` is UTC in production,
-- three hours behind Riyadh after midnight — the same trap 0027 was written
-- for. The app says it in a sentence first (members/actions.ts); this is the
-- backstop.
-- -----------------------------------------------------------------------------

alter table member_experience
  drop constraint if exists member_experience_not_future;

alter table member_experience
  add constraint member_experience_not_future
  check (
    started_on <= (now() at time zone 'Asia/Riyadh')::date
    and (ended_on is null or ended_on <= (now() at time zone 'Asia/Riyadh')::date)
  );

notify pgrst, 'reload schema';
