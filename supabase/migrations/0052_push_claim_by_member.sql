-- =============================================================================
-- 0052 — Let the outbox claim be narrowed to one member.
--
-- For the suite, not the app. `db:notify` proves leasing by calling
-- push_claim_outbox against the live database, and the unfiltered version
-- leased EVERY pending row — including a real person's — which held their
-- notification for the two-minute lease. The server never passes p_member.
--
-- The old one-argument signature is dropped rather than overloaded: PostgREST
-- resolves an RPC by argument names, and {p_limit} would match both.
-- =============================================================================

drop function if exists public.push_claim_outbox(integer);

create or replace function public.push_claim_outbox(
  p_limit   integer default 50,
  p_member  uuid    default null
)
returns setof notification_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  update notification_outbox o
     set claimed_at = now(),
         attempts   = o.attempts + 1
   where o.id in (
     select id
     from notification_outbox
     where sent_at is null
       and attempts < 5
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
       and (p_member is null or member_id = p_member)
     order by created_at
     limit greatest(p_limit, 1)
     for update skip locked
   )
  returning o.*
$$;

revoke all on function public.push_claim_outbox(integer, uuid) from public, authenticated, anon;
grant execute on function public.push_claim_outbox(integer, uuid) to service_role;

notify pgrst, 'reload schema';
