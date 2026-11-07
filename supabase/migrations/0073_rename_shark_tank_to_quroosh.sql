-- =============================================================================
-- 0073 — The Shark Tank project is called Quroosh (قروش).
--
-- The club decided (2026-11-07) that the project's English name is
-- "Quroosh", the transliteration of its Arabic name قروش, instead of
-- "Shark Tank". Every page reads the name from this row (sidebar, project
-- pages, components, KPI), so this one update renames it everywhere.
--
-- scripts/data/build-member-csv.mjs maps the sheet's قروش to the English
-- name and matches on it, so it changes in the same pull request.
--
-- Data only: no table, policy or function changes, nothing deleted. Safe to
-- re-run: once renamed, the WHERE clause matches nothing.
-- =============================================================================

update projects
   set name_en    = 'Quroosh',
       name_ar    = 'قروش',
       updated_at = now()
 where name_en = 'Shark Tank';
