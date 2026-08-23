-- =============================================================================
-- 0021 — Remove the Technical team.
--
-- The club does not have one. Teams are data (0004), so this is a DELETE and
-- nothing else: no code anywhere names a team.
--
-- The seed in 0004 no longer lists TECHNICAL either, so a fresh database never
-- creates it and this file is a no-op there. It exists for the databases that
-- already have the row.
--
-- Rows that merely *decorate* a team (its overrides, its posts, its calendar
-- audiences) cascade. Rows that would be ORPHANED by the delete — a member, a
-- project, a task, a request routed there — do not, so this refuses rather
-- than guessing where they should go instead.
-- =============================================================================

do $$
declare
  v_team uuid;
  v_refs bigint;
begin
  select id into v_team from teams where key = 'TECHNICAL';
  if v_team is null then
    return;
  end if;

  select
      (select count(*) from members         where team_id             = v_team)
    + (select count(*) from projects        where owning_team_id      = v_team)
    + (select count(*) from tasks           where team_id             = v_team)
    + (select count(*) from request_types   where owning_team_id      = v_team)
    + (select count(*) from requests        where target_team_id      = v_team)
    + (select count(*) from calendar_entries where meeting_scope_team_id = v_team)
  into v_refs;

  if v_refs > 0 then
    raise exception
      'The Technical team still has % row(s) pointing at it (members, projects, tasks, request types, requests or calendar entries). Move them to another team, then re-run this migration.',
      v_refs
      using errcode = '23503';
  end if;

  delete from teams where id = v_team;
end
$$;
