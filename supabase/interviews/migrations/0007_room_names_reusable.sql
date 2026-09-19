-- =============================================================================
-- 0007 — Room names no longer need to be unique across the whole edition.
--
-- 0005's model is one room per day, often reusing the same name ("Room 1")
-- day after day — and a deleted room (0005's setRoomDeletedAction) keeps its
-- row, so its name stays "taken" forever even though nobody can see it any
-- more. The edition-wide unique(edition_id, name) constraint from 0001 was
-- never load-bearing: nothing references a room by name, only by id, so
-- dropping it costs nothing and removes a name collision that used to fail
-- with a raw database error instead of a sentence.
-- =============================================================================

alter table rooms drop constraint rooms_edition_id_name_key;
