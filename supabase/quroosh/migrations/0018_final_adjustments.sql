-- =============================================================================
-- Quroosh database — 0018: adjustments to a Final Wave project's total.
--
-- The club asked (2026-11-26, during the closing ceremony) to be able to move
-- a project's total without a guest account behind it. Until now a total was
-- only the sum of the guests' gifts (final_gifts), and every gift needs an
-- account.
--
--   final_adjustments  one row per adjustment: which project, how much (plus
--                      or minus), a note saying why, and when. Written by
--                      hand in the SQL editor; the app has no screen for it.
--
-- An adjustment is never a gift: final_gifts is not touched, the guests'
-- wallets are not touched, and the counts of gifts and of supporters do not
-- change. The three functions that add up a project's total (the managers'
-- list, the board, the guest's list) now add its adjustments to `received`;
-- they are 0014's otherwise. The stage screen reads the managers' list, so
-- it shows the adjusted totals too.
--
-- To undo every adjustment: delete from final_adjustments;
--
-- Nothing is deleted. Safe to re-run.
-- =============================================================================

create table if not exists final_adjustments (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,                    -- the club database's projects.id
  final_project_id  uuid not null references final_projects (id),
  amount            integer not null constraint final_adjustments_amount_not_zero check (amount <> 0),
  note              text not null constraint final_adjustments_note_length check (char_length(btrim(note)) between 1 and 500),
  created_at        timestamptz not null default now()
);

comment on table final_adjustments is
  'The Final Wave (0018): the club''s own adjustments to a project''s total, apart from the guests'' gifts. Added to `received` wherever totals are shown.';

create index if not exists final_adjustments_final_project_idx on final_adjustments (final_project_id);

alter table final_adjustments enable row level security;

-- Every project with what it collected (gifts plus adjustments), how many
-- gifts and from how many guests.
create or replace function public.final_projects_admin(p_project uuid)
returns table (
  id        uuid,
  name      text,
  brief     text,
  "position" integer,
  hidden    boolean,
  received  bigint,
  gifts     bigint,
  givers    bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.id, f.name, f.brief, f.position, f.hidden,
         (coalesce(sum(g.amount), 0)
            + (select coalesce(sum(j.amount), 0) from final_adjustments j where j.final_project_id = f.id))::bigint,
         count(g.id),
         count(distinct g.account_id)
    from final_projects f
    left join final_gifts g on g.final_project_id = f.id
   where f.project_id = p_project
   group by f.id
   order by f.position, f.created_at;
$$;

-- The projects on the guests' list that collected something, most first.
-- Equal amounts share a place.
create or replace function public.final_board(p_project uuid, p_limit integer default 10)
returns table ("position" bigint, id uuid, name text, received bigint, givers bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with totals as (
    select f.id, f.name,
           (coalesce(sum(g.amount), 0)
              + (select coalesce(sum(j.amount), 0) from final_adjustments j where j.final_project_id = f.id))::bigint
             as received,
           count(distinct g.account_id) as givers
      from final_projects f
      left join final_gifts g on g.final_project_id = f.id
     where f.project_id = p_project and not f.hidden
     group by f.id, f.name
  )
  select rank() over (order by t.received desc), t.id, t.name, t.received, t.givers
    from totals t
   where t.received > 0
   order by t.received desc, t.name
   limit least(greatest(p_limit, 1), 100);
$$;

-- The projects on the guests' list, in the managers' order, with what each
-- collected and what this account gave it.
create or replace function public.final_for_account(p_account uuid)
returns table (id uuid, name text, brief text, received bigint, mine bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.id, f.name, f.brief,
         (coalesce(sum(g.amount), 0)
            + (select coalesce(sum(j.amount), 0) from final_adjustments j where j.final_project_id = f.id))::bigint,
         coalesce(sum(g.amount) filter (where g.account_id = p_account), 0)::bigint
    from accounts a
    join final_projects f on f.project_id = a.project_id and not f.hidden
    left join final_gifts g on g.final_project_id = f.id
   where a.id = p_account
   group by f.id
   order by f.position, f.created_at;
$$;

revoke execute on function public.final_projects_admin(uuid) from public, anon, authenticated;
revoke execute on function public.final_board(uuid, integer) from public, anon, authenticated;
revoke execute on function public.final_for_account(uuid) from public, anon, authenticated;
grant execute on function public.final_projects_admin(uuid) to service_role;
grant execute on function public.final_board(uuid, integer) to service_role;
grant execute on function public.final_for_account(uuid) to service_role;

notify pgrst, 'reload schema';
