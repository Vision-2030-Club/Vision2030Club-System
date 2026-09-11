-- =============================================================================
-- 0049 — Push notifications.
--
-- Two tables and the triggers that fill one of them.
--
--   `push_subscriptions`   one row per DEVICE a member turned notifications
--                          on from. A member manages their own rows and
--                          nobody else's; the server reads them with the
--                          service role when it delivers.
--
--   `notification_outbox`  what is waiting to be pushed. The database never
--                          talks to Apple: a trigger that made a network call
--                          would hold its transaction open for the length of
--                          that call, and an outage would turn into "you
--                          cannot approve this request". Same reasoning as
--                          the Meet link (0032). So the rules that already
--                          decide WHO a change concerns write a row here, and
--                          src/lib/push.ts sends it afterwards.
--
-- The recipient rules are derived from the permission map, not from role
-- names: "who can act on this request next" is the inverse of app.can for
-- the transitions leaving its status. A role rename or a scope change moves
-- the notifications with it, which is the whole point of enforcing in data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Devices
-- -----------------------------------------------------------------------------

create table push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members (id) on delete cascade,

  -- The push service URL Apple (or Chrome) handed the browser. Unique by
  -- construction; it IS the device as far as we can tell.
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,

  -- The language the person was using when they turned notifications on,
  -- refreshed every time the app opens. The text is rendered per device, so
  -- a phone in Arabic and an iPad in English each read their own.
  locale        text not null default 'ar' check (locale in ('ar', 'en')),
  user_agent    text,

  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index push_subscriptions_member_idx on push_subscriptions (member_id);

comment on table push_subscriptions is
  'One row per device that turned push notifications on. Deleted the moment
   the push service says the subscription is gone (404/410), which is what
   happens when someone removes the app from their Home Screen.';

alter table push_subscriptions enable row level security;

create policy push_subscriptions_select on push_subscriptions
  for select using (member_id = (select app.current_member_id()));

create policy push_subscriptions_insert on push_subscriptions
  for insert with check (member_id = (select app.current_member_id()));

create policy push_subscriptions_update on push_subscriptions
  for update
  using (member_id = (select app.current_member_id()))
  with check (member_id = (select app.current_member_id()));

create policy push_subscriptions_delete on push_subscriptions
  for delete using (member_id = (select app.current_member_id()));

grant select, insert, update, delete on push_subscriptions to authenticated;

-- -----------------------------------------------------------------------------
-- 2. The outbox
--
-- RLS on, no policies: like `google_credentials`, only the service role and
-- the trigger functions (which run as the table owner) can touch it. Nobody
-- reads their own notifications back — the phone already showed them.
-- -----------------------------------------------------------------------------

create table notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id) on delete cascade,

  -- A short machine name for what happened, e.g. 'request_submitted'. Not
  -- shown; it is there so a future preference screen can filter by it.
  kind        text not null,

  title_en    text not null,
  title_ar    text not null,
  body_en     text not null,
  body_ar     text not null,

  -- Path inside the app (without the locale prefix) the tap opens.
  url         text not null default '/dashboard',

  -- Set for anything that could legitimately be produced twice — a reminder
  -- sweep running again for the same meeting — so it is written once.
  dedupe_key  text unique,

  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  attempts    integer not null default 0,
  delivered   integer not null default 0,
  last_error  text
);

create index notification_outbox_pending_idx
  on notification_outbox (created_at)
  where sent_at is null;

comment on table notification_outbox is
  'Notifications waiting to be pushed, written by triggers and drained by
   src/lib/push.ts. A row is marked sent once every device of the member was
   tried; it is deleted a week later.';

alter table notification_outbox enable row level security;

-- -----------------------------------------------------------------------------
-- 3. Writing a row
--
-- Returns true when a row was actually written. Nothing is written for a
-- member who has no device turned on: the outbox is a delivery queue, not an
-- inbox, so a row nobody could receive is just noise to prune.
-- -----------------------------------------------------------------------------

create or replace function app.push_enqueue(
  p_member      uuid,
  p_kind        text,
  p_title_en    text,
  p_title_ar    text,
  p_body_en     text,
  p_body_ar     text,
  p_url         text,
  p_dedupe_key  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_member is null then
    return false;
  end if;

  if not exists (
    select 1
    from push_subscriptions s
    join members m on m.id = s.member_id
    where s.member_id = p_member
      and m.status <> 'inactive'
  ) then
    return false;
  end if;

  insert into notification_outbox
    (member_id, kind, title_en, title_ar, body_en, body_ar, url, dedupe_key)
  values
    (p_member, p_kind, p_title_en, p_title_ar, p_body_en, p_body_ar,
     coalesce(p_url, '/dashboard'), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id is not null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Who holds a permission over a target — app.can, run backwards.
--
-- app.can answers "may THIS person do it?"; a notification needs "WHO may do
-- it?". Same scope rules, same team overrides, read from the other side.
--
-- `tier` lets a caller prefer the narrowest authority: the target team's own
-- Directors (2) before everyone whose scope is `all` (3). Without that, the
-- President would be told about every team-level request in the club, which
-- is the kind of thing that makes people turn notifications off.
-- -----------------------------------------------------------------------------

create or replace function app.members_who_can(
  p_permission  text,
  p_team        uuid,
  p_project     uuid,
  p_owner       uuid
)
returns table (member_id uuid, tier integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scoped as (
    select
      m.id,
      m.team_id,
      coalesce(o.scope, rp.scope, 'none'::permission_scope) as scope
    from members m
    left join role_permission_team_overrides o
      on o.role_id = m.role_id
     and o.team_id = m.team_id
     and o.permission_key = p_permission
    left join role_permissions rp
      on rp.role_id = m.role_id
     and rp.permission_key = p_permission
    where m.status = 'active'
      and p_permission is not null
  )
  select s.id, 1
  from scoped s
  where s.scope = 'own' and p_owner is not null and s.id = p_owner

  union all

  select s.id, 2
  from scoped s
  where (s.scope = 'own_team' and p_team is not null and s.team_id = p_team)
     or (s.scope = 'own_projects' and p_project is not null
         and exists (
           select 1 from project_managers pm
           where pm.project_id = p_project and pm.member_id = s.id
         ))

  union all

  select s.id, 3
  from scoped s
  where s.scope = 'all'
$$;

-- -----------------------------------------------------------------------------
-- 5. Who can make the next move on a request
--
-- Reads the transitions leaving the request's CURRENT status and turns each
-- actor rule into people. An individual target is its own approver (0029).
-- Only the narrowest tier is returned — see members_who_can.
-- -----------------------------------------------------------------------------

create or replace function app.request_actors(p_request uuid)
returns table (member_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with r as (
    select * from requests where id = p_request
  ),
  moves as (
    select t.actor_rule, t.required_permission
    from r
    join request_transitions t
      on t.request_type_id = r.request_type_id
     and t.from_status = r.status
  ),
  candidates as (
    -- The requester's own moves.
    select r.submitted_by as member_id, 1 as tier
    from r
    where exists (select 1 from moves where actor_rule in ('requester', 'either'))

    union all

    -- A request aimed at one person is answered by that person.
    select r.target_member_id, 1
    from r
    where r.target_member_id is not null
      and exists (select 1 from moves where actor_rule in ('target_approver', 'either'))

    union all

    select w.member_id, w.tier
    from r
    cross join lateral app.members_who_can(
      'requests.approve', r.target_team_id, r.target_project_id, r.submitted_by
    ) w
    where r.target_member_id is null
      and exists (select 1 from moves where actor_rule in ('target_approver', 'either'))

    union all

    select w.member_id, w.tier
    from r
    join moves on moves.actor_rule = 'permission'
    cross join lateral app.members_who_can(
      moves.required_permission, r.target_team_id, r.target_project_id, r.submitted_by
    ) w
  )
  select distinct c.member_id
  from candidates c
  where c.tier = (select min(tier) from candidates)
$$;

-- -----------------------------------------------------------------------------
-- 6. Who reviews a task — the inverse of app.can_administer_task (0012)
--
-- Project work is confirmed by the project's managers; team work by whoever
-- holds tasks.confirm over the ASSIGNEE's team (falling back to the task's
-- own team while nobody is assigned). The assignees themselves are never
-- their own reviewers.
-- -----------------------------------------------------------------------------

create or replace function app.task_reviewers(p_task uuid)
returns table (member_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with t as (
    select * from tasks where id = p_task
  ),
  assignee_team as (
    select m.team_id
    from task_assignees ta
    join members m on m.id = ta.member_id
    where ta.task_id = p_task
    limit 1
  ),
  w as (
    select mw.member_id, mw.tier
    from t
    cross join lateral app.members_who_can(
      'tasks.confirm',
      case when t.project_id is null
           then coalesce((select team_id from assignee_team), t.team_id) end,
      t.project_id,
      null
    ) mw
  )
  select distinct w.member_id
  from w
  where w.tier = (select min(tier) from w)
    and w.member_id not in (select ta.member_id from task_assignees ta where ta.task_id = p_task)
$$;

-- -----------------------------------------------------------------------------
-- 7. Who a calendar entry is for — app.audience_matches (0007), run backwards
-- -----------------------------------------------------------------------------

create or replace function app.entry_recipients(p_entry uuid)
returns table (member_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct m.id
  from calendar_entries e
  join members m on m.status = 'active'
  left join calendar_entry_audiences a on a.entry_id = e.id
  where e.id = p_entry
    and (
      -- Club entries are for everyone signed in, exactly as the select
      -- policy reads them.
      e.kind = 'club'
      or a.audience_kind = 'all_members'
      or (a.audience_kind = 'team' and m.team_id = a.team_id)
      or (a.audience_kind = 'individual' and m.id = a.member_id)
      or (a.audience_kind = 'project' and (
            exists (select 1 from project_members pm
                     where pm.project_id = a.project_id and pm.member_id = m.id)
         or exists (select 1 from project_managers pg
                     where pg.project_id = a.project_id and pg.member_id = m.id)))
      or (a.audience_kind in ('presidency', 'directors', 'club_management')
          and exists (select 1 from calendar_audience_roles car
                       where car.audience_kind = a.audience_kind
                         and car.role_id = m.role_id))
    )
$$;

-- -----------------------------------------------------------------------------
-- 8. Requests: submitted, moved, confirmed
--
-- Named to sort AFTER requests_hook_on_transition, for the same reason that
-- one sorts after requests_history_write (0034): by the time this runs, every
-- consequence of the move has been written.
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
        'New ' || v_type.name_en || ' request',
        'طلب ' || v_type.name_ar || ' جديد',
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
        v_type.name_en || ' request awaiting you',
        'طلب ' || v_type.name_ar || ' بانتظارك',
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

drop trigger if exists requests_push_notify on requests;
create trigger requests_push_notify
  after insert or update on requests
  for each row execute function app.push_on_request_change();

-- -----------------------------------------------------------------------------
-- 9. Tasks: assigned, submitted, confirmed, returned, not done
--
-- The task workflow is a set of timestamps (0038/0042), not the status enum,
-- so each event is "this column went from null to set".
-- -----------------------------------------------------------------------------

create or replace function app.push_on_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task tasks%rowtype;
begin
  -- Claiming a task yourself is not news.
  if new.member_id is not distinct from app.current_member_id() then
    return null;
  end if;

  select * into v_task from tasks where id = new.task_id;

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

drop trigger if exists task_assignees_push_notify on task_assignees;
create trigger task_assignees_push_notify
  after insert on task_assignees
  for each row execute function app.push_on_task_assigned();

create or replace function app.push_on_task_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := app.current_member_id();
  rec   record;
begin
  if new.submitted_at is not null and old.submitted_at is null then
    for rec in
      select r.member_id from app.task_reviewers(new.id) r
      where r.member_id is distinct from v_me
    loop
      perform app.push_enqueue(
        rec.member_id, 'task_submitted',
        'Task ready for review', 'مهمة بانتظار الاعتماد',
        new.title, new.title,
        '/tasks');
    end loop;
  end if;

  if new.confirmed_at is not null and old.confirmed_at is null then
    for rec in
      select ta.member_id from task_assignees ta
      where ta.task_id = new.id and ta.member_id is distinct from v_me
    loop
      perform app.push_enqueue(
        rec.member_id, 'task_confirmed',
        'Task confirmed', 'تم اعتماد المهمة',
        new.title, new.title,
        '/tasks');
    end loop;
  end if;

  if new.rejected_at is not null and new.rejected_at is distinct from old.rejected_at then
    for rec in
      select ta.member_id from task_assignees ta
      where ta.task_id = new.id and ta.member_id is distinct from v_me
    loop
      perform app.push_enqueue(
        rec.member_id, 'task_returned',
        'Task returned to you', 'أُعيدت المهمة إليك',
        new.title || coalesce(': ' || nullif(new.review_note, ''), ''),
        new.title || coalesce(': ' || nullif(new.review_note, ''), ''),
        '/tasks');
    end loop;
  end if;

  if new.not_done_at is not null and old.not_done_at is null then
    for rec in
      select ta.member_id from task_assignees ta
      where ta.task_id = new.id and ta.member_id is distinct from v_me
    loop
      perform app.push_enqueue(
        rec.member_id, 'task_not_done',
        'Task marked not done', 'عُلّمت المهمة غير منجزة',
        new.title, new.title,
        '/tasks');
    end loop;
  end if;

  return null;
exception
  when others then
    raise warning 'push_on_task_change(%) skipped: %', new.id, sqlerrm;
    return null;
end;
$$;

drop trigger if exists tasks_push_notify on tasks;
create trigger tasks_push_notify
  after update on tasks
  for each row execute function app.push_on_task_change();

-- -----------------------------------------------------------------------------
-- 10. Reminders — the one thing no user action triggers
--
-- Called by the scheduled job. Anything on the calendar that starts within
-- the next p_minutes gets one reminder per recipient, keyed so a second sweep
-- over the same window writes nothing. The body carries the actual start
-- time, so the sweep interval does not have to be exact.
-- -----------------------------------------------------------------------------

create or replace function public.push_enqueue_reminders(p_minutes integer default 60)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec      record;
  v_tz     text;
  v_when   text;
  v_count  integer := 0;
begin
  select time_zone into v_tz from booking_settings limit 1;
  v_tz := coalesce(v_tz, 'Asia/Riyadh');

  for rec in
    select e.id, e.title, e.starts_at, e.kind, r.member_id
    from calendar_entries e
    cross join lateral app.entry_recipients(e.id) r
    where not e.all_day
      and e.starts_at > now()
      and e.starts_at <= now() + make_interval(mins => greatest(p_minutes, 1))
  loop
    v_when := to_char(rec.starts_at at time zone v_tz, 'HH24:MI');

    if app.push_enqueue(
      rec.member_id, 'event_reminder',
      case when rec.kind = 'meeting' then 'Meeting soon' else 'Event soon' end,
      case when rec.kind = 'meeting' then 'اجتماع قريب' else 'فعالية قريبة' end,
      rec.title || ' starts at ' || v_when,
      'يبدأ «' || rec.title || '» الساعة ' || v_when,
      '/calendar/' || rec.id,
      'reminder:' || rec.id || ':' || rec.member_id
    ) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.push_enqueue_reminders(integer) from public, authenticated, anon;
grant execute on function public.push_enqueue_reminders(integer) to service_role;

-- -----------------------------------------------------------------------------
-- 11. Claiming work to send
--
-- Delivery runs from more than one place at once — the action that caused
-- the change kicks it, and the scheduled job sweeps — so a row is leased
-- rather than read. A lease that is not released in two minutes (a function
-- that died mid-send) is simply taken again; five attempts and it is left.
-- -----------------------------------------------------------------------------

create or replace function public.push_claim_outbox(p_limit integer default 50)
returns setof notification_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  update notification_outbox o
     set claimed_at = now(),
         attempts   = o.attempts + 1
   where o.id in (
     select id
     from notification_outbox
     where sent_at is null
       and attempts < 5
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
     order by created_at
     limit greatest(p_limit, 1)
     for update skip locked
   )
  returning o.*
$$;

revoke all on function public.push_claim_outbox(integer) from public, authenticated, anon;
grant execute on function public.push_claim_outbox(integer) to service_role;

notify pgrst, 'reload schema';
