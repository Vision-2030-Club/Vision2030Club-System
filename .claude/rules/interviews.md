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
  room link → phone number → HR's accepted list. Do not remove either.
- A phone number is compared through `app.normalise_phone`; never compare
  raw strings. Identity by phone alone is weak: never let a phone-only
  login overwrite an existing applicant's name, CV, or booking, or reach
  an application that has an email.
- Nothing is ever hard-deleted: rooms, companies and bookings are hidden or
  cancelled with a flag, and every change is logged with who made it.
- Anything written to the floor Google Sheet or a public page carries
  personal data. The sheet is shared by name only; never grant "anyone with
  the link". Signed CV URLs are short-lived except in the sheet.
- Fire-and-forget work (emails, sheet sync) goes through `after()` and must
  never fail the action that triggered it.
- Booking rules (one slot per person, no double booking, the edition's
  window, the cutoff, the past-time rule for active editions) live in SQL,
  not in the page. Do not re-implement or bypass them in TypeScript.
