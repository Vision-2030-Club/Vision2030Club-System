-- =============================================================================
-- 0051 — A Project Manager can request a meeting again.
--
-- 0037 derives which group a person books a room as. For a PM it counted
-- their projects and took `min(project_id)` — and Postgres has no min() for
-- uuid, so the function raised "function min(uuid) does not exist" for every
-- PM the moment they submitted a meeting request. Nobody noticed because the
-- meetings suite seeds Directors and Presidency, who take the other branches.
--
-- The value is only used when there is exactly one project, so which element
-- is picked does not matter; array_agg is the honest way to say "the one".
-- =============================================================================

create or replace function app.default_booking_identity()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope    permission_scope;
  v_projects uuid[];
begin
  v_scope := app.effective_scope('rooms.book');

  if v_scope = 'all' then
    return 'presidency';
  end if;

  if v_scope = 'own_team' then
    return 'team:' || app.current_team_id()::text;
  end if;

  if v_scope = 'own_projects' then
    select coalesce(array_agg(project_id), '{}') into v_projects
    from project_managers
    where member_id = app.current_member_id();

    -- One project: obvious. Several: genuinely their choice, and picking one
    -- for them would book the wrong project's name onto the schedule.
    if cardinality(v_projects) = 1 then
      return 'project:' || v_projects[1]::text;
    end if;
  end if;

  return null;
end;
$$;
