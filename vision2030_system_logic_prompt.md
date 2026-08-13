# VISION 2030 CLUB SYSTEM — SYSTEM LOGIC SPECIFICATION (v2)
(Stack-agnostic. Build this with whatever language, framework, and
database you choose — the rules below must hold regardless.)

You are building a club management system for a student club with
~180 members organized into teams (Design, Media, Content, Technical,
Finance, PR, HR, IT, Club Management, etc.), each led by one or more
Team Directors, running Projects staffed across teams (a project can
have up to 4 Project Managers), and reviewing work through Requests.

I am a beginner programmer and some of my teammates are too. Favor
simple, readable logic over clever abstractions, and briefly explain
key decisions as you make them.

---

## 1. CORE ENTITIES

- **User** — one person, one account, one login identified by **email**
  (unique). Has: English name, Arabic name, phone, university/student
  ID, national ID (sensitive — see §5), college, academic level,
  graduation term (free text, e.g. "Second Semester 1448H" —
  maintained manually, no automatic status changes from it), skills
  (from a fixed list), a membership status, and a join date.
- **Team** — a department (Design, Finance, HR, IT, Club Management,
  etc.). A User belongs to **exactly one Team** at a time.
- **Role** — what a person is allowed to do club-wide. **Strictly one
  Role per person, no exceptions** — do not design any "multiple
  roles at once" mechanism. Roles: Super Admin, President, Vice
  President, Team Director, Project Manager, Member, Guest.
  - "Team Director" is a **single role**, not one role per team — the
    UI displays it as "Director of {their team}" by combining the
    role with the person's team; this needs no schema change.
  - More than one person can hold Team Director for the same team at
    once — don't design around a single "director" per team.
  - In practice this club's Super Admin is usually also IT's
    Director, but that's an operating choice, not a system rule —
    do not build any constraint tying Super Admin to a specific team.
- **Project** — cross-team work owned by one Team but staffed by
  members from any team (many-to-many membership, independent of
  their home Team). Can have **up to 4 Project Managers**.
- **Task** — belongs to a Project (or stands alone at team level) and
  can have **multiple assigned owners**, not just one.
- **Request** — see §3, the generic engine.
- **Asset** — club equipment with a checkout/checkin history; at most
  one active checkout at a time.
- **Calendar Entry** — see §6.
- **Team Post** — a short announcement visible only within one team.
- **Attendance Record** — one row per person per activity/event.

---

## 2. ROLE-BASED ACCESS CONTROL — MUST BE DATA, NOT CODE

Do not write `if role === "Team Director"` scattered through the
codebase. Instead:

- Define a table of **permissions** (e.g. `requests.approve`,
  `members.manage`, `calendar.manage`).
- Define a table mapping **(role, permission) → scope**, where scope
  is one of: `all`, `own_team`, `own_projects`, `assigned`, `own`,
  `none`.
- Every access check reads this mapping. Changing what a role can do
  is a **data update**, never a code change or redeploy.
- Enforce permissions in **two layers**: at the database level (so a
  bug in the application code, or someone calling the API directly,
  still can't bypass the rule) and again at the API/application layer
  (so users get a clear, readable error instead of a silent failure).
  A hidden UI button is not security — test every restricted action by
  calling the API directly as a lower-privileged user and confirm it
  is rejected, not just hidden.

**Baseline scopes:**
- Super Admin: everything, including role/permission configuration.
- President / VP: everything except role/permission configuration.
- Team Director: full manage rights on their own team's *operational*
  data (tasks, requests routed to their team, meetings — see §6); but
  see the member-management restriction below — most Directors do
  **not** get member-editing rights, only HR's Directors do.
- Project Manager: full manage rights on projects they run (any one
  of a project's up to 4 PMs may act for it — see §6 and §3); read
  access elsewhere.
- Member: manage only what's assigned to them or submitted by them;
  read access to their own team/projects; no approval rights.
- Guest: read-only, and only on things explicitly marked public.

**Member management is restricted, not a general Director power.**
Only these may edit a member's profile fields *and* move them between
teams: Super Admin, President, VP, and Directors whose own team is
HR. Team Directors of every other team have **no** member-editing or
team-assignment rights — this is a deliberate rollback from an
earlier design; do not grant Directors `own_team` scope on member
records.

**Critical: role changes must be gated.** Nobody should be able to
escalate their own or anyone else's role except a Super Admin action.
Since one role per person is a strict rule, changing someone's role
is also implicitly removing their old one — treat this as a single
sensitive operation, not two.

---

## 3. THE GENERIC REQUEST ENGINE (core reusable piece)

Most approval workflows in this club — money requests, design
requests, IT tickets, sponsorship asks, **and meeting requests
between teams/projects** — are the same shape: someone submits
something, it goes through review, and it ends in an outcome. Build
**one** engine for all of them instead of one table/screen per kind.

- A **Request Type** is pure configuration: a name, an owning team, a
  schema describing its custom form fields, and its allowed status
  flow (which statuses exist and what transitions are legal from each
  one — this must support **loops**, not just a linear
  submit→review→done path; see the Meeting Request flow below).
  Adding a new kind of request should require **inserting one
  configuration record — zero new code.** Prove this to yourself by
  adding a new type after the first several work, with no code
  changes.
- A **Request** is an instance: who submitted it, which team/entity
  it's routed to, its current status, and its answers to the type's
  custom fields.
- Every request keeps a **full status history** (who changed it, from
  what, to what, when) — impossible to skip; write it at the lowest
  layer you control (a database trigger is ideal).
- Status transitions must be **validated against the type's allowed
  flow** — reject any transition not explicitly allowed, with a clear
  error, not a silent no-op.
- Support an **on-approval hook**: a named action that fires when a
  request of a given type reaches its approved status, looked up in a
  small dispatcher (name → function). This is how a Meeting Request,
  once fully approved, creates the actual Calendar Entry (§6) — the
  core request engine should know nothing about calendars.

### Meeting Requests — a Request Type with a negotiation loop

Team Directors and Project Managers may add meetings **directly, no
approval needed** — but only when the meeting is entirely within
their own authority (see §6, "meeting scope" vs. "calendar
visibility" — these are different concepts, read carefully). Anything
that reaches outside that — a Director wanting a meeting with another
team, a Project Manager wanting a meeting with another project, or a
Director/PM wanting a meeting with Presidency — must go through a
**Meeting Request**:

- The requester proposes a title, description, date/time, and which
  team/project/Presidency they want to meet with.
- **Approval rule by target:**
  - Target is a specific **Team** → any **one** of that team's
    Directors approving is sufficient.
  - Target is a specific **Project** → any **one** of that project's
    (up to 4) Project Managers approving is sufficient.
  - Target is **Presidency** → either the President or the VP
    approving is sufficient.
- The approving side has **three options**, not two: **Approve**,
  **Reject**, or **suggest a different time** ("Counter"). A Counter
  sends the request back to the original requester with the new
  proposed time; the requester may then Accept it (finalizing —
  same effect as Approve) or Counter again with yet another time.
  **This can loop back and forth an unlimited number of times** —
  don't cap it or force resolution after N rounds.
- **Nothing appears on the calendar while a request is Pending,
  Under Review, or being Countered.** A Calendar Entry is created
  only at the moment a Meeting Request reaches a final **Approved**
  state — via the on-approval hook described above.
- This is a genuine test of whether your status-flow engine is truly
  data-driven: the back-and-forth Counter loop must be expressible as
  configuration (allowed transitions), not as special-cased code
  bolted onto the generic engine.

---

## 4. MEMBERSHIP — CSV IMPORT ONLY, NO SELF-SIGNUP

There is **no public registration form** and **no membership-review
workflow** in this system. All members are added by **Super Admin
only**, via bulk CSV upload. The club's existing external website
still has an application form, run separately — its exported
responses become the CSV brought into this system.

### Import behavior

- **Only Super Admin** may perform a CSV import.
- Every imported row becomes a member with status **Active
  immediately** — there is no review/approval step for membership.
- **Validation is all-or-nothing.** Before committing anything, the
  entire file is checked: ID formats (§5), and that every team name
  and role name in the file matches something that already exists in
  the system. If **any** row fails **any** check, the import commits
  **nothing** and returns a report listing every problem found (which
  row, which field, why). There is no partial import.
- The file is expected to already use this system's own role and team
  names — mapping/cleaning happens before upload, not automatically
  during it.
- **Match key for updates: student ID.** If a row's student ID
  already exists in the system, that member's data is **updated**
  (values replaced) rather than a duplicate being created. A new
  student ID creates a new member.
- If the file includes project name(s) for a person, add them to that
  project's membership as part of the same import.
- The file does not carry skills — skill assignment, if you keep that
  feature, remains a separate action available only to whoever can
  edit member records (Super Admin, President, VP, HR Directors).
- Imported rows create **profile data only** — no login/auth account
  is created at import time. The login account is established the
  first time that person actually signs in (see below).

---

## 5. LOGIN & SENSITIVE DATA

### Login model

- Identity = **email**, unique per person.
- A profile created by CSV import has **no password** yet.
- **First login:** the person enters their email. If a profile with
  that email exists and has no password set, they are prompted to
  **set one** (this only happens once). From then on it's ordinary
  email + password.
- If the email doesn't match any profile at all, show "No account
  found" — do not create one on the fly.
- **There is no self-service "forgot password" flow.** The only way
  to reset a password is a Super Admin action.

### ID fields — numeric, with strict format validation

- `student_id`: numeric, **exactly 9 digits, must start with 4**.
- `national_id`: numeric, **exactly 10 digits, must start with 1 or
  2**.
- Reject anything that doesn't match at import or edit time, with a
  clear error stating which rule failed — don't silently truncate or
  reformat.

### Sensitive data isolation

- National ID must be stored **apart** from the general member
  profile/directory, readable only by the member themselves, HR
  Directors, and admins (Super Admin/President/VP). "Everyone can see
  the member directory" must not imply "everyone can see national
  IDs."

---

## 6. CALENDAR

Two different concepts must not be conflated — keep them as separate
fields/logic:

1. **Meeting scope** — who the meeting is being convened *with*.
   This determines whether the action needs approval (§3) or can be
   added directly.
2. **Calendar visibility (audience)** — who can *see* the entry on
   the calendar afterward. This is chosen freely by the creator and
   never requires anyone else's approval — widening visibility is not
   the same as scheduling time with someone.

### Entry kinds

- **Club entries** — club-wide events (Career Fair, deadlines). Only
  President, VP, and Super Admin may create, edit, or delete these.
  Always visible to **every signed-in role**, Guest included. No
  anonymous/public access ever.
- **Meetings** — everything covered in §3. Direct-add is allowed only
  when the meeting scope is entirely the creator's own: a Director
  meeting with their own team, a Project Manager meeting with their
  own project, or Presidency meeting with Club Management. Anything
  crossing outside that requires a Meeting Request.

### Calendar visibility — seven audience options

When setting **who can see** a meeting (independent of its scope),
the creator may choose any combination of:

1. **Presidency** — President + VP
2. **Directors** — Presidency + all Team Directors
3. **Club Management** — Presidency + Team Directors + Project
   Managers
4. **Team** — one specific team, chosen from a list
5. **Project** — one specific project, chosen from a list
6. **All Members** — everyone signed in
7. **Individual person(s)** — one or more specific people, chosen by
   name

These are not mutually exclusive — a creator can combine several
(e.g. "the IT team" + "one specific person outside it").

### General entry requirements (unchanged from earlier design)

- Title, description, start date/time, end date/time, an all-day
  flag, location, and free-text category + color (not a fixed list).
- A multi-day entry (e.g. "Career Fair, Jan 1–5") renders as **one
  continuous element spanning those days**, not repeated daily.
- Enforce write permissions at the database layer, not just hidden
  UI — calling the write endpoint directly as an unauthorized role
  must fail with a real permission error.
- Month-grid view as the primary UI, plus upcoming-entries cards on
  the main dashboard.

---

## 7. TEAM MANAGEMENT RULES

- One member = one team, always. There is no multi-team membership at
  the org level (project membership is separate and unrestricted).
- Team-scoped announcements ("Team Posts") are visible only to that
  team's own members (plus leadership); posting to a team is limited
  to that team's own Director(s) (plus leadership/HR as applicable).
- Reminder: moving members between teams and editing member records
  is **not** a general Director power — see §2's restriction (only
  HR Directors + Presidency + Super Admin).

---

## 8. ASSETS

- Each asset has a checkout history; **at most one active checkout at
  a time**, enforced at the data layer (not just in application
  logic) so a race condition between two simultaneous checkouts can't
  create two active holders.
- Checking an asset back in should automatically flip its status back
  to available.

---

## 9. ATTENDANCE

- One record per person per activity: activity name, date/time,
  status (present/absent/excused/late), optional note, who recorded
  it.
- Leave a placeholder link to a future "Event" concept (nullable
  reference, no hard constraint yet) so an Events module can attach
  to existing attendance data later without a migration.
- Visibility default: HR and leadership only. State clearly in your
  design where this restriction lives so it's a one-line change later
  if that policy is relaxed.

---

## 10. GENERAL PRINCIPLES TO FOLLOW THROUGHOUT

- **Config over code.** Anything that will plausibly change after
  launch (request types, permissions, skills list, categories) should
  be a data row, not a hardcoded value or an `if` branch.
- **Enforce at the lowest layer you control**, and repeat the check at
  the API layer for a clean error message. Never rely on the UI
  hiding a button as the actual security boundary.
- **Audit trails should be structurally impossible to skip** — don't
  put "remember to log this" in application code where a future code
  path could forget; put it where every write must pass through it.
- **Prove extensibility as you go.** After building the first few
  instances of any generic pattern (request types, calendar entry
  kinds, etc.), add one more purely through configuration and confirm
  no code changed.
- Before writing any code for a new phase of this system, show me the
  schema/data model changes and the permission rules for that phase,
  and get my confirmation before implementing.
- At the end of each phase, summarize: the schema as built, key
  decisions and why, open questions for me, and what remains out of
  scope — so the next phase can be briefed with full context.

---

## OUT OF SCOPE (do not build unless a phase explicitly calls for it)

Events module with QR check-in, Finance ledger, club-wide (not
team-scoped) Announcements, Documents, MediaPlans, HR/WhatsApp
integration, certificates, push/email notifications, dashboards and
reporting, dark mode, multi-language UI, file attachments on
requests, self-service password reset, public membership
registration.

---
Check the assets folder for both logos and fonts
## APPENDIX — Reference only, NOT part of this system

The club has a **separate, existing public marketing website**
vision2030club.com
(built by an outside company) with its own membership-application
form. That site is **not being rebuilt or merged into this project**
— it continues to operate independently, and its application
responses are exported to CSV and brought into this system via the
import in §4.

For **visual/branding style and stack reference only** (do not fold
this into the stack-agnostic internal system above, and do not build
its `/join` page — it's superseded by §4):

- Bilingual (Arabic/English) with Arabic as default, full RTL
  support.
- Clean marketing-site structure: home (hero, stats counters,
  announcements, featured projects), about, projects, accomplishments,
  contact, FAQ, privacy/terms.
- Stack it was built with: Next.js (App Router, TypeScript), Tailwind
  CSS, next-intl for locale routing, Payload CMS on Postgres as the
  backend, Cloudflare (Turnstile, CSP headers, analytics) in front,
  deployed on Vercel with managed Postgres and object storage for
  media.
- Arabic-coverage font (e.g. IBM Plex Sans Arabic, Noto Kufi Arabic),
  content fetched server-side with ISR, CSP delivered as a real
  response header rather than a meta tag.

This is background context if visual consistency between the two
sites ever matters — it does not change any requirement above.
