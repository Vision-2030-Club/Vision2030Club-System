# Handoff — Vision 2030 Club System

Status as of 2026-08-13 (tag `KSUVC-1.0V`). Build is green (`npm run build`,
27 routes). **All 11 migrations are applied to a live Supabase project.** The
access model is verified end to end: `npm run db:test` passes 28/28 and
`npm run db:prove` passes 10/10, both against the real database over the REST
API rather than through the UI.

The spec being implemented is `vision2030_system_logic_prompt.md`. Section
references below (§2, §3, …) point into it.

---

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

- All 11 migrations applied to the live Supabase project.
- `npm run db:test` → 28/28. `npm run db:prove` → 10/10.
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
| `0001_foundation.sql` | `app` schema, enums, teams, roles, members, `member_sensitive` (§5 isolation), skills, the permission tables, `role_change_log` |
| `0002_access_functions.sql` | `app.current_member_id/current_team_id/is_signed_in`, `effective_scope`, `is_project_manager`, `is_on_project`, **`app.can`**, `app.require` |
| `0003_foundation_rls.sql` | RLS for all of 0001; column gates — role changes need `roles.configure` (audited), team/student-ID/email/status changes need `members.manage`, `auth_user_id` is server-only |
| `0004_seed_access_config.sql` | 9 teams, 7 roles, 23 permissions, the full baseline scope matrix, HR + IT team overrides, skills list |
| `0005_projects_tasks_posts.sql` | Projects, `project_members`, `project_managers` (max-4 trigger), tasks (project XOR team), `team_posts`, their RLS |
| `0006_request_engine.sql` | `request_hooks`, `request_types`, `request_statuses`, `request_transitions`, `requests`, `request_status_history`, `can_act_on_request`, and the three triggers |
| `0007_calendar.sql` | `calendar_entries` (meeting **scope**), `calendar_entry_audiences` (**visibility**), `calendar_audience_roles`, `audience_matches`, RLS, and `app.hook_create_calendar_entry` registered as a hook |
| `0008_seed_request_types.sql` | Meeting Request with the unbounded counter loop, plus money / design / IT-ticket types |
| `0009_assets_attendance.sql` | Assets + checkouts (partial unique index = one active holder, §8), attendance with the FK-less `event_id` placeholder (§9) |
| `0010_api_functions.sql` | `my_permissions()`, `my_member()`, `transition_request()`, `import_members()` |
| `0011_fix_calendar_policy_recursion.sql` | Fixes a mutual-recursion bug between the calendar policies — see below |

Things in there that are easy to break by accident:

- **RLS policies must not refer to each other in a cycle.** 0007 shipped with
  `calendar_entries_select` selecting from `calendar_entry_audiences` while
  that table's own policy selected back from `calendar_entries`. Postgres
  raised `42P17 infinite recursion detected in policy` on *every* calendar
  read, including the club-event list Guests are supposed to see. 0011 breaks
  the cycle by moving the audience lookup into the SECURITY DEFINER function
  `app.entry_audience_includes_me`, which is not subject to RLS while the outer
  policy is being evaluated. If you add a policy that reads another RLS-guarded
  table, check for the loop.
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

### Application code

- `src/proxy.ts` — locale resolution + session refresh + signed-out redirect
- `src/i18n/*`, `messages/{ar,en}.json` — Arabic default, full RTL
- `src/lib/` — `supabase/`, `auth/session.ts`, `actions.ts` (server-action
  result shape), `format.ts` (Arabic dates use Gregorian + Latin digits
  deliberately), `requests.ts`, `calendar.ts` (month-grid geometry), `fonts.ts`
- `src/components/` — `ui.tsx` (logical-property primitives), `ActionForm`,
  `NavLinks`, `LocaleSwitch`, `RequestFields`
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

Both scripts are idempotent and only ever touch rows they created.

---

## What is left

### 1. Calendar entry detail / editing
The month grid and the create form exist. There is no detail view and no edit
or delete UI, though `deleteCalendarEntryAction` is written and the policies
allow both for the creator and for `calendar.manage` holders.

### 2. Request type *editing*
`/admin/request-types` is a viewer — it renders each type's statuses,
transitions and field schema, which is what makes "configuration over code"
legible. Creating and editing types through the UI is not built; today that is
SQL, as `db:prove` does it.

### 3. Timezone handling
Dates are formatted with the **server's** timezone. Fine for a single-campus
club, wrong the moment anyone travels. The calendar grid's `dayNumber()` in
`src/lib/calendar.ts` is where that assumption lives.

### 4. A pre-existing lint warning
`src/app/[locale]/(app)/members/[id]/page.tsx` imports `Textarea` and never
uses it. Harmless, one line.

---

## Conventions to keep

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
