-- =============================================================================
-- 0058 — The second batch of comments from the IT team.
--
--   A. An announcement reaches the team. `team_posts` had no push; now every
--      active member of the team is told, except whoever wrote it.
--
--   B. Delivering work takes a link and a comment; confirming it takes a
--      comment. `submission_note` is new; the reviewer's comment reuses
--      `review_note`, which until now only a rejection wrote.
--
--   C. A calendar entry is deleted — or edited — by whoever created it, or by
--      the Presidency. A Director could delete any entry on their team's
--      calendar, including a member's confirmed meeting; the club decided
--      that is the creator's to remove (or the request's to reject).
--
--   D. Directors and Project Managers see the directory as NAMES: their own
--      team's, and their projects' members respectively. Profiles stay with
--      the Presidency and HR (the page reads the scope, 0048 unchanged).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Announcements
-- -----------------------------------------------------------------------------

create or replace function app.push_on_team_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team teams%rowtype;
  rec    record;
begin
  select * into v_team from teams where id = new.team_id;

  for rec in
    select m.id
    from members m
    where m.team_id = new.team_id
      and m.status = 'active'
      and m.id is distinct from new.author_id
  loop
    perform app.push_enqueue(
      rec.id, 'team_post',
      v_team.name_en || ': ' || new.title,
      v_team.name_ar || ': ' || new.title,
      left(new.body, 140),
      left(new.body, 140),
      '/teams/' || new.team_id);
  end loop;

  return null;
exception
  when others then
    raise warning 'push_on_team_post(%) skipped: %', new.id, sqlerrm;
    return null;
end;
$$;

drop trigger if exists team_posts_push_notify on team_posts;
create trigger team_posts_push_notify
  after insert on team_posts
  for each row execute function app.push_on_team_post();

-- -----------------------------------------------------------------------------
-- B. A link and a comment
-- -----------------------------------------------------------------------------

alter table tasks add column if not exists submission_note text;

comment on column tasks.submission_note is
  'What the person delivering the work said when they submitted it. Set by
   submit_task_for_review only, like submission_url.';

-- The guard learns the new column: it cannot arrive set, and only the
-- workflow writes it.
create or replace function app.enforce_task_workflow()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.task_workflow', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.submitted_at is not null
       or new.confirmed_at is not null
       or new.not_done_at is not null
       or new.confirmed_by is not null
       or new.not_done_by is not null
       or new.submission_url is not null
       or new.submission_note is not null then
      raise exception
        'A task cannot be created already submitted, confirmed, marked Not Done, or delivered'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.submitted_at is distinct from old.submitted_at
     or new.confirmed_at is distinct from old.confirmed_at
     or new.confirmed_by is distinct from old.confirmed_by
     or new.not_done_at  is distinct from old.not_done_at
     or new.not_done_by  is distinct from old.not_done_by
     or new.rejected_at  is distinct from old.rejected_at
     or new.submission_url  is distinct from old.submission_url
     or new.submission_note is distinct from old.submission_note then
    raise exception
      'Task status is computed, not set. Use submit_task_for_review, confirm_task, reject_task, or mark_task_not_done'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- The two-argument shape would be ambiguous against the new default (0044
-- dropped the earlier shapes for the same reason).
drop function if exists public.submit_task_for_review(uuid, text);

create or replace function public.submit_task_for_review(
  p_task uuid,
  p_url  text default null,
  p_note text default null
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
     set submitted_at    = now(),
         rejected_at     = null,
         review_note     = null,
         submission_url  = coalesce(nullif(btrim(coalesce(p_url, '')), ''), submission_url),
         submission_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_task;
  perform set_config('app.task_workflow', '', true);
end;
$$;

grant execute on function public.submit_task_for_review(uuid, text, text) to authenticated;

drop function if exists public.confirm_task(uuid, text);

create or replace function public.confirm_task(
  p_task    uuid,
  p_quality text,
  p_note    text default null
)
returns void
language plpgsql
as $$
declare
  v_task    tasks;
  v_quality task_quality;
  v_me      uuid := app.current_member_id();
begin
  if not app.can_confirm_task(p_task) then
    raise exception 'You are not the confirmer for this task'
      using errcode = '42501';
  end if;

  v_quality := p_quality::task_quality;
  if v_quality = 'not_done' then
    raise exception 'Not Done is set by mark_task_not_done, not by confirming'
      using errcode = '22023';
  end if;

  select * into v_task from tasks where id = p_task;
  if v_task.submitted_at is null then
    raise exception 'This task has not been submitted for review yet'
      using errcode = '42501';
  end if;
  if v_task.confirmed_at is not null or v_task.not_done_at is not null then
    raise exception 'This task is already finished' using errcode = '42501';
  end if;

  perform set_config('app.task_workflow', 'on', true);

  update tasks
     set confirmed_at = now(),
         confirmed_by = v_me,
         review_note  = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_task;

  insert into task_scores (task_id, quality, scored_by)
  values (p_task, v_quality, v_me)
  on conflict (task_id) do update
    set quality   = excluded.quality,
        scored_by = excluded.scored_by,
        scored_at = now();

  perform set_config('app.task_workflow', '', true);
end;
$$;

grant execute on function public.confirm_task(uuid, text, text) to authenticated;

-- The card and the task page read both comments, and the description, off
-- the same row everything else comes from. Appended, so nothing that reads
-- the view by position moves.
create or replace view public.task_kpi
with (security_invoker = on) as
select
  t.id,
  t.title,
  t.project_id,
  t.team_id,
  t.split_id,
  t.due_date,
  t.created_at,
  t.assigned_at,
  t.submitted_at,
  t.confirmed_at,
  t.not_done_at,
  t.rejected_at,
  ta.member_id as assignee_id,
  s.quality,
  d.state,
  d.days_remaining,
  d.risk,
  app.quality_score(s.quality) as quality_score,
  d.completion_score,
  case
    when s.quality is null or d.completion_score is null then null
    else (app.quality_score(s.quality) + d.completion_score)::numeric / 2
  end as overall_score,
  (t.confirmed_at is not null or t.not_done_at is not null) as counts_toward_kpi,
  d.is_delayed,
  app.can_claim_task(t.id) as can_claim,
  app.can_confirm_task(t.id) as can_confirm,
  app.can_administer_task(t.id) as can_administer,
  t.source_request_id,
  t.submission_url,
  coalesce(
    (select rt.task_requires_link
       from requests r
       join request_types rt on rt.id = r.request_type_id
      where r.id = t.source_request_id),
    false
  ) as requires_link,
  t.description,
  t.submission_note,
  t.review_note,
  t.created_by
from tasks t
left join task_assignees ta on ta.task_id = t.id
left join task_scores s     on s.task_id  = t.id
cross join lateral (
  select
    case
      when t.not_done_at  is not null then 'not_done'
      when t.confirmed_at is not null then 'completed'
      when t.submitted_at is not null then 'pending_confirmation'
      when ta.member_id   is not null then 'in_progress'
      else 'not_started'
    end::task_state as state,
    case when t.due_date is null then null
         else t.due_date - app.club_today() end as days_remaining
) b
cross join lateral (
  select
    b.state,
    b.days_remaining,
    case
      when b.state = 'completed'            then 'completed'
      when b.state = 'not_done'             then 'not_done'
      when b.state = 'pending_confirmation' then 'pending_review'
      when b.days_remaining is null         then 'none'
      when b.days_remaining <  0            then 'overdue'
      when b.days_remaining <= 2            then 'high'
      when b.days_remaining <= 5            then 'medium'
      else 'low'
    end::task_risk as risk,
    case
      when t.not_done_at is not null then 0
      when t.confirmed_at is not null then
        case
          when t.due_date is null then 100
          when (t.submitted_at at time zone 'Asia/Riyadh')::date <= t.due_date then 100
          else 50
        end
      else null
    end as completion_score
) c
cross join lateral (
  select
    c.state, c.days_remaining, c.risk, c.completion_score,
    c.risk in ('medium', 'high', 'overdue') as is_delayed
) d;

-- -----------------------------------------------------------------------------
-- C. A calendar entry is the creator's to remove
--
-- `app.can('calendar.manage')` with no team or project is true only for
-- scope `all` — the Presidency and Admin — which is exactly the rule.
-- -----------------------------------------------------------------------------

drop policy if exists calendar_entries_delete on calendar_entries;
create policy calendar_entries_delete on calendar_entries
  for delete using (
    created_by = (select app.current_member_id())
    or (select app.can('calendar.manage'))
  );

drop policy if exists calendar_entries_update on calendar_entries;
create policy calendar_entries_update on calendar_entries
  for update
  using (
    created_by = (select app.current_member_id())
    or (select app.can('calendar.manage'))
  )
  with check (
    created_by = (select app.current_member_id())
    or (select app.can('calendar.manage'))
  );

-- -----------------------------------------------------------------------------
-- D. Names for Directors and Project Managers
-- -----------------------------------------------------------------------------

update role_permissions rp
   set scope = 'own_team'
  from roles r
 where r.id = rp.role_id
   and r.key = 'team_director'
   and rp.permission_key = 'members.directory';

update role_permissions rp
   set scope = 'own_projects'
  from roles r
 where r.id = rp.role_id
   and r.key = 'project_manager'
   and rp.permission_key = 'members.directory';

notify pgrst, 'reload schema';
