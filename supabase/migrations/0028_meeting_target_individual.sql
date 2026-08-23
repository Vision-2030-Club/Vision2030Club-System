-- =============================================================================
-- 0028 — A request can be aimed at one PERSON.
--
-- §2 of the meetings spec allows a meeting's target to be a specific person,
-- alongside a team, a project, or the Presidency. That is a generalisation of
-- the request engine rather than a meeting special case: any future type can
-- now route to an individual.
--
-- This file does ONE thing and looks oddly small on purpose. Postgres will not
-- let a new enum value be USED in the same transaction that adds it, and
-- db-push runs every migration in its own transaction — so adding the value
-- and everything that depends on it have to be two separate files. 0029 is the
-- rest.
-- =============================================================================

alter type request_target_kind add value if not exists 'individual';
