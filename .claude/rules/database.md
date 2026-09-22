---
paths:
  - "supabase/**"
  - "scripts/**"
  - "src/lib/supabase/**"
---

# Database changes

Two Supabase projects: the club database (`supabase/migrations/`) and the
Mock Interviews database (`supabase/interviews/migrations/`). A mistake here
loses the club's data, so:

- A migration is a NEW numbered file. Never edit a migration that has been
  merged; the `schema_migrations` table records it as applied and a change
  would silently never run.
- Every migration is a plain `.sql` file that can be pasted into the
  Supabase SQL editor by hand and applied top to bottom. Use
  `create or replace function`, `if not exists`, and `if exists` so it can
  be re-run. Functions are `security definer` with
  `set search_path = public, pg_temp`, and refuse with `app.refuse(hint,
  message)` so the app can translate the hint.
- Never run `db:push`, an importer, a seed, or a test script against a
  real database from an assistant session. Say in the pull request who will
  apply the migration and when. Code merged before its migration is applied
  must degrade quietly (a missing column or function must not crash a
  page).
- Row Level Security stays deny-all on the interviews database; only the
  service role reads it, and only from server code (`server-only`). Never
  add a policy that opens a table to the anon key.
- Never write a migration that deletes rows or drops a column that holds
  data. Soft-delete with a flag, or say why in the pull request and let a
  person decide.
- New tables and columns need a matching type in `src/lib/interviews/types.ts`
  or the club equivalent, and a note in `HANDOFF.md`.
