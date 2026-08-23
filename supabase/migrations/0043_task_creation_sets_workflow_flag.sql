-- =============================================================================
-- 0043 — Creating a task from a request has to announce itself.
--
-- Found by `npm run db:design`: accepting a Design Request failed with
--
--   "Task progress is changed through claim_task / submit_task_for_review /
--    confirm_task / reject_task / mark_task_not_done, not by writing these
--    columns"
--
-- `tasks_enforce_workflow` is BEFORE **INSERT OR UPDATE**, not update only. So
-- an INSERT that sets `assigned_at` — which is exactly what §1 asks for, since
-- Assigned Date = the Starting Date — trips the same guard that stops somebody
-- PATCHing progress onto a task they do not own.
--
-- The guard is right and the hook was wrong: it is a legitimate workflow
-- writer, so it signals itself the way every other one does. Loosening the
-- trigger to ignore inserts would have opened the column to anyone able to
-- create a task.
-- =============================================================================

create or replace function app.hook_create_task_from_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          requests%rowtype;
  t          request_types%rowtype;
  v_task     uuid;
  v_start    date;
  v_due      date;
  v_floor    date;
  v_key      text;
  v_assignee uuid;
begin
  select * into r from requests where id = p_request;
  select * into t from request_types where id = r.request_type_id;

  if not t.creates_task then
    return;
  end if;

  -- One request, one task (§1). A second accept after a rejection must not
  -- spawn a rival.
  if exists (select 1 from tasks where source_request_id = p_request) then
    return;
  end if;

  v_start := nullif(btrim(coalesce(r.data ->> t.task_start_date_key, '')), '')::date;

  -- The first declared key that actually has a value.
  foreach v_key in array t.task_due_date_keys loop
    v_due := nullif(btrim(coalesce(r.data ->> v_key, '')), '')::date;
    exit when v_due is not null;
  end loop;

  if v_start is null or v_due is null then
    raise exception 'This step needs both a starting date and a delivery date'
      using errcode = '23514';
  end if;

  if v_due < v_start then
    raise exception 'The delivery date cannot be before the starting date'
      using errcode = '23514';
  end if;

  if t.task_due_not_before_key is not null then
    v_floor := nullif(btrim(coalesce(r.data ->> t.task_due_not_before_key, '')), '')::date;
    if v_floor is not null and v_due < v_floor then
      raise exception 'The delivery date cannot be before %', v_floor
        using errcode = '23514';
    end if;
  end if;

  v_assignee := nullif(btrim(coalesce(r.data ->> 'assignee_id', '')), '')::uuid;

  /*
   * The task belongs to the team that DOES the work — the type's owning team —
   * not to any project the request happens to name. The person designing the
   * poster is on Design, so it is Design's numbers that move. The project link
   * stays on the request as context.
   */
  perform set_config('app.task_workflow', 'on', true);

  insert into tasks (
    title, description, team_id, due_date, created_by, source_request_id, assigned_at
  ) values (
    coalesce(nullif(r.data ->> 'title', ''), t.name_en),
    r.data ->> 'details',
    t.owning_team_id,
    v_due,
    app.current_member_id(),
    p_request,
    -- §1: Assigned Date = Starting Date. Set even when nobody is assigned yet,
    -- because it is when the work is meant to START, not when it was picked up.
    v_start::timestamptz
  )
  returning id into v_task;

  perform set_config('app.task_workflow', '', true);

  -- Assigned outright, or left for the team to claim (§1). Assigning to
  -- yourself is an ordinary assignment; nothing special about it.
  if v_assignee is not null then
    insert into task_assignees (task_id, member_id) values (v_task, v_assignee);
  end if;
end;
$$;

/*
 * PostgREST caches every function signature it can see. 0038 replaced
 * submit_task_for_review, reject_task and claim_task with new argument lists,
 * and until the cache is told, calls come back as PGRST202 "no function with
 * those parameters" — which reads like the migration never ran.
 */
notify pgrst, 'reload schema';
