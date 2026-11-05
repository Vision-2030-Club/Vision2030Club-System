# The Mock Interviews component (افترض)

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

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
  same mechanism as push; since 2026-10-05 it also schedules the
  every-minute Google Sheets pull, `/api/interviews/sheets`). Without `RESEND_API_KEY` rows wait and the
  Messages page says so. **On hold since 2026-10-13:** the club may not use
  email at all, so the apply form and the student page now say "we will
  contact you" instead of promising an email with a link
  (`apply.whatNext`, `apply.emailHint`, `student.nothingYet`). Accepted
  students reach their booking page through an assignment's candidate link
  and HR's accepted phone list. If Resend is switched on later, every row
  queued since 11 Oct goes out at once: look at the Messages tab first. Feedback is **email only** and held until a manager
  presses *Send feedback emails* (or sent at once, per edition setting).
- **Exports.** `edition_snapshot` renders an edition as one JSON document;
  the sweep writes it to the private `exports` bucket once a night after 03:00
  club time, and Settings has *Take a copy now* and *Download JSON*.
- **CVs** are PDFs (4 MB, `src/lib/interviews/cvLimits.ts`) in the private
  `cvs` bucket; `/api/interviews/cv` signs a ten-minute URL for HR, managers,
  or the company that holds the booking (past its PIN if one is set). The
  limit is 4 MB, not the bucket's 5, because Vercel refuses a request body
  over about 4.45 MB with a 413 before the app runs (measured on production
  2026-10-11); see "The apply form keeps what was typed" below.

Pages: signed-in under `/projects/[id]/interviews/…` (overview, applicants, register,
companies, schedule with the session generator, floor board, bookings, people,
settings, log, messages — tabs filtered by role); public under `/interviews/…`
(`apply/<slug>`, `s/<token>` the student, `c/<token>` the interviewer,
`tv/<token>` the waiting-area screen). The three boards poll every 10–12 s.
`src/proxy.ts` lets `/interviews` through and only `/login` bounces a signed-in
visitor now.

## The shell inside the component

Entering a project's interviews pages does not change layouts; `AppShell`
(client) keeps the same header and sidebar mounted and reads the URL. Inside
`/projects/<id>/interviews` it shows only that component's pages with a
*Back to the club* button on top, cross-fades the club logo into the افترض
mark (`public/brand/interviews-logo.png`, drawn by `InterviewsLogo`; the TV
shows it white through a CSS filter), and sets `data-theme="interviews"` on
`<html>`. That attribute switches the brand colour tokens to the component's
palette (deep teal `#0e5a67`, mint `#a6eddd`, with lime `#c3f04a` and
mint as `accent` / `accent-2`), paints the page itself a near-white mint
(`--color-canvas` `#f2fbf8`, what `body` and the public frame sit on) with
mint boxes (`--color-surface` `#a6eddd`) standing on it (lavender was
dropped on 2026-10-07; every text colour stays above 5.7:1 contrast), and switches the typeface to TheSansArabic
(`src/fonts/TheSansArabic-Light.ttf` and `-Bold.ttf`, LucasFonts; both cover
Arabic, Latin and both sets of digits; Light serves weights 300–500 and Bold
600–800, so nothing is synthesised; it replaced DG Heaven on 2026-10-11). The tokens are registered with `@property` in `globals.css`, so
the colour change is animated (700 ms) rather than cut, and the page and
sidebar fade in over the typeface swap; the root layout's inline script sets
the attribute before the first paint on a direct load, and `theme-animate` is
only added afterwards, so nothing fades in from the club's teal. Both
surfaces are light, so the dark ink serves everywhere; a rule on
`.bg-surface` / `.bg-surface-muted` only deepens the muted ink inside a
box. Pages carry no theme-specific classes. The public `/interviews` pages
carry the brand outright.

## Setting it up

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

## The room flow and the floor sheet (merged 2026-09-19, reviewed the same day)

Pull request #1, 23 commits from a teammate's fork, merged straight into
`main` without review. It adds a SECOND way into the interviews, next to the
apply form → HR selection → personal link flow decided on 2026-09-16:

- **The room flow (0005).** Each room is a company + a physical room created
  together by `createRoomAction` (Rooms tab, formerly Companies), with that
  one day's 15-minute session. The company gets a `candidate_token`, a
  public link `/interviews/room/<token>` where a candidate types a name, a
  phone and optionally a CV. HR pastes accepted phone numbers per room
  (`accept_phone`); a candidate whose phone is on the list is sent to their
  personal `/interviews/s/<token>` page to book. `applications.email` is
  nullable now; rooms created this way have `is_hidden` doubling as
  "deleted" (soft, restorable from the Rooms tab). The slot picker shows a
  room's whole day, taken times greyed. `rooms(edition_id, name)` is no
  longer unique (0007).
- **The floor sheet (0006).** One Google Sheet per edition, rebuilt after
  every booking/stage change (`kickSheetsSync` since 2026-10-05, fire-and-forget) and on
  *Sync now* in Settings; one tab per day, two rooms per row, a hidden
  booking-id column. Its Status column is the one thing read BACK, and only
  when someone presses *Pull from Sheet*. Needs the club's Google account
  (Admin → Google) reconnected once for the new `drive.file` scope.
- **0008 dropped the "cannot book a past time" rule** for testing.

**Review on 2026-09-19 (`0009_room_flow_hardening.sql` + code):**

- Phone numbers are normalised (`app.normalise_phone`: digits only, Saudi
  international prefixes folded to the local `05…` form) before storing and
  comparing; the unique index on phone became a plain expression index, so
  two applications sharing a number, or the April 2026 import, can no longer
  fail a migration or an apply-form submit with a raw database error.
  `app.application_by_phone` picks the fullest record (one with an email),
  then the newest.
- `room_login` refuses (`use_personal_link`) when the phone belongs to an
  application that came through the apply form, and never overwrites an
  existing name or CV — it used to hand out anybody's personal token, name
  and CV to whoever typed their phone number.
- The past-time rule is back for **active** editions (`app.refuse_past_slot`);
  a **draft** edition ignores the clock so rooms can still be tried out
  against today's date. Set the edition *Active* for the event.
  **Dropped again by 0012** (2026-10-07): any time can be booked.
- The sheet is no longer shared "anyone with the link" (it holds names,
  phones and 30-day CV links). `revokeLinkSharing` runs on every sync and
  also closes sheets created before this; share it by name from the club's
  Google account. Concurrent syncs of one edition are coalesced per server
  instance (`syncCoalesced`) so two bookings seconds apart no longer race
  over the same tabs.
- The Rooms tab again shows each company's interviewer link, PIN and *New
  link* (behind *Interviewer link and PIN*), and takes an Arabic company
  name, so the apply-form flow stays manageable.

**The Rooms tab without 0005 (2026-10-02).** 0005–0009 were never applied to
the real project, so rooms had no candidate link, and the tab hid Edit,
Delete, the accepted-phones list and the interviewer link behind that link.
Now only the candidate link waits on 0005; everything else shows on every
room. The accepted-phones list no longer uses 0005's `accept_phone`,
`unaccept_phone` and `accepted_phones`: HR pastes numbers (nothing is filled
in automatically), each is matched in the app to the applicant who applied
with it (`src/lib/interviews/phone.ts`, the same rule as
`app.normalise_phone`; an application with an email first, then the newest),
and accepted for the room's company with 0001's `decide_preference`, the
Accept button's own function. A number that matches nobody, or a student who
did not choose that company, is listed back instead. The list is read
straight from `application_preferences`, so a student accepted from their
applicant page shows there too. Accepting queues the acceptance email with the
personal booking link, which goes out once Resend is configured.

**Room links without 0005 (2026-10-02).** Each room's public link is kept in
the edition's settings, `room_links` ({ company id: token },
`src/lib/interviews/roomLinks.ts`); **Add room** creates it, and older rooms
get a **Create room link** button. The link (`/interviews/room/<token>`) asks
for name, phone, email and a CV. Since 0013 (below) the phone alone finds
the application, and that application must be accepted for the room's
company; then the student goes to their personal booking page (0002).
A new CV replaces the one on file, written straight to the row (audited as
`system`). **Since 2026-10-16** the CV is required every time, even when one
is on file, and always replaces it (the club's decision): the company sees
the CV the student brings on the day. Since a phone number alone is enough,
the old file is no longer removed from storage; the audit log's `before`
row holds its path, so a CV replaced by somebody else can be put back. **Add room** can now attach the room
to an existing company (the one students chose on the form) instead of
always creating a new company, which used to leave two companies of the same
name, one chosen by students and one holding the room. Each room's times are
its own slots: a 2pm booked in one room leaves every other room's 2pm free,
while one student still cannot hold two overlapping times
(`bookings_no_overlap`). A 0005 `candidate_token`, where that migration ran,
still works as a fallback link.

**Open decision for the club (not taken in code):** run the event on the
room flow (phone list at the door), on the apply-form flow (HR selects
applicants, students get a personal link by email), or both. Until it is
taken both work side by side. The phone-only door is, by design, only as
safe as HR's list: anyone who knows an accepted person's number can act as
them there. If the room flow is chosen for real, add a second factor (a
PIN HR hands out, or an SMS code) before the event.

**Migrations 0005–0014 are applied to the interviews project
`qadhnttgtytnibgumrax` (2026-10-11).** The project lead pasted them into the
dashboard's SQL editor as one script (one transaction, each file followed by
its `schema_migrations` row), so `db:push` reports the database up to date.
The first attempt failed on 0005's unique phone index, because real
applications share a number; 0005 was corrected in place (see below) and
the second attempt went through. The teammate's `scripts/tests/interviews-tests.mjs`
coverage was not extended; the room flow is untested by script.

## The apply form keeps what was typed (2026-10-11)

Found by a launch-readiness review the night before the public opening:

- **A CV over about 4.45 MB never reached the app.** A server action posts
  the whole form, CV included, as one request, and Vercel refuses a body
  over that size with a 413 (`next.config.ts`'s 12 MB `bodySizeLimit` cannot
  lift it). The page then crashed to Next's English error screen and the
  form was lost. `cvLimits.ts` now holds one 4 MB limit for the server
  (`cv.ts`) and the three forms, which refuse a bigger file or a non-PDF
  before sending: the apply form in its message box, the Register tab under
  the drop zone, the room link through the browser's own bubble.
- **React resets a form after its action, refusals included.** The apply
  form therefore sends from `onSubmit` (`preventDefault` plus
  `startTransition(formAction)`); React sees the prevented event and skips
  the reset. It also checks that a company was chosen before sending.
- **A request that fails outright** (dropped connection, 413, a deploy while
  the page was open, which changes the server action ids) is caught around
  the action and shown as `errors.network`, with the answers still there.
  A database error that is not one of `submit_application`'s refusals is
  logged by code only (its message can hold the email) and shown as
  `errors.generic`; a storage error as `errors.upload_failed`.
- **Phones typed in Arabic digits** (٠٥…) are stored as 05… (`westernDigits`
  in `phone.ts`, used by `applyPayload.ts` for the phone and GPA, and by
  `normalisePhone`). Before this, both normalisers turned them into nothing,
  so HR's list could never match that student.
- **A PDF a phone labels `''` or `application/octet-stream`** is uploaded as
  `application/pdf`; the bucket accepts nothing else, and for a File the
  upload ignores the `contentType` option.
- **A link without `/ar` or `/en`** (`/interviews/apply/<slug>`) used to send
  students to the login page: the proxy dropped the first path segment when
  there was no locale. It now keeps it, and next-intl adds `/ar`.

## Registering, full companies, and the registrations sheet (0010)

- **Applicants tab** now opens with the application form (the public link,
  whether it is taking applications, and the questions it asks) and, for
  managers, the companies students choose from (their رغبات): add, edit,
  logo, Mark as full, Remove/Restore (`CompanyManager.tsx`).
- **The applicant list at volume** (`loadApplicants` in `queries.ts`, fixed
  2026-10-11). Applications and preferences are read in pages of 1000, the
  preferences by edition. The company and decision filters run over every
  application, and the list shows the newest 500 matches with "Showing the
  newest 500 of N". Before, the filters only saw the newest 500 (on the April
  2026 archive's 876 applications the tab said "500 applicants"), so once an
  edition passed 500 the earliest applicants matched no filter. The
  preferences were also fetched with an `.in()` of up to 500 ids, a URL of
  about 20 KB. Hosted Supabase still answered that, but any error was dropped.
- **The questions are a setting.** `editions.settings.apply_fields`, edited
  under *Edit questions* on the Applicants tab, says for phone, university,
  year (`level`), major, college, GPA, English, club member and "why your
  first choice" whether each is not asked, optional or required
  (`src/lib/interviews/applyFields.ts`). Name, email, the companies and the
  CV are always asked. An edition that never saved a choice gets the club's
  October 2026 list: phone, university, year, major required, the rest off.
  Both forms draw the questions from it (`ApplicationQuestions.tsx`), and
  both actions check required answers and drop unasked ones on the server
  (`applyPayload.ts`); the database itself still only insists on name,
  email, companies and CV. No migration: settings is a jsonb that
  `update_edition` merges.
- **Register tab** (`/projects/<id>/interviews/register`, HR and managers).
  The same questions as the public form, the companies as cards, and the CV,
  for a student registering at the stand. It goes through the same
  `submit_application` as the public form, with the staff member as
  `p_actor`. 0010 lets a **member** actor register outside the public window
  (draft or closed editions; archived still refuses) and records them as the
  author; the public form passes no actor and keeps the window. Every other
  rule holds for both: the company limit, one application per email, the CV.
- **Company cards** (`src/components/CompanyPicker.tsx`) replace the numbered
  selects on the public apply form too. The order companies are tapped in is
  their rank.
- **Full companies.** Mark as full / Mark as open on the Applicants tab
  (managers only) keeps a list of company ids in the edition's settings,
  `full_companies` (`src/lib/interviews/fullCompanies.ts`), so it works
  without 0010. A full company is NOT hidden: it stays on both forms, blurred
  and unclickable, and both submit actions refuse it (`company_full`) before
  anything is uploaded, unless that student's application (same email)
  already held it, so fixing a typo never costs them a company they had. The
  refusal is in TypeScript, not SQL; a company marked full in the same second
  a student submits can slip through, which is harmless. 0010's
  `companies.is_full` and `set_company_full` are unused. Remove on the
  Applicants tab is the old soft-delete (`is_hidden`, plus the room if it has
  one, the same action as the Rooms tab), restorable.
- **Logos** need no file storage. Choosing one on the Applicants tab shrinks
  it in the browser to at most 160 px (`src/components/LogoInput.tsx`) and
  stores the result in `companies.logo_url` as a `data:image/webp` address, a
  few kilobytes; the server accepts only a PNG/WebP/JPEG data URL under
  200 KB. Pasted external URLs still work from the Rooms tab, which carries an
  uploaded logo through unchanged. (The first version uploaded into a `logos`
  bucket that 0010 creates; that bucket was never there on the real project,
  so uploads failed with "Bucket not found". The bucket is now unused.)
- **Registrations sheet.** `src/lib/interviews/registrationSheet.ts`. Every
  accepted submission (public form and Register tab) appends one row through
  `after()`: submitted, name, email, phone, university, year, major,
  companies in rank order, CV, note ("Updated" for a re-submission),
  application id. University and year are written as the English labels.
  The sheet's id and link are kept in the edition's settings, so it needs
  only the Google account, no migration. The first submission
  creates the sheet; its link is on the Applicants tab (and in Settings), and
  *Sync now* in either place rewrites it from the database (one
  row per application), which repairs any row Google missed. Same rules as the
  floor sheet: owned by the club's Google account, shared by name only, link
  sharing revoked on every rebuild. The CV column links to `/api/interviews/cv`,
  which needs a signed-in HR person or manager, so the link never expires and
  is useless to someone the sheet was forwarded to. User text is written with
  a leading apostrophe so a name starting with `=` stays text and `05…` keeps
  its zero.

**Applied 2026-10-11**, with 0005–0014. On a database without
`0010_register_full_companies.sql`, nothing crashes, and the question
settings, Mark as full, logos and the registrations sheet all work without
it; the one thing that waits on 0010 is staff registration outside the
public window (until then it follows the window). The registrations sheet's id and link are kept in the edition's
settings (`registrations_sheet_id`, `registrations_sheet_url`), so 0010's
columns of that name and `set_registrations_sheet` are unused, as are its
`logos` bucket and `is_full` column; if the SQL cannot create the bucket,
ignore the warning.

**0009 was corrected in place (2026-10-02).** `app.application_by_phone`
ordered by `a.created_at`, a column `applications` never had, so 0009 failed
and rolled back on every database (db-push and the SQL editor both run a file
as one transaction). It now orders by `submitted_at`. Editing a merged
migration is normally forbidden because a recorded one would never re-run;
0009 could not have been recorded anywhere, so the edit is what lets it apply
at all. 0010 redefines the same function as a backstop. All ten interviews
migrations now apply in order to an empty Postgres 16, each in one
transaction.

**0005 was corrected in place (2026-10-11)** for the same reason. It
created a UNIQUE index on `applications (edition_id, phone)`, which cannot
be built on the real data (applications share phone numbers, as 0009's
header predicted), so 0005 failed on the live project. 0009 drops that index
anyway and creates the plain `applications_edition_phone_idx`, and nothing
in between relies on it, so the line was removed. 0005 had never been
recorded anywhere, and the live project ran the corrected version.

## Verified

The four interviews migrations and every function were driven through an
embedded Postgres (PGlite) before touching any project: 66 checks — the
double-booking race, overlap, room clash, stage rules, duplicate-application
rules, dedupe of every email, the archived edition refusing writes.
`scripts/tests/interviews-tests.mjs` repeats them against the real project with two
connections firing at once; `scripts/tests/component-tests.mjs` covers 0062.
`npm run build`, `npm run typecheck` and `npx eslint` are clean.

**Both Google Sheets remember themselves in the edition's settings
(2026-10-02).** The floor sheet saved its id with 0006's `set_floor_sheet`,
ignored the error when 0006 was missing (as on the real project), and so made
a new spreadsheet on every sync without ever showing a link. It now keeps
`floor_sheet_id` / `floor_sheet_url` in the settings, the same way the
registrations sheet keeps `registrations_sheet_id` / `_url`; 0006's column
still counts where it exists. Both sheets use the Google account connected
under Admin → Google (any account; the sheets belong to it) and need the
Google Sheets API and Google Drive API enabled in that Google Cloud project
as well as the Calendar API. Both have a **Sync now** button, which shows
Google's error if one comes back; the automatic syncs only log it.

## More in the Google Sheets: company sheets, full answers, All bookings (2026-10-05)

No migration; everything new is kept in the edition's settings.

- **Both layouts follow the club's 5th-edition templates** ("Rooms" and
  "Company Template", the .xlsx files the organizers made). The colours,
  merges, dropdowns and widths are Sheets API requests built in
  `floorSheet.ts` / `companySheets.ts` from the helpers at the bottom of
  `src/lib/interviews/sheetFormat.ts`. If the template changes, change those;
  there is no template file read at run time.
- **Floor sheet, per the Rooms template.** One tab per day; a teal
  `DAY 1 · OCTOBER 12` banner; rooms two side by side, each with a teal
  title bar, the mint / lavender / lime header (Time, Company, Student Name,
  Student Phone Number, Status, Notes), one row per slot of the room's
  session, and a ROOM SUMMARY (total, booked, available) under it. **The CV
  column is gone**, because the template has none, and with it the 30-day
  signed CV URLs (`signCvLong` is deleted). Status uses the template's words:
  Arrived, In-interview, Completed, Late (= no-show), Gap (a slot closed for
  a break), blank for booked-but-not-arrived. Since 2026-10-10 each word
  colours its cell (conditional formatting, `STATUS_TONES` in
  `sheetFormat.ts`, shared with the company sheets): Completed green,
  Arrived blue, In-interview yellow, Late red, Gap grey. *Pull from Sheet* reads the
  first four back, and only calls `advance_stage` for rows that differ from
  the database. **Notes are the organizers'**: each rewrite reads the tab
  first and puts every note back on its row, matched by the hidden eighth
  column (booking id, or `slot:<id>` for a free slot). A note typed in the
  second or two between that read and the write is lost. **A room can hold
  two companies in one day** (STC 2–5, PwC 5–8: two sessions in one room,
  made on the Schedule tab, or since 2026-10-07 with *Assign a company* on
  the room's card on the Rooms tab). Their slots run on in time order and each row names the company of
  its own slot.
- **Company sheets** (`src/lib/interviews/companySheets.ts`), per the Company
  template. **One spreadsheet per company AND room**: STC in Room 1 and Room
  2 has two files. Each file has one tab per day and shows only that
  company's own hours in that room, so when PwC takes Room 1 after STC, each
  sees only its own students. Created when a manager presses *Create Google
  Sheets* in the company's card on the Rooms tab (one file per room the
  company has a session in); from then on the company is opted in, and a
  room it is given later gets its file on the next sync — HR still has to
  share that new file. The edition's Arabic name on the banner, the
  COMPANY / DATE / ROOM band, then a row per slot: Time, Interviewer, Student
  Name, **Phone Number** (the club decided on 2026-10-05 that companies get
  it, as the template shows), Student CV, Feedback Link, Status. Status is the
  system's (Interview Done / No Show / In-progress, from the floor; coloured
  green / red / yellow like the floor's) and is
  never read back. Interviewer is filled with the company's name on every
  slot (since 2026-10-07); a person's name typed over it is carried across
  rewrites like the floor's Notes (keyed by slot), and a cleared cell goes
  back to the company's name. Nothing is shared
  automatically; HR opens it from the club's Google account and shares it by
  name, and link sharing is revoked on every rebuild. The CV link is the
  interviewer page's own (`/api/interviews/cv?token=<company token>&booking=…`)
  and the Feedback link opens `/interviews/c/<token>?day=…&open=<booking>`,
  which the company page now honours by opening that student's feedback form.
  Both behave like the interviewer link: open to whoever sees the sheet when
  the company has no PIN, only after the PIN when it has one. A new
  interviewer link changes both, and the sync that follows rewrites them. Kept
  in settings as `company_sheets` (`{ "<company id>:<room id>": { id, url } }`).
- **Registrations sheet, wider.** Every question the form can ask now has a
  column (college, GPA, English, club member, why first choice), plus
  **Accepted**, **Rejected** and **Booked**. The column of a question the
  edition does not ask is hidden unless somebody answered it. Because those
  three columns change after the row was appended, the sheet is now also
  rewritten after HR decisions (Accept/Reject, the accepted-phones list) and
  after bookings, which also folds "Updated" duplicates away.
- **Floor sheet, "All bookings" tab.** After the day tabs: every live booking
  on one flat list with arrived, started and finished times, booked at and
  by whom. Same rooms as the day tabs. *Pull from Sheet* skips this tab; only
  the day tabs' Status column is read back.
- **One background sync for all of them** (`src/lib/interviews/sheetsSync.ts`,
  `kickSheetsSync`). It replaces `kickFloorSheetSync` at every call site and
  keeps its coalescing (at most two rebuilds per burst, per instance). It
  runs floor, then company sheets, then registrations, each on its own so one
  broken sheet does not stop the others.

**Quota is the thing to watch.** Everything shares one Google account, and
Sheets allows roughly sixty write requests a minute per account. A booking
already cost the floor sheet about four writes and one read (the Notes) per
day tab; it now adds about
four for the All bookings tab, four for the affected company's sheet, and four
for the registrations sheet when its Booked column changes. To keep that down,
the company and registrations sheets hash what they would write and skip
Google entirely when it matches what this instance last wrote
(`writtenAlready` / `rememberWritten` in `src/lib/google/sheets.ts`). The memory
is per instance and lasts ten minutes, so a hand edit or another instance's
write can survive up to ten minutes; *Sync now* never skips. If the logs show
`429` / "Quota exceeded" during a booking rush, the first fix is to stop
rebuilding the registrations sheet on bookings (drop it from `syncAll`) and
rely on *Sync now*.

**Hit for real in the 2026-10-07 rehearsal, and fixed.** Creating the sheets
of a 7-room, 6-company day (floor, registrations and five company files)
in one go ran into Google's "Write requests per minute per user" limit, and
the sync stopped. Two changes followed:
- `writeTab` now rewrites a tab in **one** batchUpdate instead of four (clear,
  reset formats, values, formats). Values go in as `updateCells`: a
  `=FORMULA` stays a formula, and everything else is plain text, so a
  leading apostrophe marks text and is dropped. A full floor rewrite went
  from about 12 write requests to 3.
- `googleFetch` waits and retries on 429, honouring `Retry-After` and
  otherwise waiting 5 s, then 20 s, then 40 s, before giving up.

**Not exercised against Google yet**, like the rest of the Google code. What
was checked: the real sync code was run against a fake Google and a fake
interviews database (invented data), its requests replayed into a picture
and compared with both templates, and the behaviour confirmed: Pull applies
only the changed Status, Notes and Interviewer survive a rewrite, and an
unchanged company sheet costs no Google calls. What a fake cannot show is
Google refusing a request; expect to fix something on the first real sync.

## Status edits in the sheets come back into the app (2026-10-05)

**Off by default since 2026-10-14** (see "One organizer per room" below):
everything in this section now happens only while Settings → Live Google
Sheet → *Status typed in the Google Sheets* is set to two-way.

The club wants to work from either side: the app or the sheets. So the
**Status** column of the floor sheet's day tabs and of every company sheet now
goes both ways. Nothing else does. Students, times and phone numbers are the
app's, and the booking rules in SQL decide them. Notes (floor) and
Interviewer (company) are free text that lives only in the sheet.

- **How an edit is recognised.** Every booked row carries a hidden *base*
  column, `<booking id>|<stage>`: the Status the system last wrote. A Status
  that differs from what the base shows is an edit; reading a sheet that
  nobody touched therefore changes nothing.
- **The safety rules** (`src/lib/interviews/sheetPull.ts`):
  - Compare-and-set: an edit is applied only while the booking's stage in the
    app is still the base. If the floor board moved the student in the
    meantime, the app wins and the next rewrite shows its value.
  - Only a word from the sheet's dropdown counts. A blank, a typo or anything
    else is ignored and put back.
  - A company file can only move bookings of its own company in its own room,
    checked against the database, so editing the hidden columns does not
    reach anyone else.
  - Every change goes through `advance_stage` (manager rules, so a jump is
    allowed) with an actor naming the sheet: `Floor Google Sheet`, or the
    company with "(Google Sheet, Room 1)". Google does not say which person
    typed it.
- **When.** Three moments:
  1. Just before any sync rewrites a sheet, which reads it first (one request
     for all tabs, `readAllTabs`). An edit is therefore never overwritten
     before it is read.
  2. Every minute, from `/api/interviews/sheets` for **active** editions. One
     Google Drive request says which files changed (`modifiedTimes`); only
     those are read. A quiet minute costs that one Drive call and no Sheets
     quota.
  3. At once from *Pull from Sheet* in Settings, recorded as the member who
     pressed it.

  When an edit moved a booking, the sync runs another round (up to three) so
  every other sheet shows it too.
- **Scheduling needs a person.** `npm run interviews:cron` now installs two
  pg_cron jobs in the club's Supabase project: the existing
  `interviews-sweep` (every five minutes) and `interviews-sheets` (every
  minute). It has to be re-run once after this merges; until then edits come
  back only on a rewrite or on *Pull from Sheet*.
- **The window between check and change, closed by 0011.** The app's
  compare-and-set read the stage and then called `advance_stage`, so a
  floor-board click landing in those milliseconds could be overtaken by the
  sheet. `0011_advance_stage_expected.sql` gives `advance_stage` an optional
  `p_expected`. It locks the booking row (`for update`), compares, and refuses
  with the hint `stage_changed` when the stage moved, so the click wins and
  the sheet is corrected. Every other caller passes no `p_expected` and
  behaves exactly as before. The old four-argument function is dropped,
  because keeping both would make calls ambiguous.
  **Applied to the interviews project** (reported 2026-10-07, though not
  recorded in `schema_migrations`; re-run and recorded with 0005–0014 on
  2026-10-11, which is harmless because the file drops and recreates the
  function). On a database
  without it, the app gets PostgREST's `PGRST202` for the unknown parameter
  and falls back to the old call, so nothing breaks; only the millisecond
  window stays open. It was applied, with 0001–0010, to an empty embedded Postgres
  (PGlite), twice, and these were confirmed: one function remains, granted to
  the service role only; the old calls work; a stale `p_expected` is refused
  and changes nothing (nor writes to the audit log); a click that lands first
  wins.

Checked against the same fake Google as above with invented data:
- a company edit reaches the app and the floor sheet;
- a conflicting edit leaves the app's value, and the sheet is corrected;
- a tampered hidden column cannot move another company's booking;
- junk is ignored and replaced;
- a floor edit waiting when a rewrite starts is applied first;
- a quiet minute reads no sheet;
- Interviewer names survive.

## Rooms and companies are separate (2026-10-07)

The club lays out the venue before it knows which company goes where, so a
room and a company are now made apart and joined later. The database
always allowed it (`rooms` and `companies` have no link; a **session** is
what puts a company in a room for a day and hours). Only the screens tied
them together.

- **Rooms tab** (`interviews/rooms/page.tsx`, new): one card per room, with
  its name and **location** (`rooms.note`: building, floor…). *Assign a
  company* on a room's card creates a session (`createSessionAction`) for a
  company, a day and hours (20-minute slots since 0012). One room can host several
  companies on one day at different hours. The card lists who is assigned
  when, with *Remove* (`deleteSessionAction`, refused while students are
  booked). Rooms are retired, never deleted.
- **Companies tab** (`interviews/companies/page.tsx`, the URL the old Rooms
  tab had): one card per company. It holds the company's add/edit form with
  logo (moved here from the Applicants tab, which now links to it), Mark as
  full, Remove, the candidate link, accepted phones, interviewer link and
  PIN, and its Google Sheets. The card lists the rooms it was assigned to.
- **Gone:** `createRoomAction` (room + company + session in one go, fixed
  15-minute slots), `renameRoomAction` and `setRoomDeletedAction`. Those
  two found "the company's room" through its first session, so with two
  rooms they changed an arbitrary one, and removing a company also retired
  a room. **Removing a company now hides only the company**
  (`setCompanyHiddenAction`).
- **Fixed:** *Retire* / *Bring back* on a room used to send an empty
  location, and `upsert_room` erased the room's note. `upsertRoomAction`
  now sends only the fields the form has.
- Every room, company and assignment change, and closing a slot, now
  re-syncs the Google Sheets (`kickSheetsSync`).
- Rooms made by the old *Add room* keep working: they are ordinary rooms
  and companies with a session between them.

## The floor before companies: event days and hours (2026-10-07)

**Settings → Event days and hours** stores the event's first and last day,
daily hours and a row length in the edition's settings as `floor_layout`
(`src/lib/interviews/floorLayout.ts`). No migration. Leaving the first day
empty clears it.

- **What it changes.** On those days, the floor Google Sheet and the Floor
  tab's new **By room** view lay out every active room with a row every row
  length between those hours, before any company is assigned. A company
  assigned to a room replaces the rows of its own hours with its real slots
  (`roomDay`). A grid time is dropped when a slot is running at that moment,
  so a company on 15-minute slots in a 20-minute grid shows its own times.
  Days with sessions outside the layout still appear, as before.
- **Empty rows hold no booking.** They carry a key (`grid:<room>:<time>`) so
  a Note typed on one is kept, and no base, so their Status is never read
  back. Room summaries count only real slots.
- **Floor tab.** *By company* is the old board, with the stage buttons. *By
  room* is read-only: every room of the day side by side, refreshed every 15
  seconds (`AutoRefresh`).
- **Checked:** grid times convert from the edition's clock (14:00 Riyadh is
  11:00 UTC, and a summer-time zone converts too); bad dates, times and
  lengths are refused, as are more than 14 days; and the fake-Google
  harness confirmed empty rooms, half-assigned rooms and Notes on empty rows.

## A room's own days (2026-10-09)

A room can be given the days it is in use when it is made or edited
(Rooms tab → *Add room* / *Edit*: **First day**, **Last day**, both
optional). Kept in the edition's settings as `room_days`
(`{ "<room id>": { from_day, to_day } }`, read through `roomDays` in
`src/lib/interviews/floorLayout.ts`). No migration.

- **The floor.** `floorPlan` (floorLayout.ts) decides which rooms the floor
  Google Sheet and the Floor tab's *By room* view lay out on each day: a
  room with days on those days only, whether or not they are event days; a
  room without them on every event day of Settings → Event days and hours,
  as before. Its empty rows use the layout's hours, or 14:00–20:00 in
  20-minute rows (`DEFAULT_HOURS`) when no layout is set. Days with
  sessions still appear as before. Saving a room re-syncs the Sheets.
- **Assigning.** The *Assign a company* form starts on the room's first day
  (else the event's first day) and only offers its days.
  `createSessionAction` refuses a day outside them, from the Rooms tab and
  the Schedule tab alike (`roomsTab.outsideDays`).
- **Changing the days.** Narrowing them past a company already assigned to
  the room is refused, naming the company and day (`roomsTab.daysClash`):
  remove that assignment first. Emptying both fields puts the room back on
  every event day. *Retire* and *Bring back* leave the days alone.
- The check is in the app, not the database: `create_session` called some
  other way does not know a room's days.

## Candidate link and accepted list per assignment (0014, 2026-10-10)

`supabase/interviews/migrations/0014_session_acceptances.sql`, **applied
2026-10-11** after 0012 and 0013 (it redefines 0012's `book_slot` and
`move_booking`). It can be run twice.
Checked on an empty local Postgres 16 with 0001–0014.

A company that interviews on several days stays one company. What used to
be per company is now per **assignment** (a session: one company in one
room on one day and hours), on the **Rooms tab**, under each assignment:

- **Candidate link**: kept in the edition's settings as `session_links`
  (`{ session id: token }`, `roomLinks.ts`), *Create candidate link* /
  *New candidate link*. The page names the room and day. HR (role `hr`)
  makes and renews it as well as the managers (2026-10-16,
  `createSessionLinkAction` guarded by `can.decide`), so whoever keeps an
  assignment's accepted list can hand out its link too.
- **Accepted phone numbers**: `session_acceptances` (0014) through
  `accept_for_session` / `unaccept_for_session`, by HR and the managers. A student on an
  assignment's list books **only that assignment's times**: HR decides
  their day by the list they put them on. `book_slot` and `move_booking`
  refuse anything else (`not_your_session`) when the student has any list
  of that company; the booking page shows only those times. Accepting also
  accepts them for the company (application_preferences), which `do_book`
  still checks; taking them off the last list of a company puts it back to
  pending. Staff booking (Bookings tab) is not restricted by day.
- **Google Sheet for the company**: the same per company-and-room sheet
  as before (`company_sheets`), moved here. Two days in one room share it.
- **Removing an assignment** is refused while anyone is on its list
  (`deleteSessionAction`), so nobody is left accepted with no day.
- **Companies tab** keeps only the company itself and its interviewer link
  and PIN. HR can mark a company full or open there (2026-10-18,
  `setCompanyFullAction` guarded by `can.decide`); editing, removing and
  prayer breaks stay the managers'.
- **Kept working:** students accepted the old way (per company, no list)
  can still book any time of that company, and per-company links already
  handed out (`room_links`) still open; they are no longer shown or made.
  0013's `accept_for_company` is no longer called by the app.
- **Before 0014 is applied** the lists say the migration is needed and
  accept nothing; links, sheets and booking work as before.

## Any number on HR's list, and a phone-only candidate link (0013, 2026-10-09)

`supabase/interviews/migrations/0013_accept_any_phone.sql`, **applied
2026-10-11**. It needs only 0001–0004 and can be run twice. Checked on an empty local
Postgres 16, both with 0001–0004 only and with 0001–0012.

- **HR's accepted list takes any number** (Companies tab → *Add phone
  numbers*, `acceptPhonesAction`). A number is accepted for that company
  whether or not the student chose it on the form; a number that never
  applied becomes an applicant with only a phone (no name, no email) and is
  accepted. `accept_for_company` does both; the app matches the number
  (`applicationsByPhone` in `queries.ts`) and passes the application it
  found. `applications.email` may now be empty. Something with fewer than 9
  digits is listed back as not a phone number.
- **Before 0013 is applied** the action falls back to `decide_preference`
  as before: only numbers that applied and chose the company are accepted,
  and the message says to apply 0013 for the rest.
- **The candidate link matches on phone only** (`roomLoginAction`). The
  form is unchanged (name, phone, email, CV), but the email is no longer
  compared with the one the student applied with: the club chose this on
  2026-10-09 to keep the door simple. **Risk:** anyone who knows an
  accepted student's number reaches their booking page and can move or
  cancel their interview; the open decision below about a second factor
  still stands. To limit the damage, nothing on file is overwritten: the
  name and email are filled in only while blank (a number HR added), and a
  new CV replaces the old one only when the typed email is the
  application's own; otherwise it is added only while there is none.
- A student HR added by phone who later fills in the apply form with an
  email gets a second application; lookups by phone prefer the one with an
  email.

## Prayer breaks per company: Asr and Maghrib (0017, 2026-10-16)

`supabase/interviews/migrations/0017_company_prayer_breaks.sql`. It can be
run twice. Some companies asked to keep interviewing through the breaks.

- **Two switches per company**, Companies tab → *Prayer breaks*:
  `companies.asr_break` and `companies.maghrib_break`, both on by default,
  so a company nobody touches behaves exactly as under 0012. Cards show a
  "No Asr break" or "No Maghrib break" badge when one is off.
- **Making slots** (`create_session`, `extend_session`) skips only the
  company's own breaks: `app.company_breaks(company, day)` filters
  `app.prayer_breaks`, which now names each break (`key`). The old
  four-argument `app.next_slot_start` still skips both and is unused.
- **Switching changes existing sessions**, in the same transaction
  (`set_company_prayer_breaks`, `setCompanyPrayerBreaksAction`):
  - **Off:** it reopens slots an earlier switch closed inside the break, then
    adds 20-minute slots from the break's start while one fits before the
    session's next slot. The break is 30 minutes, so only 15:00 (or 17:30) is
    added and ten minutes stay empty. To get a seamless grid, remove the
    assignment on the Rooms tab and assign it again.
  - **On:** it closes the free slots inside the break. Booked ones stay where
    they are, and the form says how many need moving.
- **Break times are unchanged** and still live in two places that must
  change together: `app.prayer_breaks` (a new migration) and
  `PRAYER_BREAKS` in `src/lib/interviews/slotRules.ts`. The floor grid still
  leaves both breaks as empty rows, and a no-break company's slots show at
  their real times beside them (`roomDay`).
- **Before 0017 is applied** the Companies tab shows no switches (the page
  checks for the column), and slots are made as under 0012.
- **Checked** on an empty local Postgres 18 with 0001–0017 applied, using
  invented data. 15 checks passed:
  - both breaks over 14:00–19:00, and the 17:00–19:00 cases;
  - 15:00–15:30 refused with Asr kept;
  - fills at 15:00 and 17:30, and saving twice changes nothing;
  - switching back on closes the free slot and holds the booked one;
  - switching off again reopens the closed slot;
  - extending keeps the company's rule;
  - unknown companies and archived editions are refused;
  - the old function is unchanged.

  Re-running the file applied cleanly.

## 20-minute slots, prayer breaks, past times bookable (2026-10-07)

`supabase/interviews/migrations/0012_fixed_slots_prayer_breaks.sql`,
**applied 2026-10-11**. It can be run twice.

- **Every slot is 20 minutes.** The slot-length picker is gone from the
  Rooms and Schedule tabs, and `create_session` makes 20-minute slots
  (`app.slot_minutes()`) whatever it is sent. Mixing a 20- and a 30-minute
  assignment for one company filled the student's picker with overlapping
  times. Sessions made before keep their own length; `extend_session` grows
  them at it.
- **Prayer breaks: 15:00–15:30 and 17:30–18:00** on the edition's clock
  (`app.prayer_breaks`). No slot is made across one; slots run up to the
  break and pick up when it ends (14:00 … 14:40, 15:30 … 17:10, 18:00 …).
  Because of that ten-minute shift an assignment's end no longer has to be
  a whole number of slots: slots are made while one fits and the session is
  trimmed to its last slot. Hours with no room for any slot are refused
  (`no_slot_fits`). The same times are in `src/lib/interviews/slotRules.ts`,
  which the floor grid (`gridTimes`) uses so its empty rows line up;
  **change both together**, with a new migration for the SQL side.
- **Existing slots inside a break are closed** (`is_closed`) by the
  migration, unless a student holds one; those stay for HR to move. Nothing
  is deleted. A company already assigned on 30-minute slots keeps them:
  *Remove* that assignment on the Rooms tab and assign it again.
- **A past time can be booked** in every edition: `book_slot` and
  `move_booking` no longer call `app.refuse_past_slot` (dropped). The team
  books on students' behalf and the refusal only got in the way. The
  change-cutoff (`within_cutoff`) still applies to moving a booking.
- **The student's picker groups times under a date and room heading**, so a
  company with rooms on several days no longer shows two identical-looking
  times side by side.
- **Before the migration is applied** nothing breaks: the app sends 20
  minutes, which the old `create_session` accepts whenever the hours are a
  whole number of 20-minute slots; breaks are not skipped and past times are
  still refused until it runs.
- **Checked** on an empty local Postgres 16 with 0001–0012 applied and
  invented data: 14:00–17:00 makes seven slots ending 16:50; extending to
  20:00 adds 16:50, 17:10, then 18:00–19:40; 15:00–15:30 alone is refused
  and leaves no session behind; a slot whose time has passed books; a
  30-minute slot at 17:30 is closed while a booked one at 15:00 is left;
  re-running the file changes nothing more.

## A project opens in its component (2026-10-07)

Opening a project (`/projects/<id>`), from the dashboard, the projects list,
the KPI page or the sidebar, goes straight into its component when the viewer
may open one. Mock Interviews comes first, else Outreach. A viewer without
access to the component still gets the project page.

- The project page itself is `/projects/<id>?details=1`. Managers reach it
  from **Project details** at the bottom of the Mock Interviews menu, and
  Outreach's back link uses it.
- The Mock Interviews back button now goes to the dashboard for everyone. It
  used to take managers to the project page, which would now loop straight
  back into the component.
- The sidebar's project buttons are the projects the `projects` policy
  returns **plus** every project in `my_component_access()`. Organizers and
  receptionists are listed on the component, not the project, so without
  that second half they had no button and no way in (fixed 2026-10-15).
- Any new link meant for the project page itself needs `?details=1`, or it
  lands in the component.

## Reception (0069, 2026-10-14)

People at the door who check students in and do nothing else.

- **Who.** A third list on the People tab, next to organizers and HR
  people: receptionists, added or removed by the project's managers OR by
  HR's Directors (members.manage at scope all). The rule is club-side:
  `supabase/migrations/0069_interviews_reception.sql` widens
  `project_component_people.role` to `reception`, adds it to the write
  policy, and teaches `my_component_access()` to answer `reception`. The
  strongest role still wins (manager > hr > organizer > reception). Since
  2026-10-20 a person on both the organizer and reception lists is an
  organizer who ALSO gets the Reception tab and its actions: the app reads
  their reception listing itself (`desk` on `ComponentAccess` /
  `InterviewAccess`, `can.reception(role, desk)`); the database function is
  unchanged.
- **What they may do** (`can.reception` in `src/lib/interviews/access.ts`:
  receptionists, HR and managers). The **Reception** tab
  (`/projects/<id>/interviews/reception`): every company's students for one
  day (today by default), a search by phone (any spelling, or the last few
  digits) or name, and **Check in** / **Undo check-in**. With nothing typed
  it lists who is late and not checked in, who is due in the next 45
  minutes, and who is checked in and waiting. It polls
  `/api/interviews/floor` (whose `company` is now optional) every ten
  seconds. Receptionists also see Overview, Schedule and a read-only Floor;
  Companies and Rooms now require `can.decide` (they used to be "anyone but
  an organizer", which would have let a receptionist in).
- **One move only.** `checkInAction` calls `advance_stage` for
  scheduled → arrived or arrived → scheduled, never anything else, and
  passes `p_expected` (0011), so a stale screen cannot pull back a student
  who has moved on: the database refuses with `stage_changed`. It also
  checks the booking belongs to this project's edition.
- **Applying 0069.** **Applied to the live project on 2026-10-15** through the SQL editor, so `schema_migrations` does not record it and the next `db:push` runs it again, which is harmless. A person with access to the CLUB project applies it
  (`npm run db:push`, or paste it into the SQL editor; it can run twice),
  then runs `npm run db:components`, which now includes ten reception
  checks. Until then nothing breaks: the Reception tab works for managers
  and HR, and adding a receptionist is refused by the database's check
  constraint. Verified before merging on a local Postgres 16 with club
  migrations 0001–0069 and stand-ins for Supabase's auth and storage
  schemas (19 checks: who may add and remove, what each person is answered,
  organizer outranking reception).

## One organizer per room, and read-only sheets (2026-10-14)

So that only one person moves the students of a room. No migration.

- **Giving rooms out.** Each room card on the Rooms tab shows its
  organizer, and managers change it (*Change organizer*): one organizer on
  every day, and, for a room used on several days, someone different on a
  particular day. An organizer can hold several rooms. The choices are the
  People tab's organizers. Kept in the edition's settings as
  `room_organizers` (`src/lib/interviews/roomOrganizers.ts`): the key
  `<room id>` is every day, `<room id>:<YYYY-MM-DD>` overrides one day.
  Saved by reading the settings fresh and writing the whole map back, as
  `session_links` are; two managers saving the same second could still
  undo one another.
- **What it changes.** A room with an organizer is theirs: `stageAction`
  refuses anyone else (hint `not_your_room`), except managers, who may act
  anywhere. A room with nobody is open to every organizer, as before, so
  nothing locks until a manager gives rooms out. Someone taken off the
  organizer list keeps their rooms (shown as "No longer an organizer")
  until a manager changes them, so the room stays locked rather than
  silently opening. `stageAction` also now refuses a booking from another
  edition.
- **The Floor tab.** An organizer with rooms that day opens on **My rooms**:
  one board per room, every company in it, with the buttons (the floor
  route takes `room=`). *By company* still works for everyone; a row in a
  room another organizer runs shows "<name>'s room" and no buttons. *By
  room* shows each room's organizer.
- **The sheets are read-only by default.** A Status typed in the floor
  sheet or a company's sheet would get round both this rule and the
  company-finishes-the-interview rule, so `applySheetEdits` (sheetPull.ts)
  now applies nothing unless the edition's `sheet_status_edits` is `true`
  (Settings → Live Google Sheet → *Status typed in the Google Sheets*).
  While off, an edit counts as ignored, which makes the every-minute pull
  start a sync that writes the app's value back over it, usually within a
  minute. *Pull from Sheet* is hidden while off. Two-way is one setting
  away and behaves exactly as it did on 2026-10-05.

## The TV screen (2026-10-18)

`interviews/tv/[token]/TvBoard.tsx`. Each student being called is a card:
name, a large room badge, the company. The board measures itself
(ResizeObserver) and picks the number of columns that makes the cards
largest (`fitGrid`), so a vertical screen gets one or two columns and a wide
one more; every card on screen uses the one name size the longest name
needs (`fitName`), on one line or two. Up next is smaller cards of the same
kind. Checked in a headless browser at 1920×1080 and 1080×1920 with 1, 4, 9
and 14 people called.

## Visitor feedback without a phone; the Development team reads it (2026-10-19)

Two migrations, **not yet applied**, both applied by the project lead
**before** this change is merged (the new form sends no phone, which 0018
refuses):

- `supabase/interviews/migrations/0019_visitor_feedback_anonymous.sql`
  (Interviews database): `application_id` and `phone` may be empty, and
  `submit_visitor_feedback` saves an answer with no phone as anonymous. A
  phone, if a page still sends one, is handled exactly as in 0018. The form
  no longer asks for a phone; a cookie (`vf_<slug>`) remembers that a device
  answered, and the page thanks it instead of asking again. The database
  does not limit anonymous answers per person.
- `supabase/migrations/0072_interviews_development_viewer.sql` (club
  database): `my_component_access()` gives the **Development team**
  (`teams.key = 'DEVELOPMENT'`) the role `viewer` on every Mock Interviews
  project, below reception. A viewer sees only the **Visitor feedback** tab
  (`can.visitorResults`); the overview sends them there, and Schedule,
  Floor and `/api/interviews/floor` refuse them (`can.floorAccess`); every
  other page already required a stronger role.
- The results page shows no names any more, also for answers given with a
  phone before 0019.

Both checked on local Postgres 16: a Development member gets `viewer`, one
who is also an organizer stays `organizer`, another team gets nothing;
anonymous answers are saved, incomplete ones and a closed link refused.

## Walk-ins into a time under way; no-show box; manual booking by day (2026-10-20)

- `supabase/interviews/migrations/0020_walkin_started_slots.sql`
  (Interviews database), **not yet applied**, applied by the project lead
  when this is merged (before or after: the app does not depend on it).
  `walkin_slots` and `confirm_walkin` now treat a time as free for a walk-in
  until it **ends**, not until it starts. Without it, deleting a no-show's
  booking freed a time the walk-in picker never offered. Checked on local
  Postgres 16: a time under way is offered and can be confirmed, one that
  is over is not and is refused (`slot_past`); applied twice.
- Reception's **No show** box, the Floor without no-show, and Manual
  booking's day picker and applicant check: see "Booking by hand at
  Reception" and "No-shows are the reception desk's" below.

## Visitor feedback (0018, 2026-10-18)

`supabase/interviews/migrations/0018_visitor_feedback.sql`, **not yet
applied**: the project lead applies it in the Interviews database's SQL
editor (after 0017). Until then the link answers "Not available right now"
and the tab says the migration is missing; nothing else is affected.
Checked on an empty local Postgres 16 with 0001–0018.

- **The link**: `/interviews/visit/<public slug>`, the edition's slug like
  the apply form's, so it never changes. Settings → *Visitor feedback*
  switches it on or off (`visitor_feedback_open`, off by default) and shows
  the link and a QR code.
- **Who may answer**: the phone number (normalised) must belong to a
  student with a booking, not cancelled, at arrived, in interview or done,
  i.e. someone reception checked in, interviewed or not.
  `submit_visitor_feedback` checks it; the page only says so nicely.
- **The questions** are fixed in the catalogs (`interviews.visitorFeedback.q`)
  and `VISITOR_QUESTIONS` (`src/lib/interviews/visitorFeedback.ts`); the
  database checks the same four keys, each 4 Excellent / 3 Good /
  2 Acceptable / 1 Not good, all required. The comment is optional.
- **One answer per student** (`visitor_feedback`, unique per edition and
  application): sending again replaces it; the audit log keeps the old one.
- **Results**: the *Visitor feedback* tab (HR and managers): how many chose
  each answer per question, and the comments with the student's name.
  The club's export (`edition_snapshot`) includes the table.
## The feedback form is set on the Settings tab (2026-10-17)

What the interviewer fills in is the edition's settings, no migration
(`src/lib/interviews/feedbackForm.ts`), on Settings → *Feedback ratings*:

- **The rated questions**: `rating_labels`, as before (key, English,
  Arabic; up to six). Keep a key once feedback uses it; the text can change.
- **How each is rated**: `rating_scale`, 5 (1–5, the default, what the
  April 2026 edition used) or 3 (*Excellent / Good / Needs improvement*,
  saved as 3 / 2 / 1). `feedback.ratings` keeps plain numbers either way;
  the company page, the server action and the feedback email read the
  scale. Changing the scale after feedback was written changes how the old
  numbers read, so set it before the event.
- **One open question**: `feedback_comment` ({ en, ar }). When set, the
  three boxes (strengths, to improve, overall note) become this one
  question, and its answer is saved in `improvements`; the email prints the
  question above the answer. Empty → the three boxes.

For October 2026 the club chose four questions on the three-step scale and
one open question, "النصيحة والتطوير" (the advice to improve).

## The company finishes an interview with its feedback (0015, 2026-10-14)

The club decided that the only stage a company moves is "done", and only
together with its feedback.

- **The interviewer page** (`/interviews/c/<token>`) shows **Interview done**
  on each student who is not finished or marked as not shown. It opens the
  student's details and the feedback form; the button reads *Save feedback
  and finish*, and saving does both in one transaction:
  `finish_interview(token, booking, payload)` in
  `supabase/interviews/migrations/0015_company_finishes_interview.sql`. It
  saves the feedback exactly as `submit_feedback` does, marks the booking
  done (from scheduled, arrived or in interview, so a company is never
  stuck because nobody pressed "In interview"), and refuses a no-show
  (`marked_no_show`), an empty form (`empty_feedback`: at least one rating
  or one comment) and released feedback (`feedback_sent`). A finished
  interview's feedback stays editable until it is released, as before.
- **A company in two rooms on one day** (2026-10-18): the interviewer page
  asks the rep to pick their room first (`?room=<room id>`, or `all`), and
  shows only that room's students, so a rep does not fill in feedback for a
  student in the other room. A Feedback link from a room's Google Sheet
  (`?open=<booking>`) picks that booking's room by itself. With one room
  that day, the page just names it.
- **Booking by hand at Reception** (2026-10-19), for the project's managers
  and HR's Directors only (`canSchedule` in `access.ts`: role manager, or
  role hr with members.manage at all; not every HR person on the list).
  **Manual booking**: a phone number, then the day (any day with
  interviews, the board's by default), the company, and one of that
  company's free times that day (a company with none left is greyed out).
  As the number is typed the panel shows who applied with it
  (`deskLookupAction`), or that nobody did, and Book stays off until it is
  a registered applicant (2026-10-20). Registered means the student filled
  in a form (apply, candidate link, walk-in), which always leaves a name: a
  number HR only pasted into an accepted list is a phone-only application
  with an empty name and is refused (`desk_not_registered`), here and on the
  Bookings tab (`staffBookAction`), so no booking is made with just a phone.
  Manual booking overrides what the student holds with that company
  (2026-10-20): a scheduled booking is moved to the chosen time; a no-show
  or a checked-in one is cancelled (logged, the student emailed) and the
  student booked again; a finished interview is kept with its feedback and a
  second booking is made beside it; only a student in the interview right
  now is refused (`desk_in_interview`). The second-booking case needs
  **Interviews 0021** (`0021_manual_booking_override.sql`):
  `bookings_one_per_company` now ignores done bookings, and `app.do_book`
  still refuses a student booking for themselves after a finished interview
  with that company (`already_interviewed`). Applied by the project lead in
  the SQL editor; until then that one case is refused as `already_booked`;
  `deskBookAction` finds the applicant by phone, puts them on that
  assignment's accepted list (`accept_for_session`) and books them, or moves
  their existing time with that company. A number nobody applied with is
  refused (add it to a room's accepted phones, or use walk-ins).
  **Reschedule** on a scheduled student: another free time of the same
  company that day (`deskMoveAction`, `staff_move_booking`). The Bookings tab
  is open to the same people (booking and moving); cancelling there stays
  the managers'.
- **No-shows are the reception desk's** (2026-10-19). Reception marks a
  scheduled student **No show**, which opens a box asking *Delete the
  booking?* (2026-10-20): **Yes** marks the no-show and deletes the booking
  in one go (the time is free again, also for a walk-in, see 0020); **No**
  changes nothing, the student stays scheduled (the club's decision of
  2026-10-20: a no-show is always deleted, never kept). A no-show marked
  before that, or from the sheet, is listed under "waiting" with **Undo**
  (`checkInAction`, moves `noShow` / `undoNoShow`, with `p_expected`) and
  **Delete booking**
  (`removeNoShowAction`: `staff_cancel_booking`, logged, slot freed). The
  Floor offers no no-show to anyone, managers included since 2026-10-20 (the
  manager's stage menu leaves it out and hides itself on a no-show row), and
  `stageAction` refuses every move to or from `no_show`. The Floor and
  Reception show each student's company in the brand colour.
- **Checking in is Reception's too** (2026-10-20). The Floor gives an
  organizer no Arrived button on a scheduled student and no way back from
  checked in to scheduled; `stageAction` refuses both for anyone but a
  manager (`check_in_at_reception`). An organizer starts from In interview.
- **Organizers keep their Finished button.** The Floor marks a finished
  interview with no feedback as **No feedback yet** (`withFeedbackFlags`
  in `queries.ts`), so the club can chase the company.
- **A switch.** Settings → Feedback → *Who finishes an interview*
  (`company_finishes`, `src/lib/interviews/companyFinish.ts`). On unless
  set to off; off puts the page back to feedback only, saved through
  `submit_feedback`, with organizers marking interviews done.
- **The PIN now guards the action too.** The page was behind the PIN, but
  `feedbackAction` only checked the link, so anyone holding a link could post
  feedback without the PIN. It now checks the PIN cookie first.
- **Applying 0015.** **Applied to the live project on 2026-10-15** through the SQL editor, so `schema_migrations` does not record it and the next `db:push` runs it again, which is harmless. The person who applied 0005–0014 applies it the same
  way (`npm run db:push -- --target interviews`, or paste it into the SQL
  editor; it can run twice), then `npm run db:interviews`, which now has
  three finish checks. Until then the action falls back to the two old
  calls in a row (`submit_feedback`, then `advance_stage` to done as the
  company), with the empty-form check done in TypeScript. Checked before
  merging on a local Postgres 16 with 0001–0015 applied: 18 checks (every
  refusal, each starting stage, editing after finishing, the audit log
  naming the company, immediate release queuing the email, an organizer
  undoing a finish).

## Walk-ins (0016, 2026-10-14)

A student who turns up on the day without an interview registers through the
walk-in link, and the reception desk gives them a time. Stacked on the
Reception tab (0069).

- **The link.** Settings → Walk-ins: open or closed, which companies take
  walk-ins (all ticked by default), the link with its QR code (download the
  PNG and print it for the venue), and *New link*, which makes every printed
  code stop working at once. Kept in the edition's settings: `walkins_open`,
  `walkin_token`, `walkins_off_companies` (`src/lib/interviews/walkins.ts`).
  Opening walk-ins the first time makes the token.
- **The form** (`/interviews/w/<token>`): the apply form's questions (the
  same `apply_fields`), the CV, and ONE company, picked on the company cards.
  Only today's companies are shown, and only one with a free time later
  today can be picked; the others are greyed out. "Free" is the database's
  `walkin_slots(edition)`: today on the edition's clock, not over (since
  0020; 0016 said "not started", so a no-show's time, freed only once it
  had started, could never go to a walk-in), not closed, not held, of a
  visible company that takes walk-ins. Sending it
  uploads the CV and calls `submit_walkin`, which checks all of that again,
  refuses a second waiting request for the same email (`walkin_pending`)
  and an email that already has an interview with that company
  (`walkin_already_booked`), and queues a row in `walkin_requests`. The
  student lands on `/interviews/walkin/<request token>`: their number to
  show at the desk, refreshing every ten seconds until reception answers,
  then the company, room and time, or the reason given.
- **The desk.** The Reception tab shows the waiting requests above the
  check-in board (while walk-ins are open or any request exists): number,
  name, phone, email, the company, and what the student already has by the
  same email (the companies they chose online with HR's decision, and any
  interviews). *Confirm and check in* takes one of the company's free times
  today: `confirm_walkin` does it all in one transaction: the student's
  own application (or a phone-only one from HR's list, matched by phone, or
  a new one); nothing on file is overwritten, only blanks are filled; an
  acceptance for the company (note "Walk-in"), overriding an online
  rejection, as the club decided; the booking; and checked in. It refuses a
  time that has started (`slot_past`), is closed, is taken (`slot_taken`),
  overlaps the student's other interview, or is another company's or day's.
  *Turn down* takes an optional reason the student sees. Today's answered
  requests are listed underneath with *Undo* (`reopen_walkin`): the booking
  is cancelled (never deleted) unless the interview has started, and the
  request waits again.
- **Not done.** No acceptance email is queued for a walk-in (they are at the
  desk); the booking confirmation is, as for any booking. A turned-down
  request keeps its CV in the bucket, like every other CV. The link is the
  only gate, so a link that leaks off-site should be replaced with *New
  link*.
- **Applying 0016.** **Applied to the live project on 2026-10-15** through the SQL editor, so `schema_migrations` does not record it and the next `db:push` runs it again, which is harmless. After 0015, the same way (`npm run db:push -- --target
  interviews`, or the SQL editor; it can run twice), then `npm run
  db:interviews`, which now has seven walk-in checks on an edition of its own.
  Until it is applied, the Reception tab shows no walk-in queue and the
  form says walk-ins are not available. 0016 also redefines
  `edition_snapshot` so the club's export carries `walkin_requests` and
  0014's `session_acceptances`, which it had been missing. Checked before
  merging on a local Postgres 16 with 0001–0016 applied: 49 checks (every
  refusal of the form and the desk, a new student, an online applicant HR
  had rejected, a phone-only applicant, undo and confirm again, the
  export), and the suite's own walk-in checks.

## Things easy to break

- **Every shareable link starts with `siteUrl()`** (`src/lib/interviews/email.ts`):
  `SITE_URL` if set, else Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`, else
  `https://vision2030club-system.vercel.app`. Until 2026-10-02 the fallback
  read `vision2030-club-system` (a hyphen too many) and `SITE_URL` was never
  set, so the apply, interviewer, room and TV links and the links in emails
  all pointed at an address that does not exist. If the club moves to its own
  domain, set `SITE_URL` in Vercel.
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
  directory, not local headers — see "Reading .xlsx without a dependency" in `docs/data-and-testing.md`).
  The two older scripts still carry their own copy; they were left alone.
