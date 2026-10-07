-- =============================================================================
-- 0011 — advance_stage can refuse when the booking has moved on.
--
-- A Status edited in a Google Sheet becomes the booking's stage only if the
-- app has not moved that student since the sheet was last written (the
-- app's sheetPull.ts). The app used to check that in two steps — read the
-- stage, then call advance_stage — so a click on the floor board landing
-- between the two could be overwritten by the sheet.
--
-- advance_stage now takes an optional p_expected: the stage the caller
-- believes the booking is in. The booking row is locked (`for update`) and
-- the stage compared inside the same transaction, so nothing can slip in
-- between; when it differs the call refuses with the hint `stage_changed`
-- and changes nothing. Every existing caller passes no p_expected and
-- behaves exactly as before.
--
-- The old four-argument function is dropped first: keeping it next to the
-- new one would make every call without p_expected ambiguous. Nothing else
-- in the database calls it. The app keeps working before this is applied: it
-- falls back to the two-step check when the new parameter is unknown.
--
-- Safe to re-run: `drop function if exists` + `create or replace`.
-- =============================================================================

drop function if exists public.advance_stage(uuid, text, jsonb, boolean);

create or replace function public.advance_stage(
  p_booking     uuid,
  p_to          text,
  p_actor       jsonb,
  p_as_manager  boolean default false,
  p_expected    text default null
)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b        bookings;
  v_from   text;
  v_name   text := coalesce(p_actor ->> 'name', 'system');
begin
  perform app.set_actor(p_actor);

  if p_to not in ('scheduled', 'arrived', 'in_interview', 'done', 'no_show') then
    perform app.refuse('bad_stage', 'Unknown stage.');
  end if;

  -- Locked until this transaction ends, so the comparison below and the
  -- update after it see the same row.
  select * into b from bookings where id = p_booking and cancelled_at is null for update;
  if b.id is null then
    perform app.refuse('not_found', 'No such active booking.');
  end if;
  perform app.live_edition(b.edition_id);

  v_from := b.stage;

  if p_expected is not null and v_from <> p_expected then
    perform app.refuse('stage_changed', format('The stage changed to %s before this edit arrived.', v_from));
  end if;

  if v_from = p_to then
    return b;
  end if;

  if not p_as_manager and not (
       (v_from, p_to) in (
         ('scheduled', 'arrived'), ('arrived', 'in_interview'), ('in_interview', 'done'),
         ('scheduled', 'no_show'), ('arrived', 'no_show'),
         ('arrived', 'scheduled'), ('in_interview', 'arrived'), ('done', 'in_interview'),
         ('no_show', 'scheduled')
       )) then
    perform app.refuse('bad_transition', format('Cannot move from %s to %s.', v_from, p_to));
  end if;

  update bookings
     set stage            = p_to,
         stage_changed_at = now(),
         stage_changed_by = v_name,
         arrived_at  = case when p_to = 'arrived'      then coalesce(arrived_at, now())
                            when p_to = 'scheduled'    then null
                            else arrived_at end,
         started_at  = case when p_to = 'in_interview' then now()
                            when p_to in ('scheduled', 'arrived', 'no_show') then null
                            else started_at end,
         finished_at = case when p_to = 'done'         then now()
                            else null end
   where id = p_booking
   returning * into b;

  return b;
end;
$$;

-- Same grants as every function here (0004): the service role only.
revoke all on function public.advance_stage(uuid, text, jsonb, boolean, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.advance_stage(uuid, text, jsonb, boolean, text) to service_role;
  end if;
end;
$$;

-- PostgREST reads the function list once; tell it to look again.
notify pgrst, 'reload schema';
