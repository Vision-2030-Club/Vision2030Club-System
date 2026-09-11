-- =============================================================================
-- 0050 — Push: work posted for claiming, and the claim itself.
--
-- 0049 hung task notifications off `task_assignees`, so a task nobody holds
-- yet was invisible: §3's whole point is that unclaimed work is POSTED for
-- people to pick up, and nobody was told it existed. Two additions:
--
--   1. A project task inserted with no assignee is announced to exactly the
--      people who may claim it — the split's members when it is scoped to a
--      split, otherwise the project's members. That is `app.can_claim_task`
--      (0017) read backwards, the same way every other recipient rule here
--      is a permission read backwards.
--
--   2. A claim tells the person who posted the task. 0049 was right that
--      claiming is not news to the claimer; it is news to the poster.
--
-- Also fixes a wording slip in 0049: request type names already end in
-- "Request", so "New Meeting Request request" read twice. Now "New request:
-- Meeting Request".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Posted for claiming
--
-- "No assignee" is read from `assigned_at`, not from `task_assignees`: the app
-- inserts the task first and the assignee in a second statement, so at insert
-- time the join table is always empty. `assigned_at` is set in the same
-- insert exactly when somebody is being assigned (tasks/actions.ts), and left
-- null when the task is posted to be claimed.
--
-- Team-level tasks are assigned, never claimed (0017), so they are skipped.
-- -----------------------------------------------------------------------------

create or replace function app.push_on_task_posted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := app.current_member_id();
  rec   record;
begin
  if new.project_id is null or new.assigned_at is not null then
    return null;
  end if;

  for rec in
    select distinct m.member_id
    from (
      select psm.member_id
      from project_split_members psm
      where new.split_id is not null and psm.split_id = new.split_id

      union all

      select pm.member_id
      from project_members pm
      where new.split_id is null and pm.project_id = new.project_id
    ) m
    where m.member_id is distinct from v_me
      and m.member_id is distinct from new.created_by
  loop
    perform app.push_enqueue(
      rec.member_id, 'task_open',
      'Task open to claim', 'مهمة متاحة للاستلام',
      new.title, new.title,
      '/tasks');
  end loop;

  return null;
exception
  when others then
    raise warning 'push_on_task_posted(%) skipped: %', new.id, sqlerrm;
    return null;
end;
$$;

drop trigger if exists tasks_push_posted on tasks;
create trigger tasks_push_posted
  after insert on tasks
  for each row execute function app.push_on_task_posted();

-- -----------------------------------------------------------------------------
-- 2. Claimed — replaces 0049's version, which was silent on a self-claim
-- -----------------------------------------------------------------------------

create or replace function app.push_on_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := app.current_member_id();
  v_task    tasks%rowtype;
  v_claimer members%rowtype;
begin
  select * into v_task from tasks where id = new.task_id;

  if new.member_id is not distinct from v_me then
    -- Taking a task yourself is news to whoever posted it, not to you.
    if v_task.created_by is not null and v_task.created_by is distinct from v_me then
      select * into v_claimer from members where id = v_me;
      perform app.push_enqueue(
        v_task.created_by, 'task_claimed',
        'Task claimed', 'تم استلام المهمة',
        v_claimer.name_en || ' took "' || v_task.title || '".',
        'استلم ' || v_claimer.name_ar || ' «' || v_task.title || '».',
        '/tasks');
    end if;
    return null;
  end if;

  perform app.push_enqueue(
    new.member_id, 'task_assigned',
    'New task for you', 'مهمة جديدة لك',
    v_task.title, v_task.title,
    '/tasks');
  return null;
exception
  when others then
    raise warning 'push_on_task_assigned(%) skipped: %', new.task_id, sqlerrm;
    return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Wording — same function as 0049 §8 with one title changed
-- -----------------------------------------------------------------------------

create or replace function app.push_on_request_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me         uuid := app.current_member_id();
  v_type       request_types%rowtype;
  v_status     request_statuses%rowtype;
  v_submitter  members%rowtype;
  v_url        text := '/requests/' || new.id;
  v_tz         text;
  v_when       text;
  v_title      text;
  rec          record;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;   -- payload edit, not a move
  end if;

  select * into v_type      from request_types    where id = new.request_type_id;
  select * into v_status    from request_statuses
    where request_type_id = new.request_type_id and key = new.status;
  select * into v_submitter from members           where id = new.submitted_by;

  if tg_op = 'INSERT' then
    for rec in
      select a.member_id from app.request_actors(new.id) a
      where a.member_id <> new.submitted_by
    loop
      perform app.push_enqueue(
        rec.member_id, 'request_submitted',
        'New request: ' || v_type.name_en,
        'طلب جديد: ' || v_type.name_ar,
        v_submitter.name_en || ' submitted a request that needs your action.',
        'قدّم ' || v_submitter.name_ar || ' طلبًا بانتظار إجراءك.',
        v_url);
    end loop;
    return null;
  end if;

  -- A confirmed meeting is news to everyone in it, not only the requester.
  -- The submitter is always among the recipients (0029), so the generic
  -- "your request moved" message is skipped rather than sent twice.
  if v_status.is_approved
     and exists (select 1 from meeting_details where request_id = new.id) then
    select time_zone into v_tz from booking_settings limit 1;
    v_when  := to_char(app.meeting_start(new.data) at time zone coalesce(v_tz, 'Asia/Riyadh'),
                       'DD/MM HH24:MI');
    v_title := coalesce(nullif(new.data ->> 'title', ''), v_type.name_en);

    for rec in
      select m.member_id from app.meeting_recipients(new.id) m
      where m.member_id is distinct from v_me
    loop
      perform app.push_enqueue(
        rec.member_id, 'meeting_confirmed',
        'Meeting confirmed', 'تم تأكيد الاجتماع',
        v_title || ' — ' || v_when,
        v_title || ' — ' || v_when,
        '/calendar');
    end loop;

  elsif new.submitted_by is distinct from v_me then
    perform app.push_enqueue(
      new.submitted_by, 'request_moved',
      v_type.name_en || ': ' || v_status.name_en,
      v_type.name_ar || ': ' || v_status.name_ar,
      'Your request is now "' || v_status.name_en || '".',
      'أصبحت حالة طلبك: ' || v_status.name_ar || '.',
      v_url);
  end if;

  -- Whoever can make the next move, unless there is none. The requester was
  -- told above if it is them.
  if not v_status.is_terminal then
    for rec in
      select a.member_id from app.request_actors(new.id) a
      where a.member_id is distinct from v_me
        and a.member_id <> new.submitted_by
    loop
      perform app.push_enqueue(
        rec.member_id, 'request_awaiting',
        v_type.name_en || ' awaiting you',
        v_type.name_ar || ' بانتظارك',
        v_submitter.name_en || '''s request is now "' || v_status.name_en || '" and needs your action.',
        'طلب ' || v_submitter.name_ar || ' أصبح «' || v_status.name_ar || '» ويحتاج إجراءك.',
        v_url);
    end loop;
  end if;

  return null;
exception
  -- A notification is never worth more than the change it is about. If
  -- anything in here breaks, the request still moves; the warning is in the
  -- log and the phone is simply not told.
  when others then
    raise warning 'push_on_request_change(%) skipped: %', new.id, sqlerrm;
    return null;
end;
$$;
