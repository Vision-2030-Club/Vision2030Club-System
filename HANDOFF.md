# Handoff — Vision 2030 Club System

Build is green (`npm run build`) and `npx eslint` is clean. **All 48
migrations are applied** to a live Supabase project. Everything is verified end
to end against the real database over the REST API rather than through the UI:
`db:test` 32/32 · `db:rooms` 27/27 · `db:meetings` 38/38 · `db:design` 48/48 ·
`db:kpi` 72/72 · `db:prove` 12/12 — **229 checks**.

The Meetings / Rooms / Design Request build is **complete**, all six steps. So
is the KPI module, the generic request engine, and requests-that-become-a-task
(Design and Media).

**The club's real membership is loaded: 98 active members**, 19 Project
Managers with authority over their own projects, and the first-semester
timeline on the calendar. The system is no longer a demo with one account in
it, which changes how you should read the rest of this document — see
"Suites written against an empty club" below.

**The Google half is built but not switched on** — see "Connecting Google".
Nothing waits on it: in-person meetings work today, and an online meeting is
confirmed and on the club's own calendar whether or not Google is reachable.

**Nobody has clicked through the UI yet.** Every guarantee below was proved
against the database, not the interface. The management team has been asked to
test; expect their findings to be about screens, not rules.

The spec being implemented is `vision2030_system_logic_prompt.md`. Section
references below (§2, §3, …) point into it.

---

## Performance — what was done, and what is next

Every page is user-scoped and therefore fully dynamic; that part is correct and
cannot change. What was wrong is that nothing *streamed*:

- `loading.tsx` now exists beside every heavy route (`src/components/Skeleton.tsx`
  supplies the shapes). A `loading.tsx` covers its child segments too, so the
  detail pages — which have the deepest waterfalls — are covered by their
  parent's.
- The shared layout used to make three serial round trips before any page could
  start. `getMyMember` and `getMyPermissions` now run together, and the avatar's
  signed URL streams in behind `<Suspense>` instead of blocking the shell.
- `/kpi` is no longer revalidated on every task button press. It issues five
  unfiltered aggregates over every task in the club; the cheapest buttons were
  paying for the most expensive page.
- `ensureMeetLink` is no longer awaited — approving a meeting used to wait on an
  OAuth refresh and a Calendar insert first.
- `experimental.staleTimes` gives the client router 30s on dynamic pages, so
  Back stops re-running everything.

**The next performance item, not yet done:** `task_kpi` runs roughly eight
non-inlinable `SECURITY DEFINER` calls PER ROW — `0042` lines 43-45 plus `0016`
lines 62-68 — and several of them re-read the same task row. At 300 tasks that
is thousands of nested calls, and it is the real ceiling on `/tasks` and `/kpi`.
Fixing it means reworking those policies and the capability flags together,
with the suites as the safety net.

**Region mismatch, now confirmed and still unfixed.** The Supabase project is
in `ap-southeast-2` (Sydney); the Vercel function answers from `bom1` (Mumbai).
Every round trip pays that distance twice, and the layout alone makes several.
This is a settings change rather than a code one, and is probably the largest
single win left on perceived speed.

## Interface guidelines

`npx skills add vercel-labs/agent-skills -s web-design-guidelines --full-depth`
installs Vercel's checklist; the audit found and fixed:

- **No button in the app had a visible focus ring.** `Button` in
  `src/components/ui.tsx` now has `focus-visible:outline-*`, and named
  transition properties instead of `transition` on everything.
- `touch-manipulation` on buttons and fields (removes the 300ms double-tap delay).
- `font-variant-numeric: tabular-nums` folded into `.ltr-nums` in `globals.css` —
  every ID, phone, time and score already carries that class, so digits line up
  everywhere from one change.
- `color-scheme: light` declared, so native controls stop rendering dark.
- A skip link in the app layout; `width`/`height` on the avatar `<img>` to stop
  the header jumping.

Design advice deliberately NOT taken, because it would break this app:

- *"Swap the font to Geist/Satoshi/Outfit"* — none carry Arabic glyphs.
  `src/lib/fonts.ts` pairs IBM Plex Sans Arabic with Gilroy on purpose.
- *"Dashboards should not have a left sidebar"* — `NavLinks.tsx` is built on
  logical properties precisely so it flips for RTL.
- *"Add background imagery and noise"* — external images, in an app being fixed
  because it is slow.

## The member list — imported

**This has been done.** 98 active members are in the live database. What
follows is how to do it again, and the traps that bit the first time.

`node scripts/build-member-csv.mjs` turns `Database club.xlsx` into
`members-import.csv`. It reads the spreadsheet directly (an .xlsx is a zip of
XML — no dependency) and prints a pre-flight report before writing anything,
because `import_members` is all-or-nothing and one bad row rejects all hundred.

Four things that spreadsheet does which the script handles, and which will
catch out anyone editing it:

1. **Two column layouts.** The club-management block has a project in column H
   and the student ID in I; every other block has the student ID in H. The
   script decides by which column looks like a student ID.
2. **The Arabic does not match the seeds.** `مدير مشروع` vs `مدير المشروع`,
   and one row missing its hamza in `ادارة النادي`. `import_members` matches
   Arabic byte-exactly, so the CSV emits English keys instead. (0047 renamed
   the roles to `قائد فريق` and `مدير مشروع`, so the sheet's Arabic now
   matches for those two — but the CSV still emits keys, which is safer.)
3. **The Super Admin is in the file** (row 131, student ID `445106843`) as
   `قائد فريق`. The importer matches on student ID and overwrites role, so
   importing it as written would demote the club's only admin with no way back
   from inside the app. `KEEP_ROLE` in the script pins that row to
   `super_admin`. **Always re-check that the admin still holds `super_admin`
   immediately after an import.**
4. **Being in a project is not running it.** `import_members` originally wrote
   only `project_members`, but authority comes from `project_managers` — which
   is what `app.is_project_manager` reads and what the `own_projects` scope
   resolves through. So the first import left all 19 Project Managers as
   ordinary members of the projects they run, unable to assign work or act on
   requests. 0047 fixes the importer and backfills. If you ever add a path that
   makes somebody a Project Manager, write both rows.

`--skip-invalid` writes the CSV without rows that cannot import, naming each.
**One member is still missing: Nawaf Zaid Alzaid** (row 42), whose national ID
is `-`. Fix the spreadsheet and re-run to add him.

### A dry run is available and worth doing

The whole import can be rehearsed inside a transaction that rolls back, by
impersonating the Super Admin with
`set_config('request.jwt.claims', …)`. That is how the demotion trap above was
caught before it happened rather than after. Do this before any future import.

## Who can see the member directory

`/members` and each profile page are limited to the Presidency and HR's
Directors — six people today. This is `members.directory`, added by 0048.

The obvious implementation would have been to take `members.view` away from
everyone else, and it would have been quietly damaging. `members.view` decides
who can read a member ROW, and the assignee dropdown on `/tasks`, the people
picker for staffing a project split, the target of an individual meeting
request, every team roster and the calendar audience picker are all plain
selects against `members`. Revoking it leaves a Team Director looking at a
dropdown holding only their own name.

So the directory screen has its own narrower permission and `members.view` is
untouched. `MemberLink` (`src/components/MemberLink.tsx`) renders a name as a
link only when the viewer can follow it, so nobody is offered a link into a
refusal — and the "you can always open your own profile" rule lives inside that
component rather than at each call site.

**Be clear about what this is not: a data boundary.** `members_select` still
resolves `members.view`, which every role holds at `all`, so a signed-in member
can read email, phone, student ID and college through the API directly. This
stops the UI handing them out; it does not stop the database. Making that a
real boundary means moving those columns behind a view, or narrowing
`members.view` and giving the pickers a name-only source — a deliberate piece
of work, not a patch.

National IDs are the exception and were never part of this: `member_sensitive`
is a separate table with its own policy, Presidency and HR only.

## The semester timeline

`node --env-file=.env.local scripts/import-timeline.mjs [--sheet 1] [--dry]`
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

## Brand assets

`Assets/` holds the originals; `public/brand/` holds what the app actually
loads (`layout.tsx` and the login page). They are separate on purpose — copy
into `public/brand/` under the app's own names rather than pointing the app at
`Assets/`.

Two logo animations were supplied. `Logo2 Variation-.mp4` is 604 KB, H.264 +
AAC, 6 seconds, and is web-usable — it is committed but **not yet referenced by
any page**; the natural home is the login screen, muted and looping, with a
still fallback under `prefers-reduced-motion`. The `.mov` is 21 MB QuickTime
with no browser-playable codec (ProRes family): it is an editing master, is
gitignored at the repo root, and should stay in Drive.

## Deploying

The app needs three environment variables at runtime, plus three for push:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
CRON_SECRET
```

Without the push three, everything still works and nobody is notified — the
profile card says push is not set up on the server when the test button is
pressed. See "Push notifications" below for where they come from.

`SUPABASE_DB_URL` is deliberately NOT among them — it is a direct Postgres
connection used only by `npm run db:push` from a laptop, and a web host has no
business holding one. The `GOOGLE_*` three are optional; without them the Google
admin page says so and everything else works.

**`NEXT_PUBLIC_*` values are baked in at BUILD time.** Adding them to a host
and restarting does nothing — you have to redeploy.

The first Vercel deploy had none of them set, and the whole site answered
`500 Internal Server Error` with an empty body, because `src/proxy.ts` runs
before every page and was the first thing to touch them. `src/lib/supabase/env.ts`
now names the missing variable in the log instead. If a deployment is ever blank
like that again, the fastest check is a static file: `/brand/logo-horizontal.png`
returning 200 while every page returns 500 means the proxy is throwing, not the
pages.

## Connecting Google

Everything is written; it needs a Google application and one authorisation.
Until then, confirmed online meetings sit at `meet_state = 'pending'` and the
admin page says so. **This is not a blocker** — the meeting is agreed, booked
and on the club's own calendar regardless.

A Super Admin does this once:

1. Google Cloud console → new project → enable the **Google Calendar API**.
2. Create an OAuth client, type **Web application**.
3. Add the redirect URL shown on `/admin/google` to its Authorised redirect
   URIs. It must match character for character. That page now always shows the
   value — it used to render `—` whenever `GOOGLE_REDIRECT_URI` was unset,
   which is precisely when somebody is standing in the Cloud console needing
   it, so it falls back to deriving the URL from the host it is served on. On
   the current deployment it is
   `https://vision2030club-system.vercel.app/api/google/callback`.
4. Put these in `.env.local` and restart:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
5. Sign in as Super Admin, open **Admin → Google**, press Connect, and approve
   as the club's shared account — not a personal one.

The refresh token is stored in `google_credentials`, which has RLS enabled and
**no policies at all**, so only the service-role client can read it. The client
ID and secret stay in environment variables, because they identify the
application rather than the account.

Note what has NOT been exercised: the calls to Google themselves. Everything up
to the API call is covered by `db:meetings`, but nobody has watched a real Meet
link come back, because that needs an account this repo does not have. Expect
to iterate on that first connection.

## Push notifications

Every member is on an iPhone, and on iOS a website can only receive push when
it has been **added to the Home Screen** (iOS 16.4+). So the feature is in two
halves: the site is installable (`src/app/manifest.ts`, the `appleWebApp`
metadata in the root layout, `public/icons/`), and once installed a card on
the person's own profile turns notifications on for that device
(`src/components/PushSettings.tsx`). The dashboard nudges anyone who has not.
No Apple Developer account, certificate or App Store is involved: standard Web
Push with VAPID keys, which Apple routes through APNs itself.

Sending is split the same way the Meet link is:

- **The database decides who.** `0049` writes a row per person to
  `notification_outbox` from triggers on `requests`, `tasks` and
  `task_assignees` (`0050` adds tasks posted for claiming). The recipient rules are the permission map run backwards
  (`app.members_who_can`, `app.request_actors`, `app.task_reviewers`), with
  the narrowest authority preferred — the target team's Directors, not the
  President, are told about a team-level request. Nothing is written for a
  person with no device, and a bug in a trigger is caught and logged rather
  than blocking the write it is about.
- **The server sends.** `src/lib/push.ts` leases rows (`push_claim_outbox`),
  renders each in the language of the device, sends with `web-push`, and
  deletes any subscription the push service reports gone (404/410 — that is
  what removing the icon from the Home Screen looks like). It is kicked at
  the end of the request and task actions, so a phone hears about an approval
  at once, and swept by `/api/push/cron` every five minutes, which also queues
  reminders for anything on the calendar starting
  within the hour (`push_enqueue_reminders`, keyed so a second sweep writes
  nothing) and prunes rows sent a week ago.

What gets sent today: request submitted (to whoever can act), request moved
(to the requester) and awaiting (to whoever is next), meeting confirmed (to
everyone in it), task assigned / ready for review / confirmed / returned / not
done, a project task posted for claiming (to the split's members when it is
scoped to a split, otherwise the project's — `0050`), a claim (to whoever
posted it), and a reminder before a calendar entry. Adding one is an
`app.push_enqueue(...)` call in a trigger; there is no code path outside the
database that decides a recipient.

Setting it up once:

1. `npx web-push generate-vapid-keys`, put the pair in Vercel as
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, and **keep it** —
   every device's subscription is bound to the public key, so a new pair logs
   every phone out of notifications. The `.env.local` on the laptop that
   built this has a pair already; use the same one.
2. Set `CRON_SECRET` to any long random string, in Vercel AND in `.env.local`,
   then run `npm run push:cron`. That schedules the sweep with **pg_cron inside
   Supabase** (every five minutes, calling the deployed route with the secret
   as a bearer token, kept in Supabase Vault). Not a Vercel cron: the Hobby plan
   allows one a day, and the build is refused outright for anything more — that
   is exactly how the first deploy of this failed. `npm run push:cron -- --status`
   shows the last runs and the HTTP status the site answered; `-- --off` removes
   it. If it is ever not scheduled, only reminders and retries stop — the
   inline sends after each action still happen.
3. Redeploy (the public key is `NEXT_PUBLIC_*`, so it is baked in at build).

iOS things that will come up:

- The installed app has its **own cookie jar** — everyone signs in once more
  inside the icon. Email + password makes that a non-event.
- The permission prompt appears only inside the installed app and only from a
  tap, which is why the card's states are what they are. "Don't Allow" is
  final for that install; the fix is to remove and re-add the icon.
- Testing needs HTTPS: the deployed site, or `ngrok` in front of `next dev`.
  Nothing about push can be exercised over http://localhost from a phone.

`npm run db:notify` proves the database half: who is and is not told, per
event, plus that the outbox and the two service-role functions are unreachable
through the API. What it cannot prove is Apple delivering — that is the test
button on the profile card, pressed on a real iPhone.

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
`npm run db:load-club -- --yes` (`scripts/load-club.mjs`). It backs everything
up first, wipes the same tables the reset script does, then loads
`members-import.csv` (regenerate it from `Database club.xlsx` with
`build-member-csv.mjs` first), restores the five projects and the twelve
timeline entries from the newest `backups/reset-*.json` with their ids kept,
and replays the role changes the club made in the app after the first import
— which is why Abdullah Alhussan is President and Hamad Alkhorayef a Vice
President although the spreadsheet still says otherwise. Without that replay
the spreadsheet does not even load: Career Fair would name five Project
Managers against a limit of four.

Two things worth knowing about it:

- It runs over the REST API and the Auth admin API with the service-role key,
  not over 5432, so it works where `db:push` and the suites do not. The price
  is no transaction: it validates everything and prints the plan before the
  first write (`--dry` stops there), but a failure part-way means running it
  again.
- Only the Super Admin keeps a login. The other 97 set a password at first
  sign-in, as after the first import. Nawaf Zaid Alzaid is still missing
  (no national ID in the spreadsheet).

## Picking this up again

Nothing is blocked. To get running from a fresh clone:

1. `cp .env.example .env.local` and fill in all four values. `.env.example` is
   gitignored along with every other `.env*` file, so it is not in the repo —
   ask whoever set the project up, or read the four names out of
   `scripts/db-push.mjs` and `src/lib/supabase/*.ts`.
   - `SUPABASE_SERVICE_ROLE_KEY` is the `sb_secret_…` value from Project
     Settings → API. It is **not** the database password; putting the password
     there fails in a confusing way (see "Known trap" below).
   - `SUPABASE_DB_URL` is the Connect → **Session pooler** URI with your
     password substituted for `[YOUR-PASSWORD]`.
2. `npm install && npm run db:push` — applies anything not yet in
   `schema_migrations`. Against the current project this is a no-op.
3. `npm run dev`, then sign in at `/ar/login`.

### State as of this commit

- **48 migrations** applied to the live Supabase project.
- `db:test` 32/32 · `db:rooms` 27/27 · `db:meetings` 38/38 · `db:design` 48/48 ·
  `db:kpi` 72/72 · `db:prove` 12/12 — 229 checks, all green.
- **98 active members**, 19 Project Managers, 12 semester calendar entries.
- Six people can open the member directory: Super Admin, President, two Vice
  Presidents, two HR Directors.
- Deployed at `vision2030club-system.vercel.app`; `/ar/login` returns 200.
- Public sign-ups should be **off** in the dashboard (Authentication → Sign In /
  Providers). §4 forbids self-registration; the app never calls `signUp`, but
  the setting closes the door properly. Verify this is still off.

### Port 5432 is blocked on some networks

`npm run db:push`, and every `db:*` suite, open a direct Postgres connection.
Campus wifi and some ISPs block 5432 and 6543 outright, and the failure looks
like `ETIMEDOUT` against an AWS address, which reads as "the database is down".
It is not. The way to tell them apart: the REST API on 443 still answers, and
the deployed site still works, because those go over HTTPS. Tether to a phone,
or apply SQL through the Supabase dashboard's SQL Editor — and if you do the
latter, add the tracking row yourself, or `db:push` will think the migration is
still pending:

```sql
insert into schema_migrations (name) values ('00NN_your_migration.sql')
on conflict (name) do nothing;
```

### Adding the first account on a NEW project

There is no registration (§4), so the first account is made by hand — insert
the member row, then sign in at `/ar/login`, which prompts you to set a
password once:

```sql
insert into members (email, name_en, name_ar, student_id, team_id, role_id)
values (
  'you@example.com', 'Your Name', 'اسمك', '400000001',
  (select id from teams where key = 'IT'),
  (select id from roles where key = 'super_admin')
);
insert into member_sensitive (member_id, national_id)
values ((select id from members where email = 'you@example.com'), '1000000001');
```

### Known trap: a bad service-role key looks like a missing account

`loginAction` looks the email up through the service-role client *before*
anything else, and treats a failed lookup as "no member found". So if
`SUPABASE_SERVICE_ROLE_KEY` is wrong, the login page reports **"No account
found"** for a perfectly valid email, and nothing in the UI points at the key.
If that happens, check the key before you go looking at the members table.

---

## What exists

### Stack

Next.js 16.3 (App Router, Turbopack) · TypeScript · Tailwind v4 · next-intl 4 ·
Supabase (Postgres + RLS + Auth). Node 24.

Two Next 16 details that differ from older docs: middleware is now
**`proxy.ts`** (`src/proxy.ts`), and version-matched docs ship inside
`node_modules/next/dist/docs/` — read those rather than relying on memory.
`NEXTJS_NOTES.md` is the auto-generated pointer to them.

### The two ideas everything else hangs off

1. **Permissions are data (§2).** `role_permissions` maps (role, permission) →
   scope; `role_permission_team_overrides` adds team-specific exceptions.
   `app.can(permission, team, owner, project, assigned)` reads that mapping and
   compares it to the row in hand. No role name appears in any policy or in any
   application code. Changing what a role can do is an `UPDATE` — and
   `db:prove` demonstrates exactly that, live, against an unchanged token.
2. **The database is the security boundary.** Every table has RLS enabled
   (deny-by-default). The API layer re-checks only to produce readable errors.
   Audit history and status-transition validation are triggers, so no code path
   can skip them.

Two consequences worth remembering before changing anything:

- `src/lib/supabase/server.ts` acts **as the signed-in user**, so RLS applies.
  `admin.ts` (service role) bypasses RLS and is restricted to exactly two
  operations: creating the auth account on first login, and a Super Admin
  password reset. Do not use it for ordinary reads or writes.
- `getMyPermissions()` in `src/lib/auth/session.ts` is for greying out buttons
  and early error messages. It is not a gate.

### Migrations (`supabase/migrations/`)

| File | Contents |
|---|---|
| `0001_foundation.sql` | `app` schema, enums, teams, roles, members, `member_sensitive` (§5 isolation), the permission tables, `role_change_log`. Also created `skills` / `member_skills`, which 0024 drops |
| `0002_access_functions.sql` | `app.current_member_id/current_team_id/is_signed_in`, `effective_scope`, `is_project_manager`, `is_on_project`, **`app.can`**, `app.require` |
| `0003_foundation_rls.sql` | RLS for all of 0001; column gates — role changes need `roles.configure` (audited), team/student-ID/email/status changes need `members.manage`, `auth_user_id` is server-only |
| `0004_seed_access_config.sql` | 8 teams, 7 roles, 23 permissions, the full baseline scope matrix, the HR and Finance team overrides |
| `0005_projects_tasks_posts.sql` | Projects, `project_members`, `project_managers` (max-4 trigger), tasks (project XOR team), `team_posts`, their RLS |
| `0006_request_engine.sql` | `request_hooks`, `request_types`, `request_statuses`, `request_transitions`, `requests`, `request_status_history`, `can_act_on_request`, and the three triggers |
| `0007_calendar.sql` | `calendar_entries` (meeting **scope**), `calendar_entry_audiences` (**visibility**), `calendar_audience_roles`, `audience_matches`, RLS, and `app.hook_create_calendar_entry` registered as a hook |
| `0008_seed_request_types.sql` | Meeting Request with the unbounded counter loop, plus money / design / IT-ticket types |
| `0009_assets_attendance.sql` | Assets + checkouts (partial unique index = one active holder, §8), attendance with the FK-less `event_id` placeholder (§9) |
| `0010_api_functions.sql` | `my_permissions()`, `my_member()`, `transition_request()`, `import_members()` |
| `0011_fix_calendar_policy_recursion.sql` | Fixes a mutual-recursion bug between the calendar policies — see below |
| `0012_kpi_module.sql` | **KPI addendum.** Splits, the task workflow columns, `task_scores` (§8 isolation), `app.can_administer_task` / `can_confirm_task` / `can_view_kpi_for_*`, the five workflow functions, and the five derived views |
| `0013_seed_kpi_access.sql` | The Development team, the `kpi.view` and `tasks.confirm` permissions, their baseline scopes, and Development's team overrides |
| `0014_fix_task_policy_recursion.sql` | Same 42P17 bug as 0011, latent in 0005 between `tasks` and `task_assignees` — see below |
| `0015_task_score_delete_paths.sql` | Scores may be deleted by cascade, never by hand |
| `0016_kpi_task_visibility.sql` | `kpi.view` widens `tasks_select` so the views can reach the rows they aggregate |
| `0017_task_claiming_policy.sql` | The narrow INSERT policy that makes §3 self-service claiming possible |
| `0018_kpi_project_visibility.sql` | Same as 0016, for `projects` and `project_splits` |
| `0019_project_member_kpi_grain.sql` | One falling-behind flag per member per project, not one per split |
| `0020_task_kpi_capabilities.sql` | `can_claim` / `can_confirm` / `can_administer` flags so the UI never re-derives authority |
| `0021_remove_technical_team.sql` | Deletes the Technical team, refusing rather than orphaning if anything still points at it |
| `0022_phone_format.sql` | `app.normalize_phone`, the BEFORE trigger that applies it, and the `+9665XXXXXXXX` CHECK |
| `0023_assets_to_finance.sql` | Asset custody moves from IT to Finance; the register leaves everyone else's reach; the Asset Request type |
| `0024_member_profile.sql` | `members.avatar_path` + the private `avatars` bucket, `member_experience`, and skills dropped |
| `0025_asset_request_flow.sql` | `requestable_assets` (the catalogue, as opposed to the register), `app.hook_checkout_asset`, and the Asset Request's live asset picker |
| `0026_rooms_and_bookings.sql` | **Meetings step 1.** `rooms`, `booking_settings`, `room_bookings`, the `rooms.book` / `rooms.manage` permissions, and the EXCLUDE constraint that makes double-booking impossible |
| `0027_booking_time_zone.sql` | The club's clock becomes a setting; every hour comparison is made in it rather than in the server's timezone |
| `0028_meeting_target_individual.sql` | Adds `individual` to `request_target_kind`, alone in its own file — Postgres will not let a new enum value be used in the transaction that adds it |
| `0029_meetings.sql` | **The Meetings component.** `requests.target_member_id`, `meeting_details`, `app.sync_meeting_hold`, `app.meeting_recipients`, `app.hook_confirm_meeting`, and the guard making a meeting's calendar entry read-only |
| `0030_meeting_request_config.sql` | The Meeting Request's form (online/in-person, room, "booking as"), `my_booking_identities`, `pickable_rooms` |
| `0031_pin_meeting_proposer_party.sql` | The proposer's group is pinned at proposal time — `app.can` asks about whoever is *acting*, which is the wrong person once the other side starts countering |
| `0032_google_connection.sql` | `google_credentials` (RLS on, zero policies), the `integrations.configure` permission, and `meeting_invite_payload` granted to the service role alone |
| `0033_transition_fields.sql` | `request_transitions.field_schema` (what a MOVE asks) and `request_statuses.required_data_keys` (what a request must HAVE to sit somewhere); the meeting counter-offer becomes configuration |
| `0034_workflow_hooks.sql` | `request_types.submit_permission`, `request_transitions.on_transition_hook`, `request_types.on_meeting_confirmed_hook`, and `app.system_transition` for moves a hook makes |
| `0035_design_request.sql` | **The Design Request (§7).** Its statuses, transitions, the `open_meeting` / `resume_after_meeting` hooks, and the private `design-files` bucket |
| `0036_status_clears_data.sql` | `request_statuses.clears_data_keys` — a status can void data that arriving there makes untrue |
| `0038`–`0045` | **Requests that become one real Task.** `request_types.creates_task` and friends; `tasks.source_request_id` / `submission_url`; the `either` actor rule; Design and Media rebuilt on it; and four fixes the suites caught — see below |
| `0046_remove_join_date.sql` | Drops `members.join_date` and regenerates `import_members` without it. Nothing derived from it — no ordering, filter, KPI, policy or view |
| `0047_project_managers_and_role_names.sql` | `import_members` now writes `project_managers` too, plus a backfill for the 19 already imported; `مدير الفريق` → `قائد فريق`, `مدير المشروع` → `مدير مشروع` (`name_ar` only — the keys are what policies use) |
| `0048_member_directory_permission.sql` | `members.directory`: the directory screen gets its own permission so `members.view` can stay `all` and the people-pickers keep working. Presidency by role, HR's Directors by team override |
| `0037_derive_booking_identity.sql` | `app.default_booking_identity()` — the meeting form stops asking which group books the room; Money Request renamed to Fund Request / أمر صرف |

Things in there that are easy to break by accident:

- **RLS policies must not refer to each other in a cycle.** 0007 shipped with
  `calendar_entries_select` selecting from `calendar_entry_audiences` while
  that table's own policy selected back from `calendar_entries`. Postgres
  raised `42P17 infinite recursion detected in policy` on *every* calendar
  read, including the club-event list Guests are supposed to see. 0011 breaks
  the cycle by moving the audience lookup into the SECURITY DEFINER function
  `app.entry_audience_includes_me`, which is not subject to RLS while the outer
  policy is being evaluated. If you add a policy that reads another RLS-guarded
  table, check for the loop. **It happened twice**: 0005 shipped the identical
  cycle between `tasks` and `task_assignees`, which went unnoticed only because
  the tables were empty — the tasks page ignores the query error and renders
  "no tasks". 0014 fixes it the same way, via `app.is_task_assignee`.
- **Task status is not a column.** 0012 dropped `tasks.status`; state, risk
  tier and both scores are derived live by `public.task_kpi`. Writes to the
  workflow columns are rejected by `app.enforce_task_workflow` unless the
  caller is one of `claim_task` / `submit_task_for_review` / `confirm_task` /
  `reject_task` / `mark_task_not_done`, which signal themselves with a
  transaction-local `app.task_workflow` setting. If you need a sixth verb, add
  a function that sets the same flag — do not loosen the trigger.
- **`task_scores` is isolated the way `member_sensitive` is.** §8 forbids
  anyone seeing their own KPI, so the grade lives in its own table whose policy
  refuses the assignee. Moving `quality` back onto `tasks` would silently
  undo that, because assignees can already select their own task row.
- **Every blanket `grant … delete on all tables` line** (0005, 0012, 0024)
  re-grants DELETE on `task_scores`. 0015 revokes it, and 0024 repeats that
  revoke for exactly this reason; repeat it again if you add another blanket
  grant.
- **AFTER-trigger order on `requests` is alphabetical.**
  `requests_history_write` must sort before `requests_hook_on_approval` so the
  history row exists before a hook runs. Renaming either trigger can silently
  reorder them.
- **`app.can` is called with named arguments** in policies
  (`p_team => team_id`). Changing the parameter list breaks every policy.
- **`own_projects` means "projects I manage"**, never "projects I'm on".
  Membership visibility is handled separately by `app.is_on_project` in the
  view policies. Conflating the two hands PMs manage rights on projects they
  merely joined.
- **The engine knows nothing about calendars.** The only link is the row in
  `request_hooks` and the `on_approval_hook` name on the type. Keep it that way.
- **Phone numbers are normalised by a trigger, not by callers.** 0022 rewrites
  anything recognisably Saudi to `+9665XXXXXXXX` BEFORE the CHECK constraint
  runs, which is why the CSV import needed no change to start conforming. The
  member search relies on that single stored form: `phoneSearchTerm` in
  `src/lib/phone.ts` reduces whatever was typed to the digits inside it. If you
  loosen the trigger, the search silently stops finding people.
- **Profile photos are in a PRIVATE bucket.** `members.avatar_path` stores an
  object path, never a URL; pages sign one per render through
  `src/lib/avatars.ts`. Making the bucket public would undo that in one click
  and is the same mistake as moving `national_id` back onto `members`.
- **"Require Meeting" is a hook, and the coupling runs one way only.** The
  Design Request registers `open_meeting` on a transition; that hook inserts an
  ordinary `meeting_request` row and sets `meeting_details.origin_request_id`.
  On confirmation the Meetings component calls
  `app.notify_meeting_confirmed`, which looks up the ORIGIN's type and runs
  whatever that type registered. Nothing in the Meetings component names a
  design request — `db:design` asserts that by grepping the function
  definitions.
- **A new foreign key can silently break a page.** PostgREST resolves an embed
  like `members(...)` by finding THE foreign key between the two tables. Add a
  second one and the embed becomes ambiguous — and PostgREST answers ambiguity
  by failing the whole query with a 300, so the page renders nothing at all
  rather than dropping one field.
  It has happened twice, from the same migration: `requests` gained
  `target_member_id` (a second FK to `members`) and `meeting_details` gained
  `origin_request_id` (a second FK back to `requests`). Both took a request
  page down completely and neither was caught by the suites, which talk to the
  API without embeds. **When you add a FK to a table something already embeds,
  grep for that embed and name the column: `members:submitted_by(...)`,
  `meeting_details!request_id(...)`.**
- **"Becomes a task" is a capability, not a type.** `request_types.creates_task`
  turns it on; `task_due_date_keys` is an ordered list of data keys so one type
  can carry two flavours without a branch in code. Nothing names Design or
  Media. Every other type has the flag off and is untouched.
- **Confirming the task IS approving the request.** There is no second review
  layer — the task's confirm/reject is the review, which is what puts this work
  into the KPI like all other work. `tasks.source_request_id` plus
  `app.notify_task_event` carry the news back, deliberately the same shape as
  `app.notify_meeting_confirmed`.
- **A function that is not SECURITY DEFINER answers for whoever called it.**
  `submit_task_for_review` looked up "does this need a link?" by joining to the
  request type — as the ASSIGNEE, who usually cannot see that request. The
  lookup found nothing, the flag stayed false, and the check failed OPEN. If a
  guard reads a row the actor may not see, it needs a definer helper (0044).
- **`enforce_task_workflow` has two branches for a reason.** A task may be
  CREATED already assigned; it may not be created already submitted. Rewriting
  the function without the INSERT branch broke most task creation and was
  caught by db:kpi's first check (0045).
- **A test that assumes club configuration is a broken test.** `db:rooms` and
  `db:meetings` pin `booking_settings` to noon–midnight for the run and put the
  club's real window back afterwards. They started failing the day somebody set
  closing to 21:00 through the admin screen, which was the suite's fault, not
  the system's. Anything new that depends on a setting a person can change
  should do the same.
- **Risk tier labels describe TIME LEFT, not lateness.** `medium` means three
  to five days remain. It was labelled "Delayed" / "متأخرة", so a task with
  three days left read as overdue to the people using it. Only `overdue` means
  the date has passed; `is_delayed` in the KPI views is the separate,
  genuinely-behind measure.
- **`required_data_keys` asks whether data is PRESENT; `clears_data_keys` is
  what makes it current.** 0036 exists because §7's "new Starting and Delivery
  Date on every revision" was passing without anyone re-committing: the dates
  from the first acceptance were still sitting in `data`. Entering
  `revision_required` now voids them. If you add a "must be re-supplied" rule,
  it takes both columns, not one.
- **A transition can ask questions; a status can insist on answers.** 0033's
  two columns are what removed the last special case from shared code — the
  request screen used to draw two date inputs whenever a type had a field
  called `proposed_start`, which was the meeting counter-offer form living
  inside a component every type runs through. Put new mid-workflow inputs in
  `request_transitions.field_schema`, and new "you cannot be here without X"
  rules in `request_statuses.required_data_keys`. Neither needs code.
- **The database never calls Google.** `app.hook_confirm_meeting` marks the
  row `pending`; `ensureMeetLink` in `src/lib/google/meetings.ts` does the call
  afterwards, from the server action that performed the transition. A trigger
  making a network call would hold its transaction open for the length of that
  call and turn a Google outage into "you cannot confirm your meeting". A
  failure is recorded on the row and retried, never thrown back at the person
  confirming.
- **`src/lib/google/` is the third and last place allowed to use the service
  role**, alongside creating an auth account on first login and a Super Admin
  password reset. It has to be: `google_credentials` denies everyone else, and
  `meeting_invite_payload` returns real email addresses.
- **A meeting IS a request.** There is no second state machine: the
  negotiation is the `meeting_request` type in the engine, counter loop and
  history included. `meeting_details` holds only what is not an answer on a
  form — the room hold, the Meet link, and what spawned it.
- **`app.meeting_recipients` is the ONLY definition of "who is party to this
  meeting".** The Google invite list and the calendar entry's audience are both
  that function. Writing it twice is how the invite and the calendar start
  disagreeing about who the meeting was with.
- **The proposer's group is pinned, and re-checking it is a bug.** `app.can`
  always asks about whoever is *currently acting*. `db:meetings` caught the
  first version re-checking on every write, so a target countering a Design
  meeting was asked whether they could book as Design. 0031 pins the party to
  `meeting_details` at proposal time and only authorises it while the proposer
  themself is acting.
- **A meeting's calendar entry is a projection.** Anything with
  `source_request_id` set refuses edits to its time, title or location — change
  the meeting, not the calendar. Free hand-made entries stay editable.
- **Double-booking is stopped by an EXCLUDE constraint, not by code.**
  `room_bookings_no_overlap` is a GiST index over `(room_id, tstzrange(...))`,
  so the rule holds under concurrency the same way `asset_checkouts_one_active`
  does. Holds, confirmed bookings and IT blocks share one table precisely so
  that one constraint covers all nine combinations of them. Never pre-check
  availability before inserting — let the constraint refuse the loser.
- **One screen is both the booking flow and the schedule.** §6 says clicking a
  free block "starts a direct room booking … not a separate booking
  mechanism", so `/rooms` is §4 and §6 together rather than two grids to keep
  in step. `src/lib/rooms.ts` holds the geometry (`buildSlots`, `buildColumn`)
  and the identity encoding; the page does the database work and the labels,
  and `RoomSchedule.tsx` only draws. Rooms are grid COLUMNS, so adding a room
  adds a column with no code change.
- **`booking_settings` holds the club's clock.** Every hour comparison reads
  `at time zone s.time_zone`. If you add a rule that depends on what hour it
  is, do the same — reading the hour off a `timestamptz` gives you the server's
  timezone, which is UTC.
- **`requestable_assets` bypasses RLS on purpose.** It is the one view in the
  system created `with (security_invoker = off)` — every KPI view is `on` —
  because a member has to be able to pick the camera off a list without being
  able to read who is holding it. What keeps that safe is its COLUMN LIST, not
  a policy. Adding a column widens what every member in the club can see.
- **A request type's select can source its options live.** `options_source` on
  a field (today only `"assets"`) makes `loadFieldOptions` in
  `src/lib/requests.ts` fill the list from a table instead of the JSON. Both
  the new-request form and the request detail page call it — the form to render
  the select, the detail page to turn the stored id back into a name. Adding a
  source means one entry in `OPTION_SOURCES`, not a new component.
- **Assets are Finance's, by override, not by code.** 0023 sets every role's
  baseline for the three `assets.*` permissions to 'none' below the Presidency
  and lifts it again for `team_director` + `FINANCE`. Nothing names Finance
  outside that row — moving custody to another team is three UPDATEs.

### Application code

- `src/proxy.ts` — locale resolution + session refresh + signed-out redirect
- `src/i18n/*`, `messages/{ar,en}.json` — Arabic default, full RTL
- `src/lib/` — `supabase/`, `auth/session.ts`, `actions.ts` (server-action
  result shape), `format.ts` (Arabic dates use Gregorian + Latin digits
  deliberately), `requests.ts`, `calendar.ts` (month-grid geometry), `fonts.ts`
- `src/components/` — `ui.tsx` (logical-property primitives), `ActionForm`,
  `ConfirmForm` (a real `<dialog>`, for deletes), `Disclosure` ("New X +"),
  `ActionsMenu` (the profile's Actions dropdown), `Avatar`, `TaskCard`,
  `NavLinks`, `NavIcons`, `LocaleSwitch`, `RequestFields`, `charts/`
- Pages: login, app shell with permission-filtered nav, dashboard, members
  list + detail, teams list + detail with posts, projects list + detail, tasks,
  requests list / new / detail, **calendar + calendar/new**, **assets**,
  **attendance**, **admin** (index, permission matrix, request types, CSV
  import)

### Verification

- `npm run db:test` — `scripts/permission-tests.mjs`, 32 checks. Seeds five
  people (`permtest-…`), signs each in, and hits the REST API **directly**
  rather than through the UI, then deletes them again. Covers every scenario
  §10 asks for: the non-HR-Director rollback, Guest visibility, the illegal
  status jump, the five-counter meeting request, the all-or-nothing CSV
  import, and two concurrent checkouts of one asset.
- `npm run db:prove` — `scripts/extensibility-proof.mjs`, 12 checks. Adds a
  Sponsorship Request type with nothing but INSERTs and drives a request
  through it end to end, then flips one `role_permissions` row and shows the
  same token's access change and revert. Both without a rebuild or restart.

- `npm run db:meetings` — `scripts/meeting-tests.mjs`, 38 checks. Seeds six
  people — including TWO Directors of one team, so §5's "every Director,
  whichever one negotiated" has something to prove — and drives real meetings
  through the engine: an individual target, the hold appearing on submission
  and moving with a counter, a counter to online releasing the room, approval
  turning the hold into a two-party booking, the calendar audience matching the
  recipients exactly, and confirmation FAILING when somebody else has taken the
  room in the meantime.

- `npm run db:rooms` — `scripts/room-tests.mjs`, 27 checks. Seeds five people
  (`roomtest-`), one per kind §4 distinguishes, plus its own room and project.
  Proves who may book and as whom, the operating-hours and half-hour rules, IT's
  block-and-delete powers, that a plain Member cannot even see the schedule, and
  that rooms can be retired but never deleted. The one that matters most fires
  two bookings of the same slot **concurrently** and checks exactly one survives
  — which is the guarantee §4 actually asks for.

- `npm run db:kpi` — `scripts/kpi-tests.mjs`, 72 checks, same discipline.
  Seeds seven people (`kpitest-…`), a project with two splits and a spread of
  tasks, then proves the addendum against the REST API: that status cannot be
  PATCHed, that a score cannot be inserted outside the workflow, both of §4's
  worked examples (Excellent-but-late = 75, Not Done = 0), every risk
  threshold, that an In Progress task is excluded rather than counted as 0,
  split claiming and confirmation authority, that deleting a task recalculates
  %Performance, and that nobody — Development and Presidency included — can
  read their own figures.

All six scripts are idempotent and only ever touch rows they created.

### Suites written against an empty club

Two have now had to be corrected because they assumed the club had nobody in
it, and more will:

- `db:rooms` hardcoded a noon-to-midnight booking window, and broke the moment
  somebody changed the closing hour through the admin screen. It now pins
  `booking_settings` and restores it.
- `db:meetings` asserted that every attendee on a built invitation carried the
  `meettest-` prefix. Once the real 98 arrived, DESIGN's two elected Directors
  became legitimate recipients — `app.meeting_recipients` includes every
  Director of the target team — and a correct system started failing the check.
  It now compares set-equality against `app.meeting_recipients` itself.

The lesson for the next one: **assert against the rule, not against a naming
convention that only holds while the database is empty.** A suite failing after
real data arrives is more likely stale than a regression — check which before
you 'fix' the system.

---

## What is left

Ordered by what would hurt most to leave undone.

### 0. Nobody has used it

Every guarantee in this document was proved against the database over the REST
API. **No human has clicked through the interface.** The management team has
been sent instructions to test; the most valuable thing they can report is
anything they can see that they should not — that is the one check the suites
cannot run, because it depends on who is holding the account.

### 1. The member data question, still open

Two things have been raised repeatedly and never decided:

- **National IDs.** `member_sensitive` holds one for ~98 real people. Nothing
  in the system uses it — no report, no export, no KPI. Under Saudi PDPL it is
  sensitive personal data, and dropping the column removes the compliance
  question entirely rather than defending it. It is a one-line migration.
- **`members.view` is `all` for everybody.** The directory UI is now
  restricted, but the columns behind it are not (see "Who can see the member
  directory"). If the club wants phone and email genuinely private, that is a
  view or a narrowed scope plus a name-only source for the pickers.

`Database club.xlsx` and `members-import.csv` are gitignored because they carry
national IDs, phones and emails for a hundred people. The repo is private, but
private is a setting and git history is forever — keep them out.

### 2. `task_kpi` is the real performance ceiling

Roughly eight non-inlinable `SECURITY DEFINER` calls PER ROW — `0042` lines
43-45 plus `0016` lines 62-68 — several re-reading the same task. At 300 tasks
that is thousands of nested calls, and it is what makes `/tasks` and `/kpi`
slow. Fixing it means reworking those policies and the capability flags
together, with the suites as the safety net. Do the region move first: it is
free and may buy enough.

### 3. Request type *editing*

`/admin/request-types` is a viewer — it renders each type's statuses,
transitions and field schema, which is what makes "configuration over code"
legible. Creating and editing types through the UI is not built; today that is
SQL, as `db:prove` does it.

### 4. Timezone handling
**Resolved for a single-campus club.** `src/lib/time.ts` holds
`CLUB_TIME_ZONE` and every formatter in `src/lib/format.ts` is pinned to it, so
a time reads the same on a laptop in Riyadh and on a UTC host. Writes send the
zone NAME inside the literal (`2026-08-22 14:00:00 Asia/Riyadh`), which
Postgres resolves itself — no offset arithmetic in JavaScript, and therefore no
daylight-saving bug waiting to happen.

The value exists twice on purpose: in `booking_settings.time_zone` because the
booking trigger cannot read a TypeScript file, and in `CLUB_TIME_ZONE` because
`formatDate` is synchronous and should not need a query. `db:rooms` asserts
they are equal, so drift fails a test rather than quietly showing times three
hours out.

What is still local-clock: the month grid's `dayNumber()` in
`src/lib/calendar.ts` buckets entries using `getTimezoneOffset()`. It is right
on a UTC host and on a Riyadh laptop — which is every deployment that exists —
but it is the one piece not yet expressed in club time.

### 5. KPI follow-ups the addendum defers
Per-split/per-PM breakdown **on a member's own profile** (§9 defers it; the
data model already carries `split_id` on every task, so it needs no schema
change). No rolling or per-semester KPI window — all-time only. No automatic
notification when someone is flagged as falling behind.

One judgement call worth revisiting: §7 grants deletion to "any Director or PM
with authority over that task" with no self-exclusion, while §2 bars them from
scoring their own work. Taken literally — which is how it is implemented —
a Director can delete a task assigned to themselves, and since %Performance is
a plain average, deleting their own zero raises it. `app.can_confirm_task`
already excludes self; switching the delete policy to use it instead of
`app.can_administer_task` closes the gap, at the cost of nobody in the team
being able to delete the Director's own tasks.

---

## The Mock Interviews component (افترض)

The club's mock-interview week is now a **project component**: a club
project carries "Mock Interviews", and everyone the club database lets in gets
a sidebar button named after the project. The event data lives in a **second
Supabase project** so it can never be lost with, or by, this one. The plan and
the decisions taken with the club are in the plan file this was built from; the
short version:

- **Two databases, one login.** Migration `0062` adds `project_components`
  (which project carries which component, and its edition id over there) and
  `project_component_people` (organizers, chosen by whoever manages the
  project; HR people, chosen by whoever holds `members.manage` — HR's
  Directors by the 0004 override). `public.my_component_access()` is the one
  question the app asks: which components may I open, and as **manager**
  (projects.manage over the project), **hr**, or **organizer**. No role name
  appears anywhere; `npm run db:components` proves the rules.
- **The interviews database is server-only.** `supabase/interviews/migrations/`
  (four files, applied with `npm run db:push -- --target interviews`) has RLS
  enabled on every table with no policies and the API roles revoked (0004).
  Only `src/lib/supabase/interviews.ts` — the service role, the fourth and
  last permitted use of it — ever reaches it. Every write is a Postgres
  function that takes an actor and sets it for the transaction, so the audit
  trigger on every table records who did what; public pages resolve a token to
  a student or a company and the function sets the actor itself.
- **Guarantees are constraints.** `bookings_one_per_slot` (partial unique) is
  why a slot is taken once however many tap it; `bookings_no_overlap` and
  `sessions_room_no_overlap` are EXCLUDE constraints; stage moves are checked
  in `advance_stage`. Nothing pre-checks; the loser gets a sentence with a
  machine-readable HINT (`app.refuse`) that the public pages translate.
- **Nothing rewrites a dataset.** The old tool lost data because every edit
  rewrote everything. Here applying inserts one row (or updates one, while
  nothing is decided or booked), checking in updates one row, cancelling sets
  `cancelled_at` and the partial indexes free the slot. `audit_log` is never
  pruned.
- **Email is an outbox.** The database writes `email_outbox` rows (acceptance
  link, booking confirmed/moved/cancelled, reminder, feedback); the server
  renders them in the student's language and sends through Resend
  (`src/lib/interviews/email.ts`, plain HTTP, no SDK). Kicked after each
  action, swept by `/api/interviews/cron` every five minutes
  (`npm run interviews:cron` schedules it with pg_cron in the CLUB project,
  same mechanism as push). Without `RESEND_API_KEY` rows wait and the
  Messages page says so. Feedback is **email only** and held until a manager
  presses *Send feedback emails* (or sent at once, per edition setting).
- **Exports.** `edition_snapshot` renders an edition as one JSON document;
  the sweep writes it to the private `exports` bucket once a night after 03:00
  club time, and Settings has *Take a copy now* and *Download JSON*.
- **CVs** are PDFs (5 MB) in the private `cvs` bucket; `/api/interviews/cv`
  signs a ten-minute URL for HR, managers, or the company that holds the
  booking (past its PIN if one is set).

Pages: signed-in under `/projects/[id]/interviews/…` (overview, applicants,
companies, schedule with the session generator, floor board, bookings, people,
settings, log, messages — tabs filtered by role); public under `/interviews/…`
(`apply/<slug>`, `s/<token>` the student, `c/<token>` the interviewer,
`tv/<token>` the waiting-area screen). The three boards poll every 10–12 s.
`src/proxy.ts` lets `/interviews` through and only `/login` bounces a signed-in
visitor now.

### The shell inside the component

Entering a project's interviews pages does not change layouts; `AppShell`
(client) keeps the same header and sidebar mounted and reads the URL. Inside
`/projects/<id>/interviews` it shows only that component's pages with a
*Back to the club* button on top, cross-fades the club logo into the افترض
mark (`public/brand/interviews-logo.png`, drawn by `InterviewsLogo`; the TV
shows it white through a CSS filter), and sets `data-theme="interviews"` on
`<html>`. That attribute switches the brand colour tokens to the component's
palette (deep teal `#0e5a67`, mint `#a6eddd`, with lime `#c3f04a` and
lavender `#c2b7ef` as `accent` / `accent-2`), paints the page itself mint
(`--color-canvas`, what `body` and the public frame sit on) with lavender
boxes (`--color-surface`) standing on it, and switches the typeface to DG Heaven
(`src/fonts/DG-Heaven-Light.ttf`, one Light cut; bolder weights are
synthesised). The tokens are registered with `@property` in `globals.css`, so
the colour change is animated (700 ms) rather than cut, and the page and
sidebar fade in over the typeface swap; the root layout's inline script sets
the attribute before the first paint on a direct load, and `theme-animate` is
only added afterwards, so nothing fades in from the club's teal. Both
surfaces are light, so the dark ink serves everywhere; a rule on
`.bg-surface` / `.bg-surface-muted` only tints the muted ink violet inside a
box. Pages carry no theme-specific classes. The public `/interviews` pages
carry the brand outright.

### Setting it up

1. Create the interviews Supabase project (**Pro**, region next to Vercel's
   functions), put `INTERVIEWS_SUPABASE_URL`, `INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY`
   and (laptop only) `INTERVIEWS_SUPABASE_DB_URL` in `.env.local`, then
   `npm run db:push -- --target interviews` and `npm run db:interviews`
   (add `INTERVIEWS_SUPABASE_ANON_KEY` for the anon-key checks).
2. `npm run db:push` for `0062`, then `npm run db:components`.
3. Resend: an API key and a verified sender domain; `RESEND_API_KEY` and
   `EMAIL_FROM`. Until the domain is verified Resend delivers only to the
   account owner's address.
4. Vercel: the five variables above; then `npm run interviews:cron`.
5. In the app: open a project, attach *Mock Interviews*, then Settings → set
   the windows and status *Active*; Companies; Schedule → rooms and sessions;
   People → organizers.
6. `npm run interviews:import -- --dry`, then without `--dry`, to bring April
   2026 in as an archived edition from `mockinterviews.xlsx`. The importer
   writes through the REST API with the service role, so it works from a
   network where port 5432 is blocked.

**State on 2026-09-16:** steps 1, 2 and the cron job are DONE. The interviews
project is `qadhnttgtytnibgumrax` (org Vision 2030 Club, still on the Free
plan — upgrade the org to Pro before the event; that covers both projects).
Its four migrations and the club's `0062` were applied through the dashboard's
SQL editor because 5432 was unreachable, with the `schema_migrations` rows
added by hand, so `db:push` reports both databases up to date. A REST smoke
test drove every function on the real project (17 checks). `interviews-sweep`
is scheduled with pg_cron next to `push-sweep`, reusing the Vault secret, and
answers "not configured" until Vercel has the `INTERVIEWS_*` variables. April 2026 is imported as the archived edition `april-2026` (876
applications, 69 sessions, 851 slots, 119 bookings); three sessions that
overlapped another company in the old schedule live in rooms named
"<room> (overlap)" so the room-clash constraint keeps its meaning. The three
`INTERVIEWS_*` variables are in Vercel (Production and Preview) and the
production deployment was rebuilt with them: the cron route answers with a
real report, the archived edition's apply page renders, the TV board API
answers with its token. Two club projects carry the component: the club's own "Mockup
Interviews" (a fresh draft edition, `mockup-interviews-2026`) and "Mock
Interviews — April 2026 (archive)", a completed project attached to the
imported edition so last year can be browsed read-only; detach or delete it
whenever it has served its purpose. The Component card's *Edition* choice is
how a project attaches to an existing, unheld edition rather than starting a
new one; detaching clears the edition's `club_project_id` so another project
can pick it up. Still to do by a person: Resend (API key + verified domain,
then `RESEND_API_KEY` and `EMAIL_FROM` in Vercel and one more redeploy), and
the Pro upgrade of the organization.

### Verified

The four interviews migrations and every function were driven through an
embedded Postgres (PGlite) before touching any project: 66 checks — the
double-booking race, overlap, room clash, stage rules, duplicate-application
rules, dedupe of every email, the archived edition refusing writes.
`scripts/interviews-tests.mjs` repeats them against the real project with two
connections firing at once; `scripts/component-tests.mjs` covers 0062.
`npm run build`, `npm run typecheck` and `npx eslint` are clean.

### Things easy to break

- **A function that raises must raise with a hint.** The public pages map
  `error.hint` to a translated sentence and fall back to the message. Use
  `app.refuse('some_key', 'A sentence.')` and add `errors.some_key` to both
  catalogs.
- **`edition_settings` fills in defaults.** Read settings through it (or
  `app.edition_settings`), never `editions.settings` directly.
- **The roster is club-side.** Adding a way for someone to enter the
  component means a row in `project_component_people` or a rule in
  `my_component_access()`; the interviews database never decides who.
- **The scripts read the workbook through `scripts/lib/xlsx.mjs`** (central
  directory, not local headers — see "Reading .xlsx without a dependency").
  The two older scripts still carry their own copy; they were left alone.

## Conventions to keep

- Phone numbers are stored as `+9665XXXXXXXX` and nothing else. Use
  `PHONE_PATTERN` / `PHONE_PLACEHOLDER` from `src/lib/phone.ts` on any input
  that collects one, so the form rejects what the database would.
- A form that is used occasionally goes behind `<Disclosure>` ("New X +")
  rather than sitting open on the page; its children are still rendered on the
  server, so the panel costs no request to open.
- Tailwind **logical** utilities only — `ps-`/`pe-`/`ms-`/`me-`/`text-start`.
  `pl-`/`text-left` will break the Arabic layout.
- Every user-facing string goes through `next-intl`; add to both catalogs.
- Server actions return the `ActionResult` shape from `src/lib/actions.ts` and
  surface the database's own error message — those messages name the rule that
  refused the write, which is the whole point of enforcing in Postgres.
- New tables: enable RLS, write policies in terms of `app.can`, and add the
  `grant … to authenticated` line at the end of the migration.
- Never add a role name to a policy or to application code.
- Don't pre-check what the database already enforces. The asset checkout path
  is the model: it lets the partial unique index fail the second writer rather
  than looking first, because a pre-check only widens the race.

## Out of scope

Per the spec: Events module with QR check-in, Finance ledger, club-wide
announcements, Documents, MediaPlans, HR/WhatsApp integration, certificates,
email notifications, reporting dashboards, dark mode, file attachments on
requests, self-service password reset, public registration. The marketing site
at vision2030club.com is not touched or merged.
