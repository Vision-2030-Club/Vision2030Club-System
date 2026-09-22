-- =============================================================================
-- 0065 — The Outreach component.
--
-- Shark Tank and Seen chase people and organisations: sharks, sponsors,
-- speakers, venues, workshop hosts. Each is a TARGET with an owner and a
-- response status, and the measure is how many convert — not how fast a task
-- was delivered. That shape never fit `tasks` (no due date, no submission,
-- "rejected" is an outcome rather than a failure), so it gets its own tables,
-- attached to a project the way Mock Interviews is (0062), and living in
-- THIS database because nothing here is personal beyond a contact's name.
--
--   outreach_types            the kinds of target a project chases, its own
--                             list (Shark Tank: shark, sponsor, talk, venue,
--                             workshop; Seen: sponsor, speaker, venue, planning)
--   outreach_targets          one row per target: type, name, owner, status
--   outreach_status_history   every status change, who and when
--   outreach_member_summary   per project per member: totals and conversion
--   outreach_type_summary     per project per type
--
-- Who may do what, all through existing helpers, no role names:
--   open      whoever manages the project, is on it, or may view its KPI
--   add       managers and people on the project (owner defaults to self)
--   change    managers, or the target's owner (status, notes, name, type)
--   remove    managers
--   types     managers
--
-- my_component_access() learns two roles for this component only: `member`
-- (on the project) and `viewer` (KPI visibility, read-only). The interviews
-- pages filter by component_key and never see them.
-- =============================================================================

alter table project_components drop constraint if exists project_components_component_key_check;
alter table project_components
  add constraint project_components_component_key_check
  check (component_key in ('mock_interviews', 'outreach'));

create type outreach_status as enum ('new', 'waiting', 'meeting', 'confirmed', 'rejected');

create table outreach_types (
  project_id  uuid    not null references projects (id) on delete cascade,
  key         text    not null check (key ~ '^[a-z][a-z0-9_]{0,30}$'),
  name_en     text    not null,
  name_ar     text    not null,
  sort_order  integer not null default 100,
  primary key (project_id, key)
);

create table outreach_targets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  type_key    text not null,
  name        text not null check (btrim(name) <> ''),
  owner_id    uuid references members (id) on delete set null,
  status      outreach_status not null default 'new',
  notes       text,
  created_by  uuid references members (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (project_id, type_key) references outreach_types (project_id, key)
    on update cascade
);

create index outreach_targets_project_idx on outreach_targets (project_id, type_key, status);
create index outreach_targets_owner_idx   on outreach_targets (owner_id);

create table outreach_status_history (
  id           bigserial primary key,
  target_id    uuid not null references outreach_targets (id) on delete cascade,
  from_status  outreach_status,
  to_status    outreach_status not null,
  changed_by   uuid references members (id) on delete set null,
  changed_at   timestamptz not null default now(),
  note         text
);

create index outreach_status_history_target_idx on outreach_status_history (target_id, changed_at);

create trigger outreach_targets_touch
  before update on outreach_targets
  for each row execute function app.touch_updated_at();

-- Every status a target has ever had, written by the database itself. The
-- function is a definer so the insert never depends on the caller's rights.
create or replace function app.outreach_log_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into outreach_status_history (target_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, coalesce(new.created_by, app.current_member_id()));
  elsif new.status is distinct from old.status then
    insert into outreach_status_history (target_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, app.current_member_id());
  end if;
  return new;
end;
$$;

create trigger outreach_targets_log_status
  after insert or update of status on outreach_targets
  for each row execute function app.outreach_log_status();

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------

create or replace function app.can_open_outreach(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_project is not null and (
    app.can_manage_project(p_project)
    or app.is_on_project(p_project)
    or app.can_view_kpi_for_project(p_project)
  )
$$;

create or replace function app.can_add_outreach(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_project is not null and (
    app.can_manage_project(p_project) or app.is_on_project(p_project)
  )
$$;

alter table outreach_types          enable row level security;
alter table outreach_targets        enable row level security;
alter table outreach_status_history enable row level security;

create policy outreach_types_select on outreach_types
  for select using ((select app.can_open_outreach(project_id)));
create policy outreach_types_write on outreach_types
  for all
  using ((select app.can_manage_project(project_id)))
  with check ((select app.can_manage_project(project_id)));

create policy outreach_targets_select on outreach_targets
  for select using ((select app.can_open_outreach(project_id)));
create policy outreach_targets_insert on outreach_targets
  for insert with check ((select app.can_add_outreach(project_id)));
create policy outreach_targets_update on outreach_targets
  for update
  using (
    (select app.can_manage_project(project_id))
    or owner_id = (select app.current_member_id())
  )
  with check (
    (select app.can_manage_project(project_id))
    or owner_id = (select app.current_member_id())
  );
create policy outreach_targets_delete on outreach_targets
  for delete using ((select app.can_manage_project(project_id)));

-- History is read where the target is read, and written by the trigger only.
create policy outreach_status_history_select on outreach_status_history
  for select using (
    exists (select 1 from outreach_targets t
             where t.id = target_id and app.can_open_outreach(t.project_id))
  );

-- -----------------------------------------------------------------------------
-- The two summaries the sheets compute by hand
-- -----------------------------------------------------------------------------

create or replace view public.outreach_member_summary
with (security_invoker = on) as
select
  t.project_id,
  t.owner_id as member_id,
  count(*)                                              as total,
  count(*) filter (where t.status = 'new')              as new_count,
  count(*) filter (where t.status = 'waiting')          as waiting,
  count(*) filter (where t.status = 'meeting')          as meeting,
  count(*) filter (where t.status = 'confirmed')        as confirmed,
  count(*) filter (where t.status = 'rejected')         as rejected,
  round(100.0 * count(*) filter (where t.status = 'confirmed') / count(*), 1) as conversion_pct
from outreach_targets t
group by t.project_id, t.owner_id;

create or replace view public.outreach_type_summary
with (security_invoker = on) as
select
  t.project_id,
  t.type_key,
  count(*)                                              as total,
  count(*) filter (where t.status in ('new', 'waiting', 'meeting')) as open_count,
  count(*) filter (where t.status = 'confirmed')        as confirmed,
  count(*) filter (where t.status = 'rejected')         as rejected,
  round(100.0 * count(*) filter (where t.status = 'confirmed') / count(*), 1) as conversion_pct
from outreach_targets t
group by t.project_id, t.type_key;

-- -----------------------------------------------------------------------------
-- my_component_access: the outreach roles
-- -----------------------------------------------------------------------------

create or replace function public.my_component_access()
returns table (
  project_id     uuid,
  name_en        text,
  name_ar        text,
  component_key  text,
  external_ref   text,
  role           text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select
      pc.project_id, p.name_en, p.name_ar, pc.component_key, pc.external_ref,
      case
        when app.can('projects.manage', p_team => p.owning_team_id, p_project => p.id)
          then 'manager'
        -- Mock Interviews: HR and organizers, as 0062 defined them.
        when pc.component_key = 'mock_interviews'
         and (app.effective_scope('members.manage') = 'all'
              or exists (select 1 from project_component_people x
                          where x.project_id = pc.project_id
                            and x.member_id = app.current_member_id()
                            and x.role = 'hr'))
          then 'hr'
        when pc.component_key = 'mock_interviews'
         and exists (select 1 from project_component_people x
                      where x.project_id = pc.project_id
                        and x.member_id = app.current_member_id()
                        and x.role = 'organizer')
          then 'organizer'
        -- Outreach: everyone on the project works it; KPI viewers read it.
        when pc.component_key = 'outreach' and app.is_on_project(pc.project_id)
          then 'member'
        when pc.component_key = 'outreach' and app.can_view_kpi_for_project(pc.project_id)
          then 'viewer'
      end as role
    from project_components pc
    join projects p on p.id = pc.project_id
    where app.is_signed_in()
  )
  select * from mine where role is not null
  order by name_en
$$;

grant execute on function public.my_component_access() to authenticated;
grant select, insert, update, delete on outreach_types, outreach_targets to authenticated;
grant select on outreach_status_history to authenticated;
grant select on public.outreach_member_summary, public.outreach_type_summary to authenticated;

notify pgrst, 'reload schema';
