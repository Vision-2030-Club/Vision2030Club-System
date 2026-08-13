-- =============================================================================
-- 0003 — Row Level Security for the foundation tables.
--
-- This file is the actual security boundary. Hiding a button in the UI does
-- nothing here: a lower-privileged user calling the REST API directly hits
-- exactly these policies. The API layer repeats the same checks only so the
-- user gets a readable message instead of an empty result.
--
-- Every table gets RLS enabled, which means "deny everything" until a policy
-- allows it. That default is the point.
-- =============================================================================

alter table teams                          enable row level security;
alter table roles                          enable row level security;
alter table members                        enable row level security;
alter table member_sensitive               enable row level security;
alter table skills                         enable row level security;
alter table member_skills                  enable row level security;
alter table permissions                    enable row level security;
alter table role_permissions               enable row level security;
alter table role_permission_team_overrides enable row level security;
alter table role_change_log                enable row level security;

-- -----------------------------------------------------------------------------
-- Reference data: readable by anyone signed in, writable only by whoever holds
-- the matching permission.
--
-- `(select app.is_signed_in())` rather than a bare call: wrapping it in a
-- sub-select lets Postgres evaluate it once per query instead of once per row.
-- -----------------------------------------------------------------------------

create policy teams_select on teams
  for select using ((select app.is_signed_in()));

create policy teams_write on teams
  for all
  using ((select app.can('teams.manage')))
  with check ((select app.can('teams.manage')));

create policy roles_select on roles
  for select using ((select app.is_signed_in()));

create policy roles_write on roles
  for all
  using ((select app.can('roles.configure')))
  with check ((select app.can('roles.configure')));

create policy skills_select on skills
  for select using ((select app.is_signed_in()));

create policy skills_write on skills
  for all
  using ((select app.can('members.manage')))
  with check ((select app.can('members.manage')));

-- -----------------------------------------------------------------------------
-- The permission map itself.
--
-- Readable so the UI can grey out what you can't do; writable only by a role
-- holding `roles.configure` (Super Admin in the seed). This is the "changing
-- what a role can do is a data update" surface from spec §2.
-- -----------------------------------------------------------------------------

create policy permissions_select on permissions
  for select using ((select app.is_signed_in()));

create policy permissions_write on permissions
  for all
  using ((select app.can('roles.configure')))
  with check ((select app.can('roles.configure')));

create policy role_permissions_select on role_permissions
  for select using ((select app.is_signed_in()));

create policy role_permissions_write on role_permissions
  for all
  using ((select app.can('roles.configure')))
  with check ((select app.can('roles.configure')));

create policy role_overrides_select on role_permission_team_overrides
  for select using ((select app.is_signed_in()));

create policy role_overrides_write on role_permission_team_overrides
  for all
  using ((select app.can('roles.configure')))
  with check ((select app.can('roles.configure')));

-- -----------------------------------------------------------------------------
-- Members
--
-- Note what is NOT here: Team Directors get no write access. Their baseline
-- scope for members.manage is 'none', and only the HR override lifts it
-- (spec §2). The policy never mentions HR — it just asks app.can().
-- -----------------------------------------------------------------------------

create policy members_select on members
  for select using (
    (select app.can('members.view'))
    or id = (select app.current_member_id())   -- you can always see yourself
  );

create policy members_insert on members
  for insert with check ((select app.can('members.manage')));

create policy members_update on members
  for update
  using (
    (select app.can('members.manage'))
    or id = (select app.current_member_id())   -- edit your own profile
  )
  with check (
    (select app.can('members.manage'))
    or id = (select app.current_member_id())
  );

create policy members_delete on members
  for delete using ((select app.can('members.manage')));

-- Sensitive data (spec §5). Separate table, separate policy: being able to
-- read the directory says nothing about being able to read national IDs.
create policy member_sensitive_select on member_sensitive
  for select using (
    member_id = (select app.current_member_id())
    or (select app.can('members.view_sensitive'))
  );

create policy member_sensitive_write on member_sensitive
  for all
  using ((select app.can('members.view_sensitive')))
  with check ((select app.can('members.view_sensitive')));

create policy member_skills_select on member_skills
  for select using ((select app.is_signed_in()));

create policy member_skills_write on member_skills
  for all
  using ((select app.can('members.manage')))
  with check ((select app.can('members.manage')));

-- Audit log: readable by whoever configures roles, plus the affected person.
-- There is no INSERT policy on purpose — only the trigger below writes here.
create policy role_change_log_select on role_change_log
  for select using (
    (select app.can('roles.configure'))
    or member_id = (select app.current_member_id())
  );

-- -----------------------------------------------------------------------------
-- Column-level gates (spec §2)
--
-- The UPDATE policy above lets a member edit their own profile, but "edit your
-- profile" must not become "promote yourself" or "move yourself to HR". RLS
-- works on rows, not columns, so the per-column rules live in a trigger.
--
--   role_id                        -> roles.configure (Super Admin), audited
--   team_id, student_id, email,
--   status                         -> members.manage (HR Directors + leadership)
--
-- Changing a role is ONE sensitive operation, not two: because a person holds
-- exactly one role, setting the new one is what removes the old one.
-- -----------------------------------------------------------------------------

create or replace function app.gate_member_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role_id is distinct from old.role_id then
    if not app.can('roles.configure') then
      raise exception
        'Changing a member''s role requires the roles.configure permission'
        using errcode = '42501';
    end if;

    insert into role_change_log (member_id, from_role_id, to_role_id, changed_by)
    values (new.id, old.role_id, new.role_id, app.current_member_id());
  end if;

  if (new.team_id    is distinct from old.team_id)
     or (new.student_id is distinct from old.student_id)
     or (new.email      is distinct from old.email)
     or (new.status     is distinct from old.status)
  then
    if not app.can('members.manage') then
      raise exception
        'Changing a member''s team, student ID, email, or status requires the members.manage permission'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger members_gate_role_change
  before update on members
  for each row execute function app.gate_member_role_change();

-- The link between a profile and a login account is set by the server during
-- first sign-in (spec §5). Nobody may re-point it at someone else's account.
create or replace function app.gate_auth_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.auth_user_id is distinct from old.auth_user_id
     and current_user not in ('postgres', 'service_role', 'supabase_admin')
  then
    raise exception 'auth_user_id can only be set by the server'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger members_gate_auth_link
  before update on members
  for each row execute function app.gate_auth_link();

-- -----------------------------------------------------------------------------
-- Table grants. RLS decides which ROWS; these decide which VERBS are even
-- possible for the API roles. `anon` gets nothing: there is no anonymous
-- access anywhere in this system (spec §6).
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema public to authenticated;
