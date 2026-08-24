# Handoff — Vision 2030 Club System

Build is green (`npm run build`, 43 routes) and `npx eslint` is clean.
**All 45 migrations are applied** to a live Supabase project. Everything is
verified end to end against the real database over the REST API rather than
through the UI: `db:test` 32/32 · `db:rooms` 27/27 · `db:meetings` 38/38 ·
`db:design` 48/48 · `db:kpi` 72/72 · `db:prove` 12/12.

The Meetings / Rooms / Design Request build is underway — **steps 1–5 of 6 are
done**: rooms and the booking window with the double-booking guarantee, the
shared room schedule (§4's booking flow and §6's all-rooms view on one screen),
the Meetings component (individual targets, the room hold across the
negotiation, §5's recipients, the confirm hook), the Google connection, and per-transition fields.

**The Google half is built but not switched on** — see "Connecting Google"
below. Nothing else waits on it: in-person meetings work today, and an online
meeting is confirmed and on the club's own calendar whether or not Google is
reachable. Next is step 6, the Design Request itself.

The spec being implemented is `vision2030_system_logic_prompt.md`. Section
references below (§2, §3, …) point into it.

---

## Connecting Google

Everything is written; it needs a Google application and one authorisation.
Until then, confirmed online meetings sit at `meet_state = 'pending'` and the
admin page says so. **This is not a blocker** — the meeting is agreed, booked
and on the club's own calendar regardless.

A Super Admin does this once:

1. Google Cloud console → new project → enable the **Google Calendar API**.
2. Create an OAuth client, type **Web application**.
3. Add the redirect URL shown on `/admin/google` to its Authorised redirect
   URIs. It must match character for character.
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

- All 27 migrations applied to the live Supabase project.
- `db:test` 32/32 · `db:rooms` 27/27 · `db:meetings` 38/38 · `db:design` 48/48 ·
  `db:kpi` 72/72 · `db:prove` 12/12.
- One member exists: the Super Admin bootstrap account, password already set.
- Public sign-ups should be **off** in the dashboard (Authentication → Sign In /
  Providers). §4 forbids self-registration; the app never calls `signUp`, but
  the setting closes the door properly. Verify this is still off.

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

- `npm run db:test` — `scripts/permission-tests.mjs`, 28 checks. Seeds five
  people (`permtest-…`), signs each in, and hits the REST API **directly**
  rather than through the UI, then deletes them again. Covers every scenario
  §10 asks for: the non-HR-Director rollback, Guest visibility, the illegal
  status jump, the five-counter meeting request, the all-or-nothing CSV
  import, and two concurrent checkouts of one asset.
- `npm run db:prove` — `scripts/extensibility-proof.mjs`, 10 checks. Adds a
  Sponsorship Request type with nothing but INSERTs and drives a request
  through it end to end, then flips one `role_permissions` row and shows the
  same token's access change and revert. Both without a rebuild or restart.

- `npm run db:meetings` — `scripts/meeting-tests.mjs`, 28 checks. Seeds six
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

All three scripts are idempotent and only ever touch rows they created.

---

## What is left

### 1. Request type *editing*
`/admin/request-types` is a viewer — it renders each type's statuses,
transitions and field schema, which is what makes "configuration over code"
legible. Creating and editing types through the UI is not built; today that is
SQL, as `db:prove` does it.

### 2. Timezone handling
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

### 3. KPI follow-ups the addendum defers
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
push/email notifications, reporting dashboards, dark mode, file attachments on
requests, self-service password reset, public registration. The marketing site
at vision2030club.com is not touched or merged.
