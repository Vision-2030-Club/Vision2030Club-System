-- =============================================================================
-- 0066 — The outreach pipeline as the teams actually run it, and a project
--        that carries two components.
--
-- Reading all thirteen of the Development folder's workbooks (0065 was built
-- from five of them, as PDFs) showed two things the model got wrong:
--
--   1. The status list is longer. Across the five project trackers the teams
--      write nine different words. Two pairs are the same thing spelled twice
--      ("Schedual"/"Scheduled a Meeting", "In Process"/"In process"), and
--      "Contacted" and "Waiting for Response" are one state in two dialects —
--      Career Guidance says the first, everyone else the second. What is left
--      is a seven-step pipeline, and two of its steps were missing:
--
--        In Progress / In Process   a conversation is actually happening
--        On Hold                    paused, neither won nor lost
--
--      Added in place, so the enum still reads in pipeline order and
--      `order by status` still sorts the way the work flows:
--        new → waiting → in_progress → meeting → on_hold → confirmed → rejected
--
--   2. A project may carry TWO components. افترض runs Mock Interviews AND
--      keeps its own outreach list of 111 companies, sponsors and workshops.
--      `project_components` was keyed on the project alone, which allowed only
--      one. The key becomes (project_id, component_key). Nothing references
--      that key, so widening it costs nothing.
--
-- The summary views compare `status::text` rather than the enum literals:
-- Postgres refuses to USE an enum value added in the same transaction, and
-- db-push wraps each migration in one. The cast is not a workaround for a
-- rule, it is how a single file can both add the values and use them.
-- =============================================================================

alter type outreach_status add value if not exists 'in_progress' after 'waiting';
alter type outreach_status add value if not exists 'on_hold'     after 'meeting';

-- -----------------------------------------------------------------------------
-- Two components per project
-- -----------------------------------------------------------------------------

alter table project_components drop constraint project_components_pkey;
alter table project_components add primary key (project_id, component_key);

-- -----------------------------------------------------------------------------
-- The summaries, counting every step of the pipeline
-- -----------------------------------------------------------------------------

-- Dropped rather than replaced: `create or replace view` may append a column
-- but never rename or reorder one, and these gain counts in the middle.
drop view if exists public.outreach_member_summary;
drop view if exists public.outreach_type_summary;

create view public.outreach_member_summary
with (security_invoker = on) as
select
  t.project_id,
  t.owner_id as member_id,
  count(*)                                                  as total,
  count(*) filter (where t.status::text = 'new')            as new_count,
  count(*) filter (where t.status::text = 'waiting')        as waiting,
  count(*) filter (where t.status::text = 'in_progress')    as in_progress,
  count(*) filter (where t.status::text = 'meeting')        as meeting,
  count(*) filter (where t.status::text = 'on_hold')        as on_hold,
  count(*) filter (where t.status::text = 'confirmed')      as confirmed,
  count(*) filter (where t.status::text = 'rejected')       as rejected,
  round(100.0 * count(*) filter (where t.status::text = 'confirmed') / count(*), 1) as conversion_pct
from outreach_targets t
group by t.project_id, t.owner_id;

create view public.outreach_type_summary
with (security_invoker = on) as
select
  t.project_id,
  t.type_key,
  count(*)                                                  as total,
  -- "Open" is everything still in play: nothing decided either way.
  count(*) filter (where t.status::text in ('new', 'waiting', 'in_progress', 'meeting', 'on_hold'))
                                                            as open_count,
  count(*) filter (where t.status::text = 'confirmed')      as confirmed,
  count(*) filter (where t.status::text = 'rejected')       as rejected,
  round(100.0 * count(*) filter (where t.status::text = 'confirmed') / count(*), 1) as conversion_pct
from outreach_targets t
group by t.project_id, t.type_key;

grant select on public.outreach_member_summary, public.outreach_type_summary to authenticated;

notify pgrst, 'reload schema';
