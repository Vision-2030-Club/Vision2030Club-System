-- =============================================================================
-- 0067 — The semester as a unit.
--
-- Every KPI view is all-time (HANDOFF, "What is left" §5). The Presidency
-- reads the club a semester at a time, so the semester becomes a setting the
-- system knows: one row naming it and bounding it, and a club-wide summary
-- of this semester's tasks for the dashboard's semester line.
--
-- The summary reads `tasks`, not `task_kpi`. It needs only the workflow
-- timestamps, and going through task_kpi would cost its eight definer calls
-- per row on every dashboard load for every member (HANDOFF §2). The state
-- rules are the same ones task_kpi applies, in the same order.
--
-- Apply by pasting into the Supabase SQL editor. Every statement re-runs
-- safely.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The one row
-- -----------------------------------------------------------------------------

create table if not exists semester_settings (
  id         boolean primary key default true check (id),
  name_en    text not null,
  name_ar    text not null,
  starts_on  date not null,
  ends_on    date not null,
  updated_at timestamptz not null default now(),

  constraint semester_settings_order check (ends_on > starts_on)
);

comment on table semester_settings is
  'One row: the semester the club is in. The dashboard''s semester line and club_semester_kpi read it; the Presidency sets it from /admin/semester.';

-- The first-semester timeline scripts/import-timeline.mjs put on the calendar
-- runs 2026-08-08 to 2026-11-21; the seed says the same so the line is right
-- before anyone opens the admin page.
insert into semester_settings (id, name_en, name_ar, starts_on, ends_on)
values (true, 'First Semester 1448H', 'الفصل الأول 1448هـ', '2026-08-08', '2026-11-21')
on conflict (id) do nothing;

drop trigger if exists semester_settings_touch_updated_at on semester_settings;
create trigger semester_settings_touch_updated_at
  before update on semester_settings
  for each row execute function app.touch_updated_at();

alter table semester_settings enable row level security;

-- Which semester it is is not a secret: anyone signed in reads it.
drop policy if exists semester_settings_select on semester_settings;
create policy semester_settings_select on semester_settings
  for select using ((select app.is_signed_in()));

-- Setting it belongs to whoever runs the club calendar at club scope
-- (spec §6: club entries are the Presidency's and the Super Admin's). A
-- Director holds calendar.manage at own_team, and app.can with no team in
-- hand answers false for that scope, so the row is theirs to read only.
drop policy if exists semester_settings_update on semester_settings;
create policy semester_settings_update on semester_settings
  for update
  using ((select app.can('calendar.manage')))
  with check ((select app.can('calendar.manage')));

-- No insert or delete policy: the row exists once, from this migration.

-- -----------------------------------------------------------------------------
-- This semester's tasks, club-wide, as the caller may see them
--
-- A task belongs to the semester by its due date, or by the day it was
-- created when it has none. `tasks` is read under the caller's own policies
-- (security_invoker), so the Presidency sees the whole club and a member
-- sees the slice tasks_select already gives them.
-- -----------------------------------------------------------------------------

create or replace view public.club_semester_kpi
with (security_invoker = on) as
select
  s.name_en,
  s.name_ar,
  s.starts_on,
  s.ends_on,
  count(t.id)                                                     as planned_tasks,
  count(*) filter (where t.confirmed_at is not null)              as completed_tasks,
  count(*) filter (where t.not_done_at is not null)               as not_done_tasks,
  count(*) filter (where t.confirmed_at is null
                     and t.not_done_at  is null
                     and t.submitted_at is not null)              as pending_tasks,
  count(*) filter (where t.confirmed_at is null
                     and t.not_done_at  is null
                     and t.submitted_at is null
                     and t.due_date < app.club_today())           as overdue_tasks
from semester_settings s
left join tasks t
  on coalesce(t.due_date, (t.created_at at time zone 'Asia/Riyadh')::date)
     between s.starts_on and s.ends_on
group by s.id, s.name_en, s.name_ar, s.starts_on, s.ends_on;

comment on view public.club_semester_kpi is
  'One row: the current semester and the count of its tasks by state, over the tasks the caller may see. Same state rules as task_kpi, read from tasks directly.';

grant select, update on semester_settings to authenticated;
grant select on public.club_semester_kpi to authenticated;

notify pgrst, 'reload schema';
