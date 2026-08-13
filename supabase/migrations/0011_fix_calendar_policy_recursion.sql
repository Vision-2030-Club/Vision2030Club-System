-- =============================================================================
-- 0011 — Break the RLS recursion between calendar_entries and its audiences.
--
-- The policies in 0007 referred to each other:
--
--   calendar_entries_select          -> EXISTS (… calendar_entry_audiences …)
--   calendar_entry_audiences_select  -> EXISTS (… calendar_entries …)
--
-- Postgres evaluates the second policy while evaluating the first, and raises
--   42P17: infinite recursion detected in policy for relation "calendar_entries"
-- so *every* read of the calendar failed — including the plain club-event
-- listing that Guests are supposed to see.
--
-- The fix is to look the audiences up through a SECURITY DEFINER function.
-- It runs as the table owner, so RLS on calendar_entry_audiences does not
-- re-enter while the calendar_entries policy is being evaluated. Visibility is
-- unchanged: the function applies exactly the same audience_matches test the
-- inline EXISTS did.
-- =============================================================================

create or replace function app.entry_audience_includes_me(p_entry uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from calendar_entry_audiences a
    where a.entry_id = p_entry
      and app.audience_matches(a.audience_kind, a.team_id, a.project_id, a.member_id)
  )
$$;

drop policy if exists calendar_entries_select on calendar_entries;

create policy calendar_entries_select on calendar_entries
  for select using (
    (select app.is_signed_in())
    and (
      kind = 'club'
      or created_by = (select app.current_member_id())
      or (select app.can('calendar.view_all'))
      or app.entry_audience_includes_me(id)
    )
  );

grant execute on function app.entry_audience_includes_me(uuid) to authenticated;
