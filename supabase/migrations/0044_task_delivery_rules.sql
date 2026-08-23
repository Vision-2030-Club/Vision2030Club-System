-- =============================================================================
-- 0044 — Two bugs the design suite caught, both about who is asking.
--
-- 1. THE LINK GUARD NEVER FIRED.
--
--    `submit_task_for_review` looked up "does this task need a link?" by
--    joining through to the request type. It is not SECURITY DEFINER, so that
--    join ran with the ASSIGNEE's rights — and an assignee usually cannot see
--    the request that produced their task. A plain Member's `requests.view`
--    scope is `own`, and the request was submitted by somebody else.
--
--    So the lookup found no row, the flag stayed false, and work that was
--    supposed to be delivered as a link could be submitted with nothing at all.
--    It failed OPEN, which is the worst way for a check to fail.
--
--    The fix is a SECURITY DEFINER helper: the question "does this task need a
--    link" is about the task's configuration, not about who is looking at it.
--
-- 2. THE SECOND MEETING WAS AIMED AT THE WRONG PERSON.
--
--    `hook_open_meeting` decided who to meet from the status it left. That
--    worked while only the Director could ask. Now either side can (0039), so
--    leaving from the same status means two different conversations, and the
--    submitter asking for a meeting got one aimed at themselves.
--
--    Deciding from WHO IS ACTING is both simpler and right at every checkpoint:
--    you are asking to talk to the other side, whoever you are.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Delivery rules, answered independently of the caller
-- -----------------------------------------------------------------------------

create or replace function app.task_requires_link(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select rt.task_requires_link
    from tasks t
    join requests r        on r.id  = t.source_request_id
    join request_types rt  on rt.id = r.request_type_id
    where t.id = p_task
  ), false)
$$;

create or replace function app.task_needs_new_dates(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select rt.creates_task
    from tasks t
    join requests r        on r.id  = t.source_request_id
    join request_types rt  on rt.id = r.request_type_id
    where t.id = p_task
  ), false)
$$;

grant execute on function app.task_requires_link(uuid) to authenticated;
grant execute on function app.task_needs_new_dates(uuid) to authenticated;

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
  if v_me is null or app.task_assignee(p_task) is distinct from v_me then
    raise exception 'Only the assignee can submit this task for review'
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

grant execute on function public.submit_task_for_review(uuid, text) to authenticated;

create or replace function public.reject_task(
  p_task  uuid,
  p_note  text default null,
  p_start date default null,
  p_due   date default null
)
returns void
language plpgsql
as $$
declare
  v_task tasks;
begin
  if not app.can_confirm_task(p_task) then
    raise exception 'You are not the confirmer for this task'
      using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task;
  if v_task.submitted_at is null then
    raise exception 'This task is not waiting for confirmation'
      using errcode = '42501';
  end if;
  if v_task.confirmed_at is not null or v_task.not_done_at is not null then
    raise exception 'This task is already finished' using errcode = '42501';
  end if;

  -- Only work that came from a request insists on re-dating; an ordinary task
  -- keeps the deadline it always had.
  if app.task_needs_new_dates(p_task) and (p_start is null or p_due is null) then
    raise exception 'Sending this back needs a new starting date and a new delivery date'
      using errcode = '23514';
  end if;

  if p_due is not null and p_start is not null and p_due < p_start then
    raise exception 'The delivery date cannot be before the starting date'
      using errcode = '23514';
  end if;

  perform set_config('app.task_workflow', 'on', true);
  -- Clearing submitted_at is what returns the task to In Progress, and it also
  -- discards the old Completion Date: the next submission sets a fresh one.
  update tasks
     set submitted_at = null,
         rejected_at  = now(),
         review_note  = p_note,
         assigned_at  = coalesce(p_start::timestamptz, assigned_at),
         due_date     = coalesce(p_due, due_date)
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

grant execute on function public.reject_task(uuid, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. A meeting is with the OTHER side
-- -----------------------------------------------------------------------------

create or replace function app.hook_open_meeting(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r               requests%rowtype;
  v_from          text;
  v_meeting       uuid;
  v_type          uuid;
  v_initial       text;
  v_target_kind   request_target_kind;
  v_target_team   uuid;
  v_target_member uuid;
begin
  select * into r from requests where id = p_request;

  -- Where to come back to. Read from the history row this very move wrote,
  -- which is why `requests_hook_on_transition` is named to sort after
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
   * You are asking to talk to the OTHER side. Decided from who is acting
   * rather than from which status we left, because since 0039 either side can
   * ask at the same point — so the status no longer identifies the asker.
   */
  if app.current_member_id() = r.submitted_by then
    -- The submitter wants the team that owns this workflow.
    v_target_kind := 'team';
    select owning_team_id into v_target_team from request_types where id = r.request_type_id;
  else
    -- The reviewer wants the person who asked.
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
      'title', coalesce(nullif(r.data ->> 'meeting_title', ''), 'About a request'),
      'description', r.data ->> 'meeting_reason',
      'meeting_type', coalesce(r.data ->> 'meeting_type', 'online'),
      'proposed_start', r.data ->> 'proposed_start',
      'proposed_end', r.data ->> 'proposed_end',
      'room_id', r.data ->> 'room_id'
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

notify pgrst, 'reload schema';
