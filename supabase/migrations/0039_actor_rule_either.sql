-- =============================================================================
-- 0039 — A transition either side may make.
--
-- §2 of the requests-become-tasks spec: at the confirm/reject moment, EITHER
-- side can ask for a meeting first. The engine could not express that. Its
-- actor rules were `requester`, `target_approver` and `permission`, and
-- `request_transitions` allows exactly one row per (type, from, to) — so one
-- move could belong to one side or the other, never both.
--
-- Adding a fourth rule is the honest fix. Two rows with different actors would
-- have hit the unique constraint, and splitting the destination into
-- "awaiting_meeting_theirs" / "awaiting_meeting_ours" would have been the
-- limitation leaking into the workflow's own vocabulary.
--
-- Alone in its own file because Postgres will not let a new enum value be USED
-- in the transaction that adds it, and db-push runs one transaction per file.
-- 0040 is the rest.
-- =============================================================================

alter type request_actor_rule add value if not exists 'either';
