---
paths:
  - "src/lib/interviews/**"
  - "src/lib/google/**"
  - "src/app/**/interviews/**"
  - "supabase/interviews/**"
---

# Mock Interviews (افترض)

Read the "Mock Interviews component" section of `HANDOFF.md` first. In
short:

- The interviews database is server-only. Pages and server actions use
  `createInterviewsClient()` (service role) and call SQL functions with the
  actor from `getInterviewAccess()`. The club database decides who may
  enter and as what; the interviews database never checks identity.
- Tokens (personal, interviewer, candidate, TV) are generated in the app
  with `newToken()` and passed into SQL functions; the database never
  generates them.
- Two flows exist side by side and both must keep working until the club
  decides: the apply form → HR selection → personal link by email, and the
  room link → phone number → HR's accepted list. Do not remove either. A
  third way in, walk-ins (0016: the walk-in link → the reception desk
  confirms a free time today), must keep working too. Visitor feedback
  (0018, `/interviews/visit/<slug>`) is answered only by the phone of a
  student who checked in.
- A phone number is compared normalised (`app.normalise_phone` in SQL,
  `normalisePhone` in the app); never compare raw strings. The candidate
  link finds a student by phone alone, including one who applied with an
  email (the club's decision, 2026-10-09). Identity by phone is weak, so it
  never overwrites a name or email on file (only fills them while blank).
  The CV is the exception (2026-10-16): required on the candidate link and
  always replacing the one on file, with the old file kept in storage.
- Nothing is ever hard-deleted: rooms, companies and bookings are hidden or
  cancelled with a flag, and every change is logged with who made it.
- Anything written to the floor Google Sheet or a public page carries
  personal data. The sheet is shared by name only; never grant "anyone with
  the link". Signed CV URLs are short-lived; the sheets link CVs through
  `/api/interviews/cv`, which checks who is asking each time.
- Fire-and-forget work (emails, sheet sync) goes through `after()` and must
  never fail the action that triggered it.
- Booking rules (one slot per person, no double booking, the edition's
  window, the cutoff) and slot rules (20-minute slots, prayer breaks) live
  in SQL, not in the page. Do not re-implement or bypass them in
  TypeScript; `slotRules.ts` only mirrors the slot rules for display. A
  past time can be booked on purpose (0012).
- Who moves a booking's stage is decided per role (the club's decisions of
  2026-10-14, 2026-10-19): reception checks in and marks no-shows, and
  undoes either (`checkInAction`); booking and rescheduling by hand is for
  managers and HR's Directors only (`canSchedule`);
  an organizer only in a room they run, or one nobody runs
  (`room_organizers`, enforced in `stageAction`); a company only to done,
  and only by saving its feedback (`finish_interview`, 0015); managers
  anywhere. The Google Sheets' Status column is read-only unless
  `sheet_status_edits` is on. Do not add another path that moves a stage
  around these. Organizers do not mark or clear no-shows (`stageAction`
  refuses it; managers still may). A no-show's booking is cancelled from
  Reception (`removeNoShowAction`); that frees the slot and moves no stage.
