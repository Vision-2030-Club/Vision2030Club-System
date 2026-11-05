# Handoff — Vision 2030 Club System

Start here. This file is the current state, how to get running, and what is
still open. How each part works lives in `docs/`, one file per area.

## Where things are

| Read | When you are working on |
|---|---|
| [`docs/club.md`](docs/club.md) | The club side: stack, the permission model, every migration, the directory, the semester, hours and Outreach, short links, performance, UI rules, brand assets |
| [`docs/interviews.md`](docs/interviews.md) | The Mock Interviews component (افترض): its second database, rooms, the floor, reception, walk-ins, the sheets, feedback. Ends with **"Things easy to break"** |
| [`docs/integrations.md`](docs/integrations.md) | Google (Calendar and Sheets) and push notifications |
| [`docs/data-and-testing.md`](docs/data-and-testing.md) | Importing the member list and the timeline, the testing rounds with the club, how the real club was loaded |
| [`docs/spec.md`](docs/spec.md) | The system specification being implemented. Section references in these documents (§2, §3, …) point into it |
| [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md), [`.claude/rules/`](.claude/rules/) | How the team works, and the rules for coding assistants |

Repository layout:

```
src/                  the Next.js app (app/, components/, lib/, i18n/, fonts/)
messages/             en.json and ar.json — every user-facing string, both languages
supabase/migrations/  the club database, applied in order by npm run db:push
supabase/interviews/  the Mock Interviews database (npm run db:push:interviews)
scripts/tests/        database suites (npm run db:test, db:kpi, db:rooms, …)
scripts/data/         imports and the KPI simulation; they read gitignored files
scripts/ops/          migrations, cron setup, and the destructive test reset
public/               served as-is to anyone: logos, icons, the service worker
design/               brand originals (full font families, logo masters, video); not served
docs/                 how each part works
```

## Current state

- **72 club migrations** (`supabase/migrations/`, up to `0072`) and **21
  Mock Interviews migrations** (`supabase/interviews/migrations/`, up to
  `0021`) are in the repository. Whether each is applied is recorded in the
  `schema_migrations` table of its database; `npm run db:push` and
  `npm run db:push:interviews` apply what is missing.
- The real club is in the database (98 active members when it was loaded on
  2026-09-16). The management team has tested it in rounds since; what each
  round changed is in `docs/data-and-testing.md`.
- Built on the club side: members and teams, the request engine (Meetings,
  Rooms, Design and Media requests, requests that become a task), tasks and
  the KPI module, the semester, hours and Outreach, short links. Project
  components: Mock Interviews.
- Google (Calendar, Sheets) is optional: without it, in-person and online
  meetings still work. Whether it is connected, and how, is in
  `docs/integrations.md`.
- Deployed on Vercel from `main` at `vision2030club-system.vercel.app`; every
  pull request gets a preview URL.
- The database suites were written when the club was empty and seed their own
  rows; read "Suites written against an empty club" in `docs/club.md` before
  trusting a failure.
- Public sign-ups should be **off** in the Supabase dashboard (Authentication →
  Sign In / Providers). §4 forbids self-registration; the app never calls
  `signUp`, but the setting closes the door properly. Verify it is still off.

---

## Picking this up again

Nothing is blocked. To get running from a fresh clone:

1. Get the environment values. An admin adds you to the Vercel project, then
   `npx vercel env pull .env.local`. `.env.example` lists every variable name
   with an empty value. Never paste a value into chat or a commit.
   - `SUPABASE_SERVICE_ROLE_KEY` is the `sb_secret_…` value from Project
     Settings → API. It is **not** the database password; putting the password
     there fails in a confusing way (see "Known trap" below).
   - `SUPABASE_DB_URL` is only needed for `db:push` and the suites, and is not
     kept in Vercel. It is the Connect → **Session pooler** URI with your
     password substituted for `[YOUR-PASSWORD]`.
2. `npm install && npm run db:push` — applies anything not yet in
   `schema_migrations`. Against the current project this is a no-op.
3. `npm run dev`, then sign in at `/ar/login`.

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
pressed. See "Push notifications" in `docs/integrations.md` for where they come from.

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

## What is left

Ordered by what would hurt most to leave undone.

### 0. The one check the suites cannot run

The suites prove the rules against the database over the REST API; they
cannot tell whether a screen shows someone more than their account should
see, because that depends on who is holding the account. When the club tests
a release, the most valuable report is anything a person can see that they
should not.

### 1. The member data question, still open

Two things have been raised repeatedly and never decided:

- **National IDs.** `member_sensitive` holds one for ~98 real people. Nothing
  in the system uses it — no report, no export, no KPI. Under Saudi PDPL it is
  sensitive personal data, and dropping the column removes the compliance
  question entirely rather than defending it. It is a one-line migration.
- **`members.view` is `all` for everybody.** The directory UI is now
  restricted, but the columns behind it are not (see "Who can see the member
  directory" in `docs/club.md`). If the club wants phone and email genuinely private, that is a
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
change). No rolling or per-semester KPI window — all-time only, though the semester
itself is now a setting (`0067`, "The semester as a unit" in `docs/club.md`) that a
windowed view can read. No automatic notification when someone is flagged
as falling behind.

One judgement call worth revisiting: §7 grants deletion to "any Director or PM
with authority over that task" with no self-exclusion, while §2 bars them from
scoring their own work. Taken literally — which is how it is implemented —
a Director can delete a task assigned to themselves, and since %Performance is
a plain average, deleting their own zero raises it. `app.can_confirm_task`
already excludes self; switching the delete policy to use it instead of
`app.can_administer_task` closes the gap, at the cost of nobody in the team
being able to delete the Director's own tasks.

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
