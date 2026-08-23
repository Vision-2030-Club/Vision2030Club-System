-- =============================================================================
-- 0040 — Three things the task capability needs before Design and Media can
--        use it.
--
--   1. Teaching the transition trigger about `either`, the actor rule 0039
--      added.
--   2. A floor for a task's due date, so Media coverage cannot be due before
--      the event it covers.
--   3. A picker of people the Director may actually hand the work to.
--
-- All three are mechanisms. The configuration that uses them is 0041.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `either` — a move both sides of a request may make
--
-- §2 wants either side to be able to ask for a meeting before the delivered
-- work is confirmed or rejected. The other three rules each name one side.
-- -----------------------------------------------------------------------------

create or replace function app.validate_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule         request_actor_rule;
  v_perm         text;
  v_status       request_statuses%rowtype;
  v_key          text;
  v_missing      text[] := '{}';
  v_system       boolean;
  v_is_requester boolean;
  v_is_approver  boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select t.actor_rule, t.required_permission
    into v_rule, v_perm
  from request_transitions t
  where t.request_type_id = new.request_type_id
    and t.from_status = old.status
    and t.to_status = new.status;

  if not found then
    raise exception 'Status change % -> % is not allowed for this request type',
      old.status, new.status
      using errcode = '23514';
  end if;

  v_system := coalesce(current_setting('app.system_move', true), '') = 'on';

  if not v_system then
    v_is_requester := new.submitted_by is not distinct from app.current_member_id();
    v_is_approver  := app.can_act_on_request(new.target_team_id, new.target_project_id,
                                             new.target_member_id);

    if v_rule = 'requester' then
      if not v_is_requester then
        raise exception 'Only the person who submitted this request can do that'
          using errcode = '42501';
      end if;

    elsif v_rule = 'target_approver' then
      if not v_is_approver then
        raise exception 'You are not an approver for this request''s target'
          using errcode = '42501';
      end if;

    elsif v_rule = 'either' then
      if not (v_is_requester or v_is_approver) then
        raise exception 'Only the two sides of this request can do that'
          using errcode = '42501';
      end if;

    elsif v_rule = 'permission' then
      if not app.can(v_perm,
                     p_team    => new.target_team_id,
                     p_project => new.target_project_id,
                     p_owner   => new.submitted_by) then
        raise exception 'That change requires the % permission', v_perm
          using errcode = '42501';
      end if;
    end if;
  end if;

  select * into v_status
  from request_statuses s
  where s.request_type_id = new.request_type_id and s.key = new.status;

  -- Void first: arriving somewhere is what makes these untrue.
  if array_length(v_status.clears_data_keys, 1) > 0 then
    foreach v_key in array v_status.clears_data_keys loop
      new.data := new.data - v_key;
    end loop;
  end if;

  -- Required data is checked for everybody, the system included.
  if array_length(v_status.required_data_keys, 1) > 0 then
    foreach v_key in array v_status.required_data_keys loop
      if nullif(btrim(coalesce(new.data ->> v_key, '')), '') is null then
        v_missing := v_missing || v_key;
      end if;
    end loop;

    if array_length(v_missing, 1) > 0 then
      raise exception 'This step needs: %', array_to_string(v_missing, ', ')
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. A floor for the due date
--
-- Media coverage cannot be delivered before the event it covers. That is a
-- fact about the request's own answers, so it is configuration — name the data
-- key the due date may not precede — rather than a branch in the hook asking
-- "is this a media request?".
--
-- Worth recording why the due date is NOT simply the event date, which was the
-- first proposal: Completion is scored by comparing submission to the due
-- date, and edited photos always land after the shoot. Pinning the deadline to
-- the event would have scored every coverage task Late, permanently, through
-- nobody's fault.
-- -----------------------------------------------------------------------------

alter table request_types
  add column if not exists task_due_not_before_key text;

comment on column request_types.task_due_not_before_key is
  'A data key the task''s due date may not fall before. Media sets it to
   event_date: the deliverable cannot be due before the event has happened.';

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

  -- Assigned outright, or left for the team to claim (§1). Assigning to
  -- yourself is an ordinary assignment; nothing special about it.
  if v_assignee is not null then
    insert into task_assignees (task_id, member_id) values (v_task, v_assignee);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Who the Director may hand the work to
--
-- `app.can('tasks.manage', p_team => …)` already knows: a Director's scope is
-- their own team, the Presidency's is everything. So the picker cannot offer
-- somebody the task policies would then refuse — and it includes the Director
-- themself, which §1 says is an ordinary assignment.
-- -----------------------------------------------------------------------------

create or replace view public.assignable_members
with (security_invoker = on) as
select m.id, m.name_en, m.name_ar
from members m
where m.status = 'active'
  and app.can('tasks.manage', p_team => m.team_id);

comment on view public.assignable_members is
  'Active members the CALLER may assign a task to. security_invoker = on, so
   it answers for whoever is asking.';

grant select on public.assignable_members to authenticated;
