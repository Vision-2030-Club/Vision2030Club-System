-- =============================================================================
-- 0015 — Let scores be deleted by cascade, never by hand.
--
-- 0012 guarded task_scores with a BEFORE INSERT OR UPDATE OR DELETE trigger.
-- The DELETE half was wrong: it also fires for the `on delete cascade` from
-- tasks, so removing a task — §7's whole point, and any ordinary cleanup of a
-- project — failed with "Task scores are set by confirm_task or
-- mark_task_not_done".
--
-- Fabricating a grade is the thing worth blocking, and that is an INSERT or an
-- UPDATE. Deletion is handled by privilege instead: `authenticated` simply
-- loses DELETE on the table, so the REST API cannot reach it, while the FK
-- cascade — which runs as the constraint, not as the caller — still can.
--
-- Note for later migrations: 0005 and 0012 both end with a blanket
-- `grant … delete on all tables in schema public to authenticated`. Any new
-- migration that repeats that line must re-run the revoke below.
-- =============================================================================

drop trigger if exists task_scores_enforce_workflow on task_scores;

create trigger task_scores_enforce_workflow
  before insert or update on task_scores
  for each row execute function app.enforce_score_workflow();

revoke delete on task_scores from authenticated;

-- Match the policy to the privileges that are actually left.
drop policy if exists task_scores_write on task_scores;

create policy task_scores_insert on task_scores
  for insert with check ((select app.can_confirm_task(task_id)));

create policy task_scores_update on task_scores
  for update
  using ((select app.can_confirm_task(task_id)))
  with check ((select app.can_confirm_task(task_id)));
