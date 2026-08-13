-- =============================================================================
-- 0002 — The access check.
--
-- Every permission decision in this system goes through app.can(). It reads
-- the (role, permission) -> scope mapping from 0001 and compares that scope to
-- the row being touched. There is no role name anywhere in this file.
--
-- These are SECURITY DEFINER so they can read `members` and the permission
-- tables while those tables have Row Level Security on them. Without that, a
-- policy on `members` that looks up the current member would recurse forever.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Who is asking?
-- -----------------------------------------------------------------------------

create or replace function app.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from members where auth_user_id = auth.uid()
$$;

create or replace function app.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select team_id from members where auth_user_id = auth.uid()
$$;

create or replace function app.current_role_key()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.key
  from members m
  join roles r on r.id = m.role_id
  where m.auth_user_id = auth.uid()
$$;

-- True for anyone with a linked, active profile. Used by the "every signed-in
-- role, Guest included" rules (spec §6) — never for anonymous access.
create or replace function app.is_signed_in()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from members
    where auth_user_id = auth.uid()
      and status = 'active'
  )
$$;

-- -----------------------------------------------------------------------------
-- Scope resolution
-- -----------------------------------------------------------------------------

-- Returns the scope this user's role has for a permission. A team-specific
-- override (e.g. HR's Directors on members.manage) wins over the baseline;
-- anything unmapped is 'none', so the safe answer is the default.
create or replace function app.effective_scope(p_permission text)
returns permission_scope
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select o.scope
      from role_permission_team_overrides o
      join members m
        on m.role_id = o.role_id
       and m.team_id = o.team_id
      where m.auth_user_id = auth.uid()
        and o.permission_key = p_permission
    ),
    (
      select rp.scope
      from role_permissions rp
      join members m on m.role_id = rp.role_id
      where m.auth_user_id = auth.uid()
        and rp.permission_key = p_permission
    ),
    'none'::permission_scope
  )
$$;

-- -----------------------------------------------------------------------------
-- Relationship helpers
--
-- These answer "am I attached to this row?", which is a fact about the data,
-- not about roles. Keeping them separate from app.can() is what stops us from
-- overloading a scope name with two different meanings.
-- -----------------------------------------------------------------------------

create or replace function app.is_project_manager(p_project uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_project is null then
    return false;
  end if;
  return exists (
    select 1
    from project_managers pm
    where pm.project_id = p_project
      and pm.member_id = app.current_member_id()
  );
end;
$$;

create or replace function app.is_on_project(p_project uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_project is null then
    return false;
  end if;
  return exists (
    select 1
    from project_members pj
    where pj.project_id = p_project
      and pj.member_id = app.current_member_id()
  ) or app.is_project_manager(p_project);
end;
$$;

-- -----------------------------------------------------------------------------
-- The check itself
-- -----------------------------------------------------------------------------

-- Compare the caller's scope for `p_permission` against one row's context.
--
--   p_team     the team the row belongs to      (for 'own_team')
--   p_owner    the member who owns/submitted it (for 'own')
--   p_project  the project the row belongs to   (for 'own_projects')
--   p_assigned did the caller get assigned this row? (for 'assigned')
--
-- Callers pass only what applies; anything missing simply fails to match.
create or replace function app.can(
  p_permission  text,
  p_team        uuid    default null,
  p_owner       uuid    default null,
  p_project     uuid    default null,
  p_assigned    boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope permission_scope;
  v_me    uuid;
begin
  v_scope := app.effective_scope(p_permission);

  if v_scope = 'none' then
    return false;
  end if;

  v_me := app.current_member_id();
  if v_me is null then
    return false;   -- no linked profile: never allowed, whatever the scope
  end if;

  if v_scope = 'all' then
    return true;
  end if;

  if v_scope = 'own_team' then
    return p_team is not null and p_team = app.current_team_id();
  end if;

  if v_scope = 'own_projects' then
    -- "projects I run" — membership alone is not management (spec §2).
    return app.is_project_manager(p_project);
  end if;

  if v_scope = 'own' then
    return p_owner is not null and p_owner = v_me;
  end if;

  if v_scope = 'assigned' then
    return coalesce(p_assigned, false);
  end if;

  return false;
end;
$$;

-- Convenience wrapper for the API layer: raises a readable error instead of
-- returning false, so users see a real message rather than an empty result.
create or replace function app.require(
  p_permission  text,
  p_team        uuid    default null,
  p_owner       uuid    default null,
  p_project     uuid    default null,
  p_assigned    boolean default false
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.can(p_permission, p_team, p_owner, p_project, p_assigned) then
    raise exception 'Permission denied: % (scope %)',
      p_permission, app.effective_scope(p_permission)
      using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
--
-- The `app` schema is not exposed through the API, but RLS policies run these
-- functions as the calling role, so that role needs EXECUTE.
-- -----------------------------------------------------------------------------

grant usage on schema app to anon, authenticated, service_role;
grant execute on all functions in schema app to anon, authenticated, service_role;

alter default privileges in schema app
  grant execute on functions to anon, authenticated, service_role;
