# The Event attendance component (حضور الفعالية)

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

A project that runs an event with the public attaches this component. A
person signs up once and gets a **pass**: a personal link whose QR code is
emailed to them. At the gate the HR team scans the QR code, which is one
check-in for that day. Other components register people and read the
check-ins through an API.

It is **not** the club's Attendance page (`/attendance`, club `0009`): that
is members at the club's activities. This is the public at a project's event.
It was built first for Quroosh (21–26 November 2026) but nothing in it is
Quroosh's: any project can carry it.

**State:** club migration `0075`, written 2026-11-18 and **not yet applied**.
Until it is, the component cannot be attached and its pages say the
migration is needed.

## Where the data lives

In the **club database** (the club's decision, 2026-11-18), not in a
database of its own like Mock Interviews and Quroosh. It is the first time
the public's names, mobiles and emails sit beside the members' data, so:

- Row Level Security is on with **no policies** on all four tables and no
  table grants. Nothing reads or writes them except the `event_*` functions.
- The functions members call (`authenticated`) each ask
  `app.event_attendance_role(project)` who is calling and refuse otherwise.
- The functions the public side needs are granted to the **service role
  only** and are called by this server through `createAdminClient()`
  (`src/lib/supabase/admin.ts`, use 4 in its list).

| Table | Holds |
|---|---|
| `event_attendance_settings` | One row per project: sign-up open or closed, the event's first and last day |
| `event_attendees` | One per mobile per project: name, mobile (E.164), email, language, the pass token, where they came from (`source`, `source_ref`), cancelled flag |
| `event_check_ins` | One per attendee per day, who scanned, `scan` or `manual`, undone flag |
| `event_pass_outbox` | The pass emails waiting to be sent |

Nothing is deleted: an attendee is cancelled, a check-in is undone.

## Who may do what

| Role | Who | What |
|---|---|---|
| `manager` | whoever holds `projects.manage` over the project | everything |
| `scanner` | every active member of the **HR team** (`teams.key = 'HR'`) | the scanner, finding an attendee by name or the end of a mobile, checking in, undoing today's check-in |

The scanners never get a list, an email or a full mobile number: the search
returns a name and the last four digits, twenty rows at most. There is no
roster to maintain; joining or leaving the HR team is the whole of it.
`my_component_access()` (`0075` starts from `0074`'s) answers `scanner`, and
`src/lib/eventAttendance/access.ts` reads it.

## How it is wired

| Piece | Where |
|---|---|
| Tables, access, every function | `supabase/migrations/0075_event_attendance.sql` |
| Reading the role in the app | `src/lib/eventAttendance/access.ts` (`getEventAttendanceAccess`, `can`) |
| Attaching it to a project | `attachComponentAction` in `projects/actions.ts`; the project page's component form lists it |
| The project opening into it | `OPENS_IN` in `projects/[id]/page.tsx`, **last**: a manager lands in the project's main component; the HR team, on no other roster, lands here |
| Its sidebar | the Event attendance loop in `(app)/layout.tsx`. A project that also carries Quroosh gets a link each way, the **Session check-in** tab (the dialogue session's QR code, Quroosh `0009`, see `docs/quroosh.md`), and these pages wear the Quroosh colours |
| Signed-in pages | `src/app/[locale]/(app)/projects/[id]/event-attendance/` (overview, `scan/`, `attendees/`) |
| Public pages | `src/app/[locale]/(event-public)/event/` (`join/[projectId]`, `pass/[token]`); `/event` is in the proxy's `PUBLIC_PATHS` |
| Email | `src/lib/eventAttendance/email.ts` |
| API | `src/lib/eventAttendance/api.ts` and `src/app/api/event-attendance/` |
| Text | the `eventAttendance` namespace in both catalogs |

`AppShell` now tells its worlds apart by `base` (where their pages live),
not by project id, because one project can carry two of them (Quroosh and
Event attendance).

## Signing up

`/<locale>/event/join/<project id>`, no account. The managers' overview page
shows this link and its QR code to print at the gate.

- Name, mobile (with the Quroosh forms' country picker,
  `src/lib/quroosh/phones.ts`) and email. Sign-up must be **open** (the
  managers' setting; closed when the component is attached).
- On success the person's **pass opens at once** and the pass email is
  queued. So signing up works before email is configured.
- **One pass per mobile per event.** A mobile already registered is not
  given its pass on screen (whoever typed the number may not be its owner):
  the pass is emailed again to the address it was registered with, at most
  once in ten minutes, and the form says so.
- The form has the hidden "website" field for bots, as the other public
  forms do. There is no rate limit beyond one pass per mobile.

## The pass

`/<locale>/event/pass/<token>`. The token (48 hex characters, made by the
app with `newToken()`) is the only key. The page shows the name, the QR
code, the event's days and the days already attended; never a mobile or an
email. The QR code holds this page's own address, and it does **not** change:
the club asked for a fixed code sent by email, not one that refreshes.

A manager or HR member who opens a pass while signed in (by reading the QR
code with their phone's ordinary camera) sees a **Check in** button on it.
That is the gate's fallback when the in-app scanner cannot open the camera.

## The gate

`projects/<id>/event-attendance/scan`, for managers and the HR team.

- The camera starts on a press. Codes are read by the browser's own
  `BarcodeDetector` where there is one (Chrome on Android) and by **jsQR**
  elsewhere (Safari on an iPhone has none); jsQR is downloaded only when
  needed.
- Whatever is read goes to the server as it is. `tokenFromScan` takes the
  token out of a pass link from any address (production or a preview, either
  language) or accepts the bare token.
- **One check-in per attendee per day**, on the club's calendar
  (`app.club_today()`, from `booking_settings.time_zone`). The unique index
  `event_check_ins_once` is the claim; a second scan answers "already
  checked in at 16:12".
- When the managers set the event's days, the gate refuses any other day
  (`not_an_event_day`). With no days set, any day counts.
- **Nobody checks themselves in** (club `0077`). An attendee has no access
  to the gate at all; a manager or HR member who is also signed up to the
  event is refused on their own pass (`own_pass`), by scan, by search and
  by the button on the pass page. The pass is theirs when its mobile or
  email is the one on their member record. Someone else at the gate checks
  them in. Until `0077` is applied, staff can still do it.
- The last check-in can be undone from the result box. **Without a pass**:
  search by part of a name or the last four digits, then Check in
  (recorded as `manual`).

## Email

The pass email goes through Resend, as the interviews' emails do
(`RESEND_API_KEY`, `EMAIL_FROM`, a verified sender domain). The message has
the QR code as a picture (served by `/api/event-attendance/qr/<token>`,
because mail apps block inline data URLs), the same code attached as
`pass.png`, and a button to the pass page.

- Signing up queues a row in `event_pass_outbox`; the action sends it after
  its response, and the club's five-minute sweep (`/api/push/cron`) retries
  what remains. `event_claim_passes` leases rows so the two never send the
  same one; five attempts at most.
- **Without the Resend variables nothing is sent and nothing is lost**: the
  rows wait, the overview page says so and shows how many, and they go out
  on the first sweep after email is configured.

## The API: linking other components

Both directions, and two ways to call it.

**Inside this codebase**, import `src/lib/eventAttendance/api.ts`:

- `registerAttendee({ projectId, name, phone, email, source, sourceRef })`
  registers a person (for example an accepted applicant) and queues their
  pass email. A mobile already registered returns that attendee with
  `created: false`, so calling it twice is safe.
- `listAttendees(projectId, since?)` and `listCheckIns(projectId, since?)`
  return what changed after `since`, oldest change first, 5000 at most. Page
  with the last row's `updated_at` / `changed_at`.

- `getAttendeesById(projectId, ids)` (club `0076`) returns the people behind
  a handful of check-ins, without paging through everyone.

These run with the service role and return personal data: the calling page
must decide who is looking first.

**After a check-in.** The scanner's action tells whoever builds on
attendance about a new arrival, once the scanner has its answer
(`checkedIn` in `event-attendance/actions.ts`). Today that is Quroosh, which
makes the guest's account and emails them (`kickGuestAccountSync`,
"Guest accounts" in [`docs/quroosh.md`](quroosh.md)). It runs in `after()`
and never fails the check-in; the five-minute sweep repeats it. A new
component that needs to react to arrivals adds its call there and reads the
check-ins by cursor, as Quroosh does.

**From outside**, the same three over HTTP, with
`Authorization: Bearer $EVENT_ATTENDANCE_API_KEY`. With no key set on the
deployment every call answers 401.

```
POST /api/event-attendance/<project id>/attendees
     { "name": "…", "phone": "05xxxxxxxx", "email": "…",
       "source": "your_component", "source_ref": "your id", "send_pass": true }
  -> 201 { "attendee_id", "token", "pass_url", "created": true }
     200 the same with "created": false for a mobile already registered

GET  /api/event-attendance/<project id>/attendees?since=<ISO time>
GET  /api/event-attendance/<project id>/check-ins?since=<ISO time>
```

A check-in the gate undid comes back with `undone_at` set, so a component
that gave something for it (points for attending, say) can take it back.
`source` must name the caller; `form` is the component's own sign-up page.

## Setup, by a person

1. **Apply club migration `0075`** (`npm run db:push`, or paste it into the
   club project's SQL editor and add the `schema_migrations` row).
2. On the project's page (`?details=1`), attach **Event attendance**.
3. On its overview page, set the event's days and open sign-up.
4. For email: `RESEND_API_KEY` and `EMAIL_FROM` in Vercel, with the sender
   domain verified in Resend, then redeploy.
5. Only if another system will call the HTTP API: `EVENT_ATTENDANCE_API_KEY`
   in Vercel (any long random value), then redeploy.

## Not built yet

- A manager adding an attendee by hand, and exporting the list (CSV).
- Anything the Quroosh design builds on top of attendance: points for
  attending, talk sessions, voting. They read this component through the API.
- A rate limit on the sign-up form.
- A test suite against the real database (`scripts/tests/`). The migration
  was checked on an in-memory Postgres with the club's helpers stubbed.

## Things easy to break

- **Never return the pass token to someone who only typed a mobile.** The
  sign-up form gets a token only for an attendee it has just created.
- **Never check "is there a check-in today?" and then insert.** The unique
  index is the claim; a check first only widens the race between two phones.
- A day is a calendar date made by the database on the club's clock. Format
  it with `eventDay` (which never shifts it), not `new Date(day)` in the
  viewer's zone.
- The pass link starts with `siteUrl()`, the production address even on a
  preview, so a pass made on a preview opens on the live site. The scanner
  reads the token from any address, so scanning still works on a preview.
- `0075` replaces `my_component_access()` with `0074`'s version plus one
  branch. A later migration that changes the function must start from
  `0075`'s.
- `0077` replaces `event_check_in` with `0075`'s plus the own-pass check. A
  later migration that changes the function must start from `0077`'s, or
  staff can check themselves in again.
- A new column on `event_attendees` or `event_check_ins` must be nullable or
  have a default: rows already exist without it.
- The QR code's picture must stay dark on white whatever the theme; the
  `qrcode` library draws it that way, so do not restyle the `<img>`'s
  colours.
