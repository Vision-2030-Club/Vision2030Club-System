# Member data, imports and testing rounds

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

How the real club got into the database, and what each testing round with the club changed.

## The member list — imported

The first import (98 members, from `Database club.xlsx`) is done. The club's
**first-semester 1448H sheet** (173 people: the same 98 plus 76 new, one listed
twice) replaces it as the source, and is imported in place — once 0070 is
applied. What follows is how to do it, and the traps that bit the first time.

`node scripts/data/build-member-csv.mjs "path/to/sheet.xlsx"` (default
`Database club.xlsx`) turns the sheet into `members-import.csv`. It reads the
spreadsheet directly (an .xlsx is a zip of XML — no dependency), finds columns
by their Arabic header rather than their letter, and prints a pre-flight
report before writing anything, because `import_members` is all-or-nothing
and one bad row rejects the whole file. Then import the CSV at
`/ar/admin/import` as Super Admin.

**No student ID or national ID any more.** The 1448H sheet has neither and the
club does not want them collected through it. 0070 makes `members.student_id`
optional (still unique and format-checked when present) and the importer
matches people on **phone** (normalised as in 0022), falling back to **email**
when the phone matches nobody, so somebody who changed their number is updated,
not duplicated. The builder never writes either ID column. The IDs stored for
the first 98 are kept; nothing deletes them. A blank college, level or
graduation term in a file keeps what is stored instead of wiping it.

Things the sheet does which the script or the importer handles, and which will
catch out anyone editing them:

1. **The Arabic does not match the seeds.** Missing hamzas (`ادارة النادي`),
   `نائب رئيس` beside `نائب الرئيس`, `خطي المملكة` beside `خطى المملكة`, and
   `import_members` matches Arabic byte-exactly — so the CSV emits English
   keys. `مدير فريق` / `مدير الفريق` import as **Member**, by the club's
   decision (Oct 2026). Column I (an HR name per member, no header) is ignored
   on purpose; it belongs to a process outside this system.
2. **The same person twice.** Rows that share an email or phone and agree on
   team and role are merged and their projects combined; rows that disagree
   are reported.
3. **The Super Admin is in the file** as an ordinary `قائد فريق`. The importer
   overwrites roles, so importing it as written would demote the club's only
   admin with no way back from inside the app. Since 0070 `import_members`
   itself never changes the role of a current Super Admin (and says so after
   the import). **Still re-check that the admin holds `super_admin`
   immediately after an import.**
4. **Being in a project is not running it.** `import_members` originally wrote
   only `project_members`, but authority comes from `project_managers` — which
   is what `app.is_project_manager` reads and what the `own_projects` scope
   resolves through. 0047 fixes the importer and backfills. If you ever add a
   path that makes somebody a Project Manager, write both rows.
5. **The file decides who manages a project.** Since 0071, for every project
   the file names at least one Project Manager against, that project's
   managers become exactly the file's. Anyone else loses the manager link but
   stays a project member. Before 0071 the import only added managers, so
   the 1448H sheet (four per project, some new) pushed projects past the limit
   of four and the whole import failed. Note that the 0005 limit trigger is
   BEFORE INSERT and runs before `ON CONFLICT DO NOTHING`, so re-inserting an
   existing manager counts too. Never re-insert one into a full project.
6. **Otherwise the import only adds.** Members missing from the file stay as
   they are, and project membership is never removed. Roles DO follow the file, so a role
   changed in the app since the sheet was written is overwritten — compare the
   pre-flight role counts with the app before importing.

`--skip-invalid` writes the CSV without rows that cannot import, naming each.
`db:load-club` still expects the old CSV with student IDs and refuses the new
one in its validation step, before writing anything; do not use it for the
1448H sheet.

### A dry run is available and worth doing

The whole import can be rehearsed inside a transaction that rolls back, by
impersonating the Super Admin with
`set_config('request.jwt.claims', …)`. That is how the demotion trap above was
caught before it happened rather than after. Do this before any future import.

## The semester timeline

`node --env-file=.env.local scripts/data/import-timeline.mjs [--sheet 1] [--dry]`
reads `First Semester Timeline- 26_48 (1).xlsx` and writes its dated events as
`kind = 'club'` calendar entries — 12 of them, currently live, spanning
2026-08-08 to 2026-11-21.

`kind = 'club'` is the point: 0007's select policy lets any signed-in person
read a club entry, so the plan reaches all 98 members without an audience row
each. Idempotent by title + date, so re-running is safe.

The workbook has ten sheets, one per team; sheet 1 is the club-wide one. Its
layout alternates a row of dates with a row of labels, matched by column
letter, and column B is anchored to the week's first day because it has no date
of its own. **Cells holding a bare number are skipped and listed rather than
guessed at** — twelve of them. If any are real events, put a name in the cell
and re-run.

### Reading .xlsx without a dependency

Both scripts share a hand-rolled zip reader, and it must walk the **central
directory**, not the local file headers. An entry written in streaming mode
carries zero sizes in its local header and puts the real ones in a trailing
data descriptor, so a reader that trusts local headers silently skips parts —
which is why the timeline file first appeared to have no sheets at all.

## The first testing round

The IT team used the test club for an afternoon and sent fifteen comments.
Every one was read against what the database showed had happened, and split
into bugs with one right answer and questions with several; the questions
were put to the club. Migration `0057` and `npm run db:round1` carry the
result. What the club decided:

- **A Director sees their own team's tasks**, plus project tasks where they
  are on the project. `tasks.view` for team_director had been seeded as
  `all` (0004) — a Finance Director had Design's tasks on their board.
- **Directors do not run projects.** `projects.manage` is `none` for them.
  Projects are created by the Presidency and run by their Project Managers;
  a Director who needs to be in one is added as a member or manager.
- **Members do not ask for meetings.** `meeting_requests.submit` is held by
  Club Management (Presidency, Directors, PMs). A Member can still be the
  person a meeting is aimed at.
- **A meeting is a start and a length** — 30 minutes or 1 hour, the same
  choice the Rooms page already offered — never an end typed by hand. The
  start cannot be in the past (`no_past` on the field; RequestFields sets
  the input's `min`, requests/actions.ts is the check, on the club's clock).
- **A task can be held by several people**, each scored in their own KPI; a
  project counts the task once. The unique index that said otherwise is gone;
  the submit and confirm checks now ask "is the caller among the assignees".
- **Experience cannot be in the future.**

Bugs fixed on the way: the request page never checked `target_member_id`
when deciding whose buttons to draw, so a meeting aimed at a person showed
its receiver nothing (`isRequestApprover` in src/lib/requests.ts is now the
one mirror of `app.can_act_on_request`); "awaiting my decision" never asked
whose turn it was (`canActOnRequest`); the New Task form offered every
project and team to everyone, so a Director's attempt was a bare RLS error
(it now offers only what the caller may actually create for, and nothing at
all to a Member); `assignable_members` returned nobody for a Project
Manager; and the dashboard was never revalidated when the calendar, a
booking or a request changed, which read as the "coming up" box changing
for no reason.

### The second batch

Nine more comments the same evening. Migration `0058`; the checks joined
`npm run db:round1`.

- **Submitting a request leaves the form** and lands on *My requests* with a
  confirmation; an error stays on the form with the answers intact.
- **Every inner page has a back link** to the list it belongs to
  (`PageHeader`'s `back`) — the list, not browser history, because a page
  opened from a push notification has none.
- **Announcements**: the form only shows on a Director's own team's page (it
  used to show on every team's, and the database refused); and the team is
  now told when one is posted (`team_posts_push_notify`).
- **A task has a page** (`/tasks/[id]`): the card, the description, dates,
  everyone on it, the delivered link and both comments — and, for whoever
  may administer it, changing who holds it (`setTaskAssigneesAction`).
- **A link and a comment** when submitting any task (the link required only
  where the request type demands it); a comment when confirming.
  `tasks.submission_note` is new; `review_note` now holds the reviewer's
  comment on confirming as well as on sending back.
- **A calendar entry is deleted, or edited, by its creator or the Presidency.**
  Directors no longer touch what others put on their team's calendar.
- **Directors and Project Managers see the directory as names** — their
  team's and their projects' members. Profiles stay with the Presidency and
  HR: `members.directory` is `own_team` / `own_projects` for them, and
  every "open a profile" link checks for scope `all`.

### The third batch

Follow-ups from the same testers over the next days. Migrations `0059`–`0061`
(all three applied through the SQL Editor — port 5432 was unreachable from the
IT lead's machine, see below); the checks joined `npm run db:round1`.

- **No past dates on a task** (`0059`): starting and delivery dates in the
  request transitions are `no_past`, and the task form refuses them too.
- **A Project Manager sees their projects' tasks only** (`0060`): `tasks.view`
  went from `all` to `own_projects`, matching the rest of their scopes.
- **Whoever sees the whole club can look at one slice of it**: the task and
  request lists carry a team/project filter (`ScopeFilter`, `?scope=team:…` /
  `project:…`) for anyone whose view scope is `all`; the tabs keep it.
- **Sorted by urgency**: tasks by due-date risk (overdue, then high, medium,
  low, pending review, none, finished), then due date, then newest
  (`compareTasks`); requests by their own priority or urgency, none last,
  finished last, then deadline (`compareRequests`).
- **"Open" means open to claim** — a task with anyone on it is no longer
  listed there.
- **A project's managers must hold the Project Manager role** (`0061`): a
  trigger refuses the row on `project_managers` and `project_split_managers`,
  and the project page offers only PM-role holders not already managing.
- **Language and sign-out live inside the profile menu** (`ProfileMenu`), and
  the calendar fits a phone with a "September 2026" heading between arrows.
- **Each task card has a "View task" button**; a linked title read as plain
  text on a phone. The task's own page leaves the button out.
- **The room schedule fits its bookings**: rows are a floor, not a fixed
  height, so a booking's three lines and its cancel link are never clipped;
  the frame is only as wide as the rooms need. Half-hours that have already
  ended are greyed out and not offered (the one under way stays open), and
  past bookings stay on the record, dim. The clock is the server's at render
  time, on the club's zone (`elapsedUntil`).

## The real club is back (2026-09-16)

The tester club from `db:reset-for-testing` was replaced with the real one by
`npm run db:load-club -- --yes` (`scripts/data/load-club.mjs`). It backs everything
up first, wipes the same tables the reset script does, then loads
`members-import.csv` (regenerate it from `Database club.xlsx` with
`build-member-csv.mjs` first), restores the five projects and the twelve
timeline entries from the newest `backups/reset-*.json` with their ids kept,
and replays the role changes the club made in the app after the first import
— which is why the club's President and one Vice President hold those roles
in the app although the spreadsheet still says otherwise. Without that replay
the spreadsheet does not even load: Career Fair would name five Project
Managers against a limit of four.

Two things worth knowing about it:

- It runs over the REST API and the Auth admin API with the service-role key,
  not over 5432, so it works where `db:push` and the suites do not. The price
  is no transaction: it validates everything and prints the plan before the
  first write (`--dry` stops there), but a failure part-way means running it
  again.
- Only the Super Admin keeps a login. The other 97 set a password at first
  sign-in, as after the first import. One member is still missing: the
  spreadsheet has no national ID for them.
