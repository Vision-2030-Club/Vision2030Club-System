-- =============================================================================
-- 0064 — Importing a task's history, for the KPI simulation.
--
-- The workflow functions stamp `now()` and the caller's identity, which is
-- right for live use and useless for loading last month's tracker: a task
-- the sheet says was assigned on 05/08, due 07/08 and delivered 09/08 has to
-- carry THOSE dates or the completion score means nothing.
--
-- `import_task_history` writes the workflow columns directly, with the
-- workflow flag set so the guard lets it through. It is callable by the
-- service role only — never from the app, never by a signed-in person — and
-- it touches one task per call. The seed script (scripts/simulate-kpi.mjs)
-- is its only caller.
-- =============================================================================

create or replace function public.import_task_history(
  p_task            uuid,
  p_assigned_at     timestamptz default null,
  p_submitted_at    timestamptz default null,
  p_confirmed_at    timestamptz default null,
  p_confirmed_by    uuid        default null,
  p_quality         text        default null,
  p_hours           numeric     default null,
  p_submission_note text        default null,
  p_review_note     text        default null,
  p_not_done_at     timestamptz default null,
  p_not_done_by     uuid        default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quality task_quality;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'import_task_history is for the service role only'
      using errcode = '42501';
  end if;
  if not exists (select 1 from tasks where id = p_task) then
    raise exception 'No such task' using errcode = 'P0002';
  end if;
  if p_confirmed_at is not null and p_not_done_at is not null then
    raise exception 'A task is confirmed or Not Done, not both' using errcode = '22023';
  end if;
  if p_confirmed_at is not null and p_submitted_at is null then
    raise exception 'A confirmed task must have been submitted' using errcode = '22023';
  end if;
  if p_confirmed_at is not null and (p_confirmed_by is null or p_quality is null) then
    raise exception 'A confirmed task needs a confirmer and a quality' using errcode = '22023';
  end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 999) then
    raise exception 'Hours must be between 0 and 999' using errcode = '23514';
  end if;

  perform set_config('app.task_workflow', 'on', true);

  update tasks
     set assigned_at     = coalesce(p_assigned_at, assigned_at),
         submitted_at    = p_submitted_at,
         confirmed_at    = p_confirmed_at,
         confirmed_by    = p_confirmed_by,
         not_done_at     = p_not_done_at,
         not_done_by     = p_not_done_by,
         hours           = p_hours,
         submission_note = coalesce(p_submission_note, submission_note),
         review_note     = coalesce(p_review_note, review_note)
   where id = p_task;

  if p_confirmed_at is not null then
    v_quality := p_quality::task_quality;
    if v_quality = 'not_done' then
      raise exception 'Not Done is p_not_done_at, not a quality' using errcode = '22023';
    end if;
    insert into task_scores (task_id, quality, scored_by, scored_at)
    values (p_task, v_quality, p_confirmed_by, p_confirmed_at)
    on conflict (task_id) do update
      set quality   = excluded.quality,
          scored_by = excluded.scored_by,
          scored_at = excluded.scored_at;
  elsif p_not_done_at is not null then
    insert into task_scores (task_id, quality, scored_by, scored_at)
    values (p_task, 'not_done', p_not_done_by, p_not_done_at)
    on conflict (task_id) do update
      set quality   = excluded.quality,
          scored_by = excluded.scored_by,
          scored_at = excluded.scored_at;
  else
    delete from task_scores where task_id = p_task;
  end if;

  perform set_config('app.task_workflow', '', true);
end;
$$;

revoke execute on function public.import_task_history(
  uuid, timestamptz, timestamptz, timestamptz, uuid, text, numeric, text, text, timestamptz, uuid
) from public, anon, authenticated;

grant execute on function public.import_task_history(
  uuid, timestamptz, timestamptz, timestamptz, uuid, text, numeric, text, text, timestamptz, uuid
) to service_role;

notify pgrst, 'reload schema';
