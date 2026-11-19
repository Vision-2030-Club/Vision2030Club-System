-- =============================================================================
-- 0076 — Event attendance: read attendees by id.
--
-- A component that reads the check-ins (0075, `event_api_check_ins`) gets
-- attendee ids, and then needs those people: Quroosh makes a guest account
-- for whoever has just been checked in. `event_api_attendees` only pages
-- through everyone by change time, which is the whole list on every scan.
-- This answers for a handful of ids.
--
-- Server only, like the rest of the API: the service role alone runs it.
-- Nothing is changed or deleted. Safe to re-run.
-- =============================================================================

create or replace function public.event_api_attendees_by_id(p_project uuid, p_ids uuid[])
returns table (
  id            uuid,
  token         text,
  name          text,
  phone         text,
  email         text,
  locale        text,
  source        text,
  source_ref    text,
  created_at    timestamptz,
  updated_at    timestamptz,
  cancelled_at  timestamptz,
  days          date[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.token, a.name, a.phone, a.email, a.locale, a.source, a.source_ref,
         a.created_at, a.updated_at, a.cancelled_at,
         coalesce((select array_agg(c.day order by c.day) from event_check_ins c
                    where c.attendee_id = a.id and c.undone_at is null), '{}'::date[])
    from event_attendees a
   where a.project_id = p_project
     and a.id = any (coalesce(p_ids, '{}'::uuid[]))
   order by a.id
   limit 5000
$$;

revoke execute on function public.event_api_attendees_by_id(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.event_api_attendees_by_id(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
