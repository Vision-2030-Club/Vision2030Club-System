-- =============================================================================
-- 0053 — Someone with `all` who sits in the target team is the team's own.
--
-- 0049 preferred the narrowest authority so the President is not told about
-- every team-level request. That put a Super Admin who is a MEMBER of the IT
-- team on the same footing as the President for a request aimed at IT — told
-- nothing, because IT has a Director. Wrong: they are in the team.
--
-- Now tier 2 is "holds the permission over this target AND belongs to it":
-- the team's Directors, plus anyone in the team whose scope is `all`. Same
-- for projects — an `all`-holder who manages the project. President and VP
-- sit in Club Management, so requests to other teams still do not reach them.
-- =============================================================================

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

  -- Inside the target: the team's own people at own_team OR all; the
  -- project's managers at own_projects OR all.
  select s.id, 2
  from scoped s
  where (s.scope in ('own_team', 'all') and p_team is not null and s.team_id = p_team)
     or (s.scope in ('own_projects', 'all') and p_project is not null
         and exists (
           select 1 from project_managers pm
           where pm.project_id = p_project and pm.member_id = s.id
         ))

  union all

  -- Outside it, holding all: the fallback when the target has nobody.
  select s.id, 3
  from scoped s
  where s.scope = 'all'
$$;
