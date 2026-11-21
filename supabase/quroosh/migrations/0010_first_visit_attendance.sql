-- =============================================================================
-- Quroosh database — 0010: attendance pays on the first visit only.
--
-- Until now (0007) a guest was paid attendance_points (5,000) for every day
-- they were checked in at the gate. The club's decision (2026-11-21): the
-- 5,000 is for coming the first time; the days after it pay nothing. The
-- other ways to earn (the booths' challenges, the session check-in) are
-- unchanged.
--
-- Only sync_wallet changes. Before paying a check-in it now asks whether the
-- account already has a standing attendance entry, any day, and pays nothing
-- if so. The account's row is locked first, so two passes running at once
-- (the one after a check-in and the five-minute sweep) cannot both decide
-- "not paid yet" for two different days.
--
-- Entries already written are left as they are: a guest paid for two days
-- before this is applied keeps both. A first visit the gate undid has its
-- entry voided as before, and the guest's next standing check-in is then
-- their first visit and is paid.
--
-- attendance_points keeps its name; it now means "the quroosh for the first
-- visit". Safe to re-run.
-- =============================================================================

comment on column wallet_settings.attendance_points is
  'The quroosh a guest''s first check-in at the gate pays (0010; until then, every day''s). Later days pay nothing.';

create or replace function public.sync_wallet(p_project uuid, p_check_ins jsonb, p_cursor timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      jsonb;
  v_account  uuid;
  v_points   integer := public.wallet_attendance_points(p_project);
  v_count    integer;
  v_written  integer := 0;
begin
  update wallet_entries e
     set voided_at = now()
   where e.project_id = p_project
     and e.kind = 'attendance'
     and e.voided_at is null
     and e.source_ref in (
       select x->>'id' from jsonb_array_elements(coalesce(p_check_ins, '[]'::jsonb)) x
        where coalesce((x->>'undone')::boolean, false)
     );

  if v_points > 0 then
    for v_row in
      select x from jsonb_array_elements(coalesce(p_check_ins, '[]'::jsonb)) x
       where not coalesce((x->>'undone')::boolean, false)
       -- Oldest day first, so the first visit is the one paid.
       order by x->>'day'
    loop
      begin
        -- Locking the account makes "paid already?" and the insert one step
        -- for this account, whatever else is running.
        select a.id into v_account from accounts a
         where a.project_id = p_project and a.attendee_id = (v_row->>'attendee_id')::uuid
         for update;
        continue when v_account is null;
        -- The first visit only: any standing attendance entry means paid.
        continue when exists (
          select 1 from wallet_entries e
           where e.account_id = v_account and e.kind = 'attendance' and e.voided_at is null
        );
        insert into wallet_entries (project_id, account_id, kind, amount, day, source_ref)
        values (p_project, v_account, 'attendance', v_points, (v_row->>'day')::date, v_row->>'id')
        on conflict do nothing;
        get diagnostics v_count = row_count;
        v_written := v_written + v_count;
      exception
        -- One row that does not fit must not stop the others.
        when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
          or not_null_violation or check_violation then
          null;
      end;
    end loop;
  end if;

  insert into wallet_sync (project_id, check_ins_cursor)
  values (p_project, p_cursor)
  on conflict (project_id) do update
     set check_ins_cursor = coalesce(greatest(wallet_sync.check_ins_cursor, excluded.check_ins_cursor),
                                     wallet_sync.check_ins_cursor, excluded.check_ins_cursor),
         synced_at = now();

  return v_written;
end;
$$;

revoke execute on function public.sync_wallet(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_wallet(uuid, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
