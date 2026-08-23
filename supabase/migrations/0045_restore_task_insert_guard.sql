-- =============================================================================
-- 0045 — Put back the INSERT branch of the task workflow guard.
--
-- Caught by `npm run db:kpi`, which stopped at its very first check.
--
-- 0012's `app.enforce_task_workflow` had two branches. On INSERT it allowed a
-- task to be created already ASSIGNED — that is ordinary, a Director hands out
-- work when they create it — while refusing one created already submitted,
-- confirmed or marked Not Done. On UPDATE it guarded the progress columns.
--
-- 0038 needed `submission_url` added to the guarded set and rewrote the
-- function to do it, losing the INSERT branch on the way. Every insert that
-- set `assigned_at` then failed, which is most of how tasks are made.
--
-- Restored as it was, with `submission_url` added to both branches: work
-- cannot arrive delivered, and the link is set by submitting, not by writing
-- the column.
--
-- Note what is deliberately NOT guarded on update: `assigned_at` and
-- `review_note`, exactly as in 0012. Tightening those is arguably right now
-- that Assigned Date carries a Director's commitment, but it is a separate
-- decision from fixing this, and doing both at once is how a fix becomes a
-- regression.
-- =============================================================================

create or replace function app.enforce_task_workflow()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.task_workflow', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.submitted_at is not null
       or new.confirmed_at is not null
       or new.not_done_at is not null
       or new.confirmed_by is not null
       or new.not_done_by is not null
       or new.submission_url is not null then
      raise exception
        'A task cannot be created already submitted, confirmed, marked Not Done, or delivered'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.submitted_at is distinct from old.submitted_at
     or new.confirmed_at is distinct from old.confirmed_at
     or new.confirmed_by is distinct from old.confirmed_by
     or new.not_done_at  is distinct from old.not_done_at
     or new.not_done_by  is distinct from old.not_done_by
     or new.rejected_at  is distinct from old.rejected_at
     or new.submission_url is distinct from old.submission_url then
    raise exception
      'Task status is computed, not set. Use submit_task_for_review, confirm_task, reject_task, or mark_task_not_done'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
