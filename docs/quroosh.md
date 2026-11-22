# The Quroosh component (قروش)

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

Quroosh is the club's Shark Tank–style project (renamed from "Shark Tank" in
club migration `0073`). Since `0074` it is a **project component** of its
own, like Mock Interviews and Outreach: a project carries it, and its pages
wear the Quroosh identity instead of the club's.

**State:** the overview page, the identity, the access rule (`0074`),
**applying** (below), stored in the Quroosh database, the managers
**editing the questions** (Quroosh `0004`), and **guest invitations**
(Quroosh `0005`: slots, inviting guests with a link and QR code, the guests'
own booking page, and the managers moving or cancelling bookings), and
**guest accounts** (Quroosh `0006`, written 2026-11-19, **not yet applied**:
an account for everyone checked in at the gate, completed from an emailed
link, with no password). Further screens become pages under
`projects/[id]/quroosh/` and items in the Quroosh sidebar.

## Two databases

Like Mock Interviews, Quroosh has **its own Supabase project**. The club
database keeps only the link (the project carries the `quroosh` component)
and the answer to *who may open it, and as what*. Everything Quroosh records
(so far, the applications) is in the Quroosh database:

- Migrations: `supabase/quroosh/migrations/`, applied with
  `npm run db:push:quroosh` (needs `QUROOSH_SUPABASE_DB_URL` in `.env.local`,
  the Quroosh project's Session pooler URI), or pasted into that project's
  SQL editor, adding the `schema_migrations` row by hand.
- Client: `src/lib/supabase/quroosh.ts`, server only, with
  `QUROOSH_SUPABASE_URL` and `QUROOSH_SUPABASE_SECRET_KEY`. The project's
  publishable key and JWKS URL are not used: nothing signs in to it.
- Row Level Security is on with **no policies**, and its functions are
  executable by the secret key only, so a leaked publishable key reads and
  writes nothing.
- Its rows point at club projects by id (`settings.project_id` is the club's
  `projects.id`); there is no foreign key across the two databases.

## How it is wired

| Piece | Where |
|---|---|
| Allowed key `quroosh`, who may open it | `supabase/migrations/0074_quroosh_component.sql` |
| Reading that answer in the app | `src/lib/quroosh/access.ts` (`getQurooshAccess`, `can`) |
| Attaching it to a project | `attachComponentAction` in `projects/actions.ts`; the project page's component form lists it |
| The project opening into it | `OPENS_IN` in `projects/[id]/page.tsx`: **last**, after Mock Interviews and Outreach, so it does not take members away from Outreach while it is a skeleton. Move it first when its screens are the project's main work. |
| Its own world (header logo, sidebar) | the Quroosh loop in `(app)/layout.tsx`; `AppShell` reads `base` and `theme` from each shell |
| Its colours | `html[data-theme="quroosh"]` in `src/app/globals.css`; set before first paint by the inline script in `[locale]/layout.tsx` |
| Pages | `src/app/[locale]/(app)/projects/[id]/quroosh/` |
| Text | the `quroosh` namespace in `messages/en.json` and `messages/ar.json` |

Who gets in, until the club decides its own roles (the Outreach rule):
**manager** (`projects.manage` over the project), **member** (on the
project), **viewer** (may see the project's KPI). Anyone else gets a 404.

## Applying

Founders apply on a **public page**, without an account:
`/<locale>/quroosh/apply/<project id>`. Managers open and close it, set the
privacy-notice link, and read the applications on the component's
**Applications** page (`projects/[id]/quroosh/applications`).

- **The questions** are the club's "أسئلة التسجيل في قروش 2026" with the
  changes asked for on 2026-11-07: filming consent is required (an answer,
  yes or no), the team's work experience is asked (optional), "describe the
  startup in one sentence" became *what problem are you solving* and *your
  elevator pitch in under 100 seconds* (written, about 250 words), and
  *market research, user testing or pilots to date* is asked (required; "none
  yet" is an answer).
  Since Quroosh `0002` (2026-11-08) it also asks *how many of the team will
  attend, the lead founder included*: 1 to 11, and no more than the founder
  plus the members named. Applications sent before `0002` have it empty.
- **The form's own questions are in one list:** `src/lib/quroosh/questions.ts`.
  Since Quroosh `0004` a project's managers edit them and add their own (see
  "Editing the questions" below); the form, the server action, the
  managers' view and the sheet all read the merged list (`loadForm`). To add
  a question *to every project's form in code*: a column in a new Quroosh
  migration, an entry in `SECTIONS`, and its wording under `quroosh.apply` in
  both catalogs. A one-project question is added on the Questions page
  instead, with no code.
- **A project's form exists once a manager saves its settings** on the
  Applications page (the first "Open applications" does it). Until then the
  public link says the form does not exist.
- **Validation is split since `0004`.** The server action checks the answers
  against the project's questions (which are shown, which are required,
  which choices are offered, how many may be ticked), because those now
  depend on the managers' edits. The Quroosh database's `apply()`, called by
  the server with the secret key, checks the form is open, the shapes
  (phones, emails, lengths, one application per phone, the team and the
  attendees cap) and inserts the application and its team in one
  transaction. A refusal comes back with a hint the page translates
  (`already_applied`, `applications_closed`, `invalid`, …). The page checks
  phones and the multi-choice questions first only so it can say which
  field is wrong.
- **One application per founder phone per project.** A second one is
  refused; there is no editing by the applicant yet.
- **Personal data.** Applications (names, phones, emails, ages, the team's
  contacts) are readable by the project's **managers only**, not by members
  or KPI viewers. Nobody can write them directly; there is no delete.
- **The public path.** `/quroosh` is in the proxy's `PUBLIC_PATHS`, and the
  root layout's inline script paints `/quroosh/...` in the Quroosh palette.
  The page's frame is `src/app/[locale]/(quroosh-public)/layout.tsx`.
- **Bots.** The form has the same hidden "website" field as the Mock
  Interviews form; filled in, the action pretends to succeed and stores
  nothing. There is no rate limit beyond one application per phone.

## Editing the questions (Quroosh 0004)

The project's managers edit the application on the **Questions** page,
opened from the Applications page (`projects/[id]/quroosh/applications/questions`).

- **What can be changed:** add a question (short or long answer, number,
  email, mobile, link, one choice, one choice from a drop-down, several
  choices, yes or no, tick to agree), and for every question its wording in
  Arabic and English, its help line (for a tick-to-agree question, the
  statement ticked), whether it is required, its choices (wording, add one,
  hide one), the most choices for a several-choices question, the range of
  an added number question, its section and its place in the section.
- **Nothing is removed.** There is no delete for a question or a choice, on
  purpose: they are **hidden**, so every past answer keeps its question and
  its label. A hidden question is off the public form but still shows on the
  Applications page wherever it was answered, and keeps its column in the
  sheet. Hide and show are one press.
- **Always asked:** the lead founder's name, email and mobile number (the
  phone is how one application per founder is kept) and the data consent
  cannot be hidden or made optional (`LOCKED_KEYS` in `form.ts`).
- **The kind of answer is fixed** once a question exists (its past answers
  are of that kind). To change it, hide the question and add a new one.
- **Edits change past applications.** Answers are stored by question key and
  choice value, never by wording, so a reworded question or choice reads the
  new way on every past application, and after every edit the Google Sheet
  is rewritten from the database in the new wording
  (`kickApplicationSheetSync`, only when the project already has a sheet).
- **How it is stored.** The Quroosh database's `questions` table holds one row
  per question a manager touched. A row whose `key` is one of the form's own
  columns changes that question (an empty wording means "the catalog's
  text", so the catalogs still drive the untouched parts); any other row is
  an added question (`c_…`), whose answers go into `applications.answers`
  (jsonb, by key). Choices a manager adds get values `o_…`. `buildForm` in
  `src/lib/quroosh/form.ts` merges the rows over `SECTIONS`; `loadForm` reads
  them; `save_questions()` writes them, recording who.
- **Before 0004 is applied** the page says the migration is needed, shows the
  form read-only, and applying keeps working with the usual questions.

## The applications Google Sheet (Quroosh 0003)

Every application is also copied, as a row, to one Google Sheet per project:
`src/lib/quroosh/applicationSheet.ts`, modelled on Mock Interviews'
registrations sheet.

- **Made by the app**, in the Google account connected under Admin → Google,
  on the first application or the first *Sync now* on the Applications page.
  The `drive.file` scope only lets the app write files it made itself, so a
  sheet made by hand cannot be used. Its id and link are kept in the Quroosh
  database's `settings` (`sheet_id`, `sheet_url`, saved by `save_sheet()`),
  and the link is shown on the Applications page.
- **Each submission appends one row**, after the founder has been answered
  (`kickApplicationAppend`); Google being down or not connected never fails
  an application. **Sync now** rewrites the whole sheet from the database,
  oldest first, and makes a new sheet if the old one was deleted in Drive.
- **The columns follow the project's questions** (`loadForm`), hidden ones
  included, in the form's order. Headers and choices are the English
  wording, a manager's if they wrote one; the other team members sit in one
  cell after the team question. After a question is edited the whole sheet
  is rewritten, so the columns and past rows follow the edit.
- **Personal data.** Link sharing is switched off on every rebuild. The
  account's owner shares the sheet with named people only.
- Before 0003 is applied the page shows no sheet, *Sync now* says 0003 is
  needed, and applying still works (no row is written, and no sheet is made).

## Guest invitations (Quroosh 0005)

The project's managers invite guests (speakers, for now) to the Quroosh
event, and each guest books **one day** on a personal link,
without an account. It is separate from the founders' applications: its
tables have no link to `settings`, so offering slots never makes an
application form exist.

**Built so far:** migration `0005` (both tables and every function the
feature needs), the types (`QurooshGuestSlot`, `QurooshGuestInvitation` in
`src/lib/quroosh/types.ts`), the loaders in `src/lib/quroosh/guests.ts`, the
**Guests** sidebar item (managers only), the **slots page**
(`projects/[id]/quroosh/guests/slots`), the **guests list**
(`guests/`: each guest's name and status, a booked guest's day, phone and
whether they need transport, and "New invitation": a name and an optional
note), **one guest's page** (`guests/[guestId]`: the link to copy, its QR
code, the booking and the phones, moving or cancelling the booking,
cancelling the invitation), and the guest's **booking page**
(`(quroosh-invite)/quroosh/invite/[token]`, public through `/quroosh` in the
proxy).

- **Inviting.** `createInvitationAction` makes the token (`newToken`, 48 hex
  characters), calls `create_invitation` with the manager as `p_actor`, and
  opens the guest's page. No role is sent: the column's default is
  `speaker`. The managers' actions share `src/lib/quroosh/guestActions.ts`
  (`managerContext` checks `getQurooshAccess` / `can.manage` first; `finish`
  translates the database's hint from `quroosh.guests.errors`).
- **The link and its QR code.** `invitationUrl` is
  `siteUrl()/<the manager's language>/quroosh/invite/<token>`; the page has a
  language switch. It is shown in the interviews' `CopyField` (a secret link
  is shown to copy, never linked), with `qrDataUrls` from `src/lib/links.ts`:
  the SVG on the page, the PNG to download. Both are hidden once the
  invitation is cancelled. **`siteUrl()` is the production address even on
  a Vercel preview**, so a link copied from a preview opens on the live site.
- **Cancelling** (`cancel_invitation`, behind a confirmation) cannot be
  undone: there is no un-cancel. It frees any slot the guest booked.
- **The booking page** (`/quroosh/invite/<token>`, no account, not indexed
  by search engines). It reads `invitation()` and `open_slots()` only, so it
  never shows another guest or anyone's phone. An unknown link says it is
  not valid; a cancelled invitation says so; a booked guest sees their day
  and no form. Otherwise: the free days, the guest's mobile
  with a country picker, and a statement that a Genesis car from the
  partner Alwaalan takes them to the venue (`quroosh.invite.transport`).
  There is no transport question: every booking is saved with
  `needs_transport = true` and the guest's mobile as the contact number,
  so the managers' pages show "Needs transport" for every booked guest.
  Bookings made before this change keep the guest's own answer. `BookingForm` copies `ApplyForm`: the
  hidden `website` field for bots, submitting from `onSubmit` so a refusal
  keeps what was typed, and the hints translated from
  `quroosh.invite.errors` (through `fromPostgrest`). On `slot_taken` or
  `slot_unavailable` it says "pick another" and reloads the free days, so
  the taken one drops out. What shows before booking only (the intro, the
  mint box, the info row with the days on offer) is
  built by the page and handed to `BookingForm` as `lead`; on success the
  form drops it and shows the info row with the booked day and the
  confirmation, then reloads the page from the server. So right after
  booking the page is exactly what a later visit shows. Put anything new
  that is "before booking only" in `lead`, not straight in the page.
- **A formal invitation, not a form.** The guests are senior figures, so the
  page follows the printed speaker card and is worded formally in both
  languages ("نرجو"، "يسعدنا"، "نتشرف بحضوركم"; no exclamation marks). It has
  **its own route group and frame**, `(quroosh-invite)`, apart from the
  application form's `(quroosh-public)`: the whole page is the Quroosh deep
  navy-purple, full width, with the card's large curve behind the content
  (`QurooshFin` much enlarged, in a faint purple, clipped), a small language
  switch, and the tagline "قروش | حيث تلتقي الخبرات بآفاق المستقبل" in bold
  mint above the waves at the bottom. One centred column, in the card's
  order, from `InvitationCard.tsx`: `InviteHero` (the logo, the invitation
  line in bold lavender, "مرحباً بك", the title small and light with a
  slash, the name very large in mint), `IntroText`, `Highlight` (the card's
  mint box, bold navy; also the booked day in `BookedNotice`), `InfoRow` (the
  span of days on offer, `slotDayRange`, and الرياض, thin lines above, below
  and between), then `Panel`s like the card's boxes (thin lavender border,
  translucent lighter fill, a mint fin before a bold mint heading, small
  light text): the form's own. The mint box is compact, as wide as its
  text and centred (15px on a phone, so the Arabic line stays on one line).
  **No white card**, and
  **nothing about the session** (topic, length): it differs per speaker.
  The invitation line is "كمتحدثة" when the saved name starts with سعادة
  الأستاذة or سعادة الدكتورة (the Arabic titles only), "كمتحدث" otherwise;
  English has one line. The Arabic face's heaviest cut is bold (700), so
  nothing asks for more (the browser would fake it). The form's fields,
  options, radios and button are drawn for the dark in `BookingForm` itself
  (`FIELD`, `OPTION`, `RADIO`, a mint button), not with the app's
  `Input`/`Select`/`Button`, which are for light pages and stay unchanged.
  Chosen options are mint with navy text. The name is the
  one the manager saved, **never shortened**: when it starts with one of the
  form's titles (`splitTitle`, both languages, longest first) the title is
  shown small above it; otherwise the whole name is shown large. A custom
  title ("أخرى") cannot be told from the name, so it stays in the large
  line. The **title** is picked on the New invitation form, before the
  name (`TitleField`): سعادة الأستاذ، سعادة الأستاذة، سعادة الدكتور، سعادة
  الدكتورة، معالي، أخرى (a small field for the manager's own, optional: left
  empty, the name is saved with no title, as with بدون لقب) or بدون لقب.
  There is no title column: `createInvitationAction` puts the title in front
  of the name with a space and saves that as the name. The list is
  `src/lib/quroosh/guestTitles.ts`; the words are in
  `quroosh.guests.new.titles` (`option` for the dropdown, `text` for what is
  written), in the language of the form, so an English form writes "Mr.",
  "Ms.", "Dr.", "H.E.". A name saved earlier keeps whatever title was typed
  into it (and is split off too, if it is one of the listed titles). Keep
  the tone when adding text to `quroosh.invite`; the greeting ("مرحباً بك")
  and the transport statement keep the club's exact wording.
- **The country picker** (`src/lib/quroosh/phones.ts`): a list of ISO codes
  and calling codes, Saudi Arabia first, with country names from
  `Intl.DisplayNames` in the page's language (no translations to keep).
  `internationalPhone` builds E.164 from the code picked and the number
  typed (Arabic digits read, the home 0 dropped except for Italy; a number
  typed in full with `+` or `00` is taken as it is). Saudi numbers get one
  more rule: exactly nine digits after `+966`, and `966501234567` typed
  without the `+` is read as the full number, not as `+966966…` (which the
  database's E.164 CHECK would accept). The form checks it to
  name the field, the action decides, and the database's CHECK has the last
  word. To add a country, add its pair to `COUNTRIES`.
- **Managers' forms.** Their Arabic addresses the manager in the singular
  masculine ("اختر"، "ألغِ"، "اتركه"); the guest's booking page stays formal
  plural. Required fields use `RequiredInput`/`RequiredSelect`
  (`guests/RequiredField.tsx`), which replace the browser's own "Please
  select an item in the list." with `quroosh.guests.required.*` in the
  page's language. A new required field there should use them too.
- **Managers and bookings.** The guest's page shows the booked day,
  when the guest booked, their mobile, transport and the contact number
  (the phones stay after a booking is cancelled). **Move** offers the free
  days (on, not yet begun, nobody's; `move_booking`, `slot_taken` if someone
  takes it first). **Cancel the booking** (`cancel_booking`) frees the day
  and the guest's link offers the free days again; the invitation stays.

- **Slots are days** (`guest_slots`), with no migration: the table still has
  `starts_at`, and the app saves a day as **that day at 00:00 Riyadh time**
  through the existing `save_slot` (`clubTimestamp(day, '00:00')`). Managers
  add a date only (the browser's own date input); every page shows **the
  day only, never a time** (`slotDay`: the full day name and date, no year,
  Latin digits, as on the printed cards: "الأحد 22 نوفمبر"). `active` turns a
  day on or off. **Never deleted, only turned off.** A booked day cannot be
  turned off or changed (`slot_booked`): the booking is cancelled or moved
  first. The same day twice is the same `starts_at`, refused by the unique
  constraint (`slot_exists`).
- **Offered until the day before.** `open_slots` and `book_slot` take a
  slot only while `starts_at` is ahead, and a day's `starts_at` is its
  midnight, so a day stops being offered as it begins. The slots page marks
  it "closed to booking". A slot saved before days (with a real time, say
  14:00) would still be offered on its own day until that hour, and would
  show as a second entry for its day: turn such slots off and add the day.
  The managers' history ("Invited on", "Booked on", "Cancelled on") keeps
  its times.
- **Invitations** (`guest_invitations`): one per guest, holding the booking
  too (the slot, the guest's phone, transport, the contact number for
  coordination). The link's `token` is the only key to it, made by the
  app (`newToken`). `role` is `speaker` only, by a CHECK, so another role is a
  new migration and its wording in both catalogs. The status is **not
  stored**: `cancelled_at` set is cancelled, `slot_id` set is booked,
  otherwise invited (`invitationStatus`).
- **One guest per day** is the database's: a unique index on
  `guest_invitations.slot_id`. Two guests choosing the same day race on it
  and the second is refused with `slot_taken`. `book_slot` checks the slot is
  on, in the project and not yet started under a shared lock, so a manager
  cannot turn it off in between.
- **Only managers change a booking.** A guest books once (`already_booked`
  after that); `move_booking` and `cancel_booking` are the managers'.
  Cancelling a booking frees the slot and the guest's link offers slots
  again; cancelling the invitation frees it too and the link says so. The
  guest's phones stay on the row either way.
- **Phones are international** (E.164, `+` and the country code), not the
  Saudi-only shape of the application form. Mock Interviews has no country
  picker to reuse; the booking page will bring one.
- **Riyadh's calendar, always.** Guests may open their link from abroad. A
  day is written with the zone name in the literal (`clubTimestamp`) and read
  back on `CLUB_TIME_ZONE` (`slotDay`, `toDateInput`), never the browser's
  zone, so a guest in London sees the same day as a manager in Riyadh. The
  pages do not name the time zone (the club's decision).
- **Personal data.** Guests' names, phones and bookings are for the project's
  **managers only**; the public functions (`invitation`, `open_slots`)
  return the guest's own name and booking and the free days, never a phone
  or the managers' note.
- **Before 0005 is applied** the slots page says the migration is needed,
  and nothing else changes.

## Guest accounts (Quroosh 0006)

A **guest** here is a member of the public who came to the event: they
signed up in the Event attendance component
([`docs/event-attendance.md`](event-attendance.md)) and were checked in at
the gate. They are not the invited speakers of `0005` (the Guests tab), and
they are not club members: nothing here touches the club's login, which
forbids self-registration.

The first time a person is checked in, Quroosh makes them an account and
emails them **"complete creating your account"**. They open the link, press
one button, and the account is theirs. It is what the Quroosh market (their
quroosh, the challenges, the votes) will hang on. The project must carry
**both** components, Quroosh and Event attendance.

- **From a check-in to an account.** `syncGuestAccounts`
  (`src/lib/quroosh/accountSync.ts`) is the one path between the two
  databases. It reads the check-ins changed since last time through Event
  attendance's API, fetches those attendees by id (club `0076`), reads the
  attendees changed since last time (cancelled passes, corrections), and
  hands all of it to `sync_accounts` in one transaction. It runs right after
  a check-in at the gate (`kickGuestAccountSync`, called from the scanner's
  action, after its answer is sent) and again on the club's five-minute
  sweep (`/api/push/cron`), which is what catches up after a failure. The
  managers' **Read the check-ins now** button runs the same pass.
- **One account and one email per attendee**, whatever runs twice: the
  unique constraint `accounts_attendee_once` is the claim, and the email is
  queued only by the insert that won. A person **without an email** on their
  pass gets no account: there is nowhere to send their link.
- **No passwords** (the club's decision, 2026-11-19, and the Quroosh design).
  A person gets in with a one-time link in their email:
  `complete`, sent once on their first check-in and good for **seven days**;
  `signin`, sent when they ask on the sign-in page and good for **fifteen
  minutes**. Completing asks for nothing beyond one press (the club's
  decision): the name, email and mobile shown are the ones on their pass.
- **Opening a link does not use it.** `/quroosh/account/link/<token>` shows
  whose account it is and one button; the button's server action
  (`redeemLinkAction` → `use_account_link`) uses the link up, completes the
  account if it was not, and starts a session. So a mail scanner that
  fetches the link does not spend it.
- **Sessions.** A cookie, `quroosh_guest` (HttpOnly, thirty days), set by
  this server. `getGuestAccount()` in `src/lib/quroosh/accounts.ts` answers
  who is signed in on this device; **every later guest page (the market)
  starts by asking it**, and must compare the account's `project_id` with
  the page's.
- **Only hashes are stored.** A link's token and a cookie's value are made
  by the app (`newToken`) and the database keeps their SHA-256
  (`hashToken`). The email queue holds no token either: the link is made at
  the moment of sending (`issue_account_token`). Somebody who read the
  database could not sign in as anyone.
- **The guest's page**, `/quroosh/account/<project id>`: signed in, their
  wallet (see "The wallet" below); not signed in, one field for their email. It answers the same
  whether or not the email has an account. Two attendees who share an email
  each get a link, and each link names its person.
- **A cancelled pass disables the account** on the next sync: its sessions
  end and its links are refused. Restoring the pass enables it again. A
  corrected name or mobile is copied over; the email is copied only while
  the account is not completed (after that it is how they sign in).
- **Managers** (`projects/[id]/quroosh/accounts`, managers only): how many
  accounts, how many completed, how many emails are still waiting; each
  account's state; sending an account its link again (the "complete" email,
  or a sign-in link once it is completed); and the guests' sign-in page to
  hand to someone who lost their email.
- **Email** goes through Resend (`src/lib/email/resend.ts`, the shared
  sender new code should use). Without `RESEND_API_KEY` and `EMAIL_FROM`
  the emails wait in `account_emails` and the page says so; the accounts are
  still made.
- **Before `0006` (or club `0076`) is applied** the Accounts page says the
  migration is needed, the sync fails quietly in the background, the guest
  pages find no link and no session, and checking in at the gate is not
  affected.

## The wallet (Quroosh 0007)

The first part of the **Quroosh market**: guests collect quroosh during the
event and see their balance and a leaderboard. Built 2026-11-19. Still to
come, on the same ledger: voting for the projects on the last day. The
booths' challenges are below.

- **The ledger.** `wallet_entries` holds one row per thing that moved
  quroosh for an account: `kind` (`attendance` today; `challenge`, `vote`
  and `adjustment` are named so the table does not change shape later),
  a signed `amount`, the event `day`, and `source_ref` (what it came from).
  Nothing is deleted or edited: an entry taken back is **voided**
  (`voided_at`) and counts for nothing.
- **Two numbers, different on purpose.** `balance` is everything standing,
  plus and minus: what a guest can spend. `earned` is the plus entries only:
  what a guest is **ranked** by, so that voting later never costs anyone
  their place (the Quroosh design).
- **Attendance pays the first visit only** (Quroosh `0010`, the club's
  decision of 2026-11-21; until then, once a day). `syncWallet` (`src/lib/quroosh/wallet.ts`)
  reads Event attendance's check-ins with a cursor of its own
  (`wallet_sync`) and hands them to `sync_wallet`: a guest's first standing
  check-in pays their account, later days pay nothing, and an undone one has
  its entry voided (the guest's next standing check-in is then their first
  visit and is paid). It runs right after the accounts sync (after each check-in and on
  the five-minute sweep, `payAttendance` in `accountSync.ts`), so a guest
  sees their quroosh within moments, or within five minutes at worst.
  `wallet_entries_source_once` stops a check-in being paid twice. "First
  visit only" is not an index, because guests paid for several days before
  `0010` keep those entries: `sync_wallet` locks the account's row, then
  pays only if it has no standing attendance entry, so two passes at once
  cannot both pay. It takes the check-ins oldest day first.
- **The amount** is `wallet_settings.attendance_points` (the name is from
  `0007`; it now means the first visit), 5,000 until a manager changes it on
  the Wallet page. Managers and guests see it as the **sign-up bonus**
  (قروش التسجيل / مكافأة التسجيل), and attendance entries on the ledger are
  labelled that way. It cannot be paid at the sign-up form itself: the
  account, and so the wallet, only exists from the first gate check-in. A change applies from then on; entries already paid keep
  their amount. 0 stops paying for attendance. **Applying `0010` mid-event
  takes nothing back**: a guest already paid for two days keeps both.
- **Who earns.** An account, so a person **without an email** on their pass
  earns nothing (they have no account, see above). A check-in made before
  the account existed is paid on the pass that makes the account. A disabled
  account (pass cancelled) keeps its entries but leaves the leaderboard.
- **The guest's pages** (signed in, `getGuestAccount()`):
  `/quroosh/account/<project id>` is the wallet (balance, place, their
  first visit and today's session check-in, a button to their pass, their ledger) and `…/leaderboard` the
  top twenty. Other guests appear as **first name and the first letter of
  the last** (`shortName`); nobody's full name is shown to the public.
- **Managers** (`projects/[id]/quroosh/wallet`, managers only): quroosh
  handed out, how many guests earned, the average, the settings (the first
  visit's quroosh and, once `0009` is applied, a session check-in's), the
  top ten and the latest 200 ledger entries with full names. **Recount from
  the check-ins** reads every check-in again and pays what is missing; use
  it once after applying `0007` mid-event.
- **Before `0007` is applied** the guest's page shows the old "your account
  is ready" card, the leaderboard says it is not open, the managers' page
  says the migration is needed, and accounts and their emails are not
  affected (the wallet pass fails on its own).

## The challenges (Quroosh 0008)

The second part of the Quroosh market: each booth at the event has a short
multiple-choice quiz. A guest scans the booth's QR code, plays once, and is
paid into their wallet for being right and for being quick. Built
2026-11-19.

- **A challenge** (`challenges`) belongs to a booth and has a topic, the
  seconds allowed per question (20), the most it pays (3,000) and optionally
  a **day**. With a day it can be started on that day only; without one, any
  day. The design wants a new quiz per booth per day: the managers make one
  challenge per booth per day. Its `token` (made by the app, `newToken`) is
  what the booth's QR code holds: `/quroosh/challenge/<token>`.
- **One attempt per account per challenge**, ever
  (`challenge_attempts_once`). Starting again returns the same attempt.
- **The database keeps the clock.** An attempt knows which question it is on
  and when that question was shown (`shown_at`). `challenge_answer` measures
  `now() - shown_at` itself; the countdown on the phone is only for show. An
  answer more than a second and a half late counts as no answer. Leaving and
  coming back lands on the same question with its clock still running. An
  answer to a question the attempt is not on (a second press, an old tab)
  changes nothing.
- **The right option never reaches a guest's page.** `challenge_state`
  returns the prompt and the options only; `correct` is read by the
  managers' functions alone.
- **Points.** The design left the formula open. Here each question is worth
  an equal share of the challenge's most; a right answer earns half its
  share for being right and the other half scaled by the time left. So
  everything right and instant pays the most, and a right answer in the last
  second still pays half its share. `app.challenge_advance` computes it when
  the last question is answered and writes one `challenge` entry to the
  wallet's ledger in the same transaction, with the attempt's id as
  `source_ref`. An attempt that scores 0 writes no entry.
- **The guest's pages:** `/quroosh/challenge/<token>` is one page with four
  faces (sign in first, the intro and Start, the question with its
  countdown, the result), chosen by the database each time it is read. The
  question is a client component (`QuestionForm`) that sends itself with no
  choice when its countdown ends. `/quroosh/account/<project id>/challenges`
  lists today's challenges and what the guest got; it has **no start
  button on purpose**: a challenge begins at its booth.
- **Managers** (`projects/[id]/quroosh/challenges`, managers only): the list
  with how many played and the average; a challenge's page with its QR code
  to print, its settings, its questions (add, rewrite, hide; the right
  option marked; how many answered each right) and the best ten scores with
  full names.
- **Changing a challenge while it is being played.** A hidden question is
  skipped by attempts that have not reached it; an added one is asked of
  attempts still open. Each attempt's share per question is the most divided
  by the questions *it* answered. A rewritten question does not re-score
  answers already given.
- **Not built:** the booth's tablet screen ("fastest today"), and a staff
  member starting the challenge for a guest by scanning the guest's code.
- **Before `0008` is applied** the guest's Challenges tab says they are not
  open, a booth's code says it is not valid, the managers' page says the
  migration is needed, and the wallet is not affected.

## The session check-in (Quroosh 0009)

The third way to earn: checking in to the day's **dialogue session**
(جلسة حوارية). Built 2026-11-21.

- **One permanent QR code per project.** It holds
  `/<locale>/quroosh/checkin/<project id>` (`sessionCheckInUrl` in
  `src/lib/quroosh/sessions.ts`) and never expires or changes, so a printed
  copy works for every session. Organizers find it on the **تسجيل حضور
  للجلسة** (Session check-in) tab of the **Event attendance** sidebar
  (`projects/[id]/event-attendance/session`): the code (pressing it opens the
  page too), the link to copy, *Download QR*, and how many checked in and the
  average rating, day by day. Counts only, no names, so the HR team may open
  it as well as the managers. The tab shows only where the project carries
  Quroosh too, and only to someone who may open both (so not to an HR member
  without Quroosh access).
- **The guest's page** (`(quroosh-public)/quroosh/checkin/[projectId]`), three
  faces, decided by the database each time it is read:
  - **not signed in** (no `getGuestAccount()`, or another project's): the
    sign-in form (`SignInForm`, shared with the account page). The emailed
    link brings them **back to the check-in page**, and since 2026-11-22
    the link says so itself: asking from here makes the email's link end in
    `?next=checkin` (`accountLinkUrl`), the link page passes it on, and
    `redeemLinkAction` opens the check-in page of the link's own project, for
    both kinds of link ("complete your account" too). So it works in
    whatever browser opens the email. Before, the page was remembered only in
    a cookie (`quroosh_return`, an hour, HttpOnly), and a guest whose mail
    app opened the link in its own browser (Gmail on an iPhone, say) landed
    on the account page and never saw the stars. The cookie is still read,
    for a link sent without `next`: the queue does not hold where a request
    came from, so only the send right after the request
    (`kickAccountEmails(toCheckIn)`) adds it, and an email the five-minute
    sweep sends instead has the plain link. Only `/quroosh/checkin/<uuid>`
    is accepted from the form (`safeReturnPath`).
  - **A guest signed in in one browser is not signed in in another.** The
    phone's camera may open the QR code in a browser other than the one the
    email's link opened in; they are then asked for their email again, and
    the new link brings them to the stars.
  - **not checked in today:** five stars (radio buttons, so a keyboard and a
    screen reader work) and **تسجيل حضور**, disabled until a star is chosen.
  - **checked in today:** "لقد قمت بتسجيل حضورك لجلسة اليوم بالفعل", their
    stars, and the button disabled until 00:00 Riyadh. Right after checking
    in (`?done=1`) the confirmation and the quroosh added are shown on top.
- **Once a day, on the club's calendar.** `session_check_ins` has one row per
  account per day (`app.quroosh_today()`, Riyadh) with the rating, and the
  unique constraint `session_check_ins_once` is the claim: a second press or
  a second tab is refused with `already_checked_in`. A new day begins at
  00:00 Riyadh with nothing to reset.
- **Paid in the same transaction.** `session_check_in` writes the check-in and
  a `session` entry on the ledger (`source_ref` = the check-in's id), worth
  `wallet_settings.session_points`: **1,000** until a manager changes it on
  the Quroosh **Wallet** page (`wallet_save_session_points`; the session tab
  links there for managers). A change applies from then on; 0 stops paying
  and checking in still works. 0009 adds `session` to the ledger's kinds.
- **Who can check in:** a guest account (0006), so someone checked in at the
  gate with an email on their pass. Being at the gate is not required on the
  day; the session code is enough.
- **With the email alone, no link** (Quroosh `0011`, the club's decision,
  2026-11-22). A guest who is not signed in types the email on their pass
  and goes straight to the stars: nothing is sent. `enterEmailAction` asks
  `session_account_by_email` for the account (not disabled; the older of two
  sharing an email), remembers the email in a cookie (`quroosh_checkin`,
  `<project id>:<email>`, HttpOnly, thirty days) and reloads the page, so the
  next day's scan in the same browser opens the stars at once. "Not you?"
  forgets it. `getCheckInGuest` is who the page and `sessionCheckInAction`
  act for: the signed-in guest if there is one, otherwise the account of the
  remembered email, looked up again on every request.
  - **An email is not proof of who typed it.** Anyone who knows a guest's
    email can rate and check in as them (once a day, and the quroosh go to
    that guest), and the form tells whether an email has an account. The
    club accepted that for the session. So this **never signs a device in**:
    `getCheckInGuest` is for the check-in page only, the wallet and every
    other guest page keep asking `getGuestAccount()` and the emailed link.
    Do not use it anywhere a guest can spend, vote, or read more than a
    first name. The page greets a guest who only typed an email by first
    name.
  - **Before `0011` is applied** the page shows the emailed sign-in link as
    before (`canCheckInByEmail`).
- **Before `0009` is applied** the guest's page says check-in is not open,
  the organizers' tab shows the QR code with a note that the migration is
  needed, and the wallet page leaves the session line out.

## Reception

`projects/[id]/quroosh/reception`, built 2026-11-22: the event's
**attendees** arriving today. It is not about the invited speakers under
Guests (the club's decision, 2026-11-22).

- **Who may open it:** the project's managers and the HR team, the people
  who work the gate. The page asks **Event attendance** who is looking
  (`getEventAttendanceAccess`, `can.scan`), not Quroosh: a Quroosh `member`
  or `viewer` who is neither gets a 404.
- **What it shows:** arrived today, not here yet (registered minus arrived)
  and registered; **the gate scanner itself** (the camera reads a pass, or
  a search by part of a name or the last four digits of a mobile, with
  **Check in** and undo); and today's arrivals, newest first (name, last
  four digits, the time, and "At the desk" for a check-in made by search).
  Never a full mobile or an email. The page reads itself again after every
  change and every 30 seconds while on screen.
- **It stores nothing.** The page renders Event attendance's own `Scanner`
  (`event-attendance/scan/Scanner.tsx`) with `live`, which makes it call
  `router.refresh()` after a check-in or an undo and every half minute, so
  the numbers and the arrivals follow; the camera keeps running through a
  refresh. A change to the scanner is a change to both pages. (Until
  2026-11-22 the page had its own search-only `ReceptionDesk`.)
  Every rule is the gate's: one check-in a day, only on the event's days,
  nobody checks in their own pass (club `0077`), and a new arrival still
  gets their Quroosh account and the wallet's sign-up bonus. No migration.
- **The arrivals list** is read with the service role through
  `listCheckIns` and `getAttendeesById` (club `0076`), after the access
  check, and shows the latest 300. If that read fails the list says so and
  checking in still works.
- **In the sidebar:** under Quroosh for anyone who may open the project's
  Event attendance, and under Event attendance under the same rule as the
  Session check-in tab. An HR member who cannot open Quroosh sees neither
  link; the address still works for them, and so does the gate scanner,
  which has the same search.

## The identity

From the club's identity guide (an Illustrator file; the original stays in
Drive, it is 10 MB).

- **Logo:** `src/components/QurooshLogo.tsx`. The wordmark with its tagline
  كل قرش يصنع قرش (`QurooshLogo`), and the fin alone (`QurooshFin`). The shapes
  were extracted as vectors from the guide; the cleaned sources are in
  `design/quroosh/`. Both draw in `currentColor`, so the colour comes from a
  text utility: `text-accent-2` (mint) on the navy band, `text-brand-950`
  (navy) on light.
- **Colours:** the guide's palette mapped onto the app's tokens. Purple
  `#542F90` is `brand-600`, the lavenders `#CBC1DB` / `#9B91C0` are
  `brand-200` / `brand-400`, `#3E3661` is `brand-800`, `#1B2B50` is
  `brand-900`, the navy `#1E1338` is `brand-950` and the ink. The mints
  `#90D4D6` / `#BEE5EC` are `accent` / `accent-2`, and the teal `#09798B` is
  `accent-3`.
- **Light, not dark.** The guide is laid out on navy, but the app is
  light-only (`color-scheme: light`), and the shared forms and buttons are
  built for light backgrounds. So the navy is used where the identity shows
  (the hero band) and as the text colour, and the page itself is the
  guide's near-white `#F5F8FA`.
- **Font:** Titillium Web (`src/fonts/TitilliumWeb-*.woff2`, SIL Open Font
  Licence). It has no Arabic letters, so Arabic text falls back to IBM Plex
  Sans Arabic. If the club has a specific Arabic face for Quroosh, add it to
  `src/lib/fonts.ts` and to the theme's `font-family`.
- **Waves:** `src/components/QurooshWaves.tsx`, drawn in code so they stretch
  to any width. Their colours are theme tokens, so they only look right
  inside the Quroosh pages.

## Things easy to break

- **Never write to `wallet_entries` by checking first and then inserting.**
  Give the entry a `source_ref` and let `wallet_entries_source_once` refuse
  the second one (`on conflict do nothing`). And never update or delete an
  entry: void it and write a new one.
- Rank guests by `earned`, never by `balance`: a vote lowers the balance and
  must not lower anyone's place.
- A leaderboard shown to guests or on a screen uses `shortName`. Full names
  are for the managers' page only.
- **Never time a challenge answer in the browser**, and never send the right
  option to a guest's page. The database measures from `shown_at` and scores;
  a page that did either would let a guest pick their own score.
- A challenge pays through `app.challenge_advance` only, once, when its last
  question is answered. Do not add a second place that writes `challenge`
  entries. The same for `session` entries: `session_check_in` only.
- Attendance's "first visit only" is a check in `sync_wallet` made safe by
  locking the account row (`for update`) first. Keep the lock if the
  function is changed, or two passes at once can pay two days.
- Never "check whether they checked in today, then insert" for the session:
  the unique constraint `session_check_ins_once` is the claim.
- The return cookie must only ever hold a path `safeReturnPath` accepts. A
  free-form "next" would let anyone's link send a guest to another site.
- A raw colour in a Quroosh page bypasses the theme. Use the tokens above,
  as everywhere else in the app.
- `AppShell` decides the world from `base`. A Quroosh page outside
  `projects/[id]/quroosh/` will not get the Quroosh header or colours.
- Never rename an option value in `questions.ts` or a question's `name`:
  past answers, and the managers' edits in `questions`, are stored under
  them. Since `0004` the database no longer lists the allowed choices (the
  server action checks them against the merged form), so a renamed value
  is not caught by a CHECK; it just stops matching.
- A question a manager can hide must be nullable in `applications`. `0004`
  dropped the NOT NULLs of every question but the four in `LOCKED_KEYS`; a
  new column added later must be nullable too, or hiding it breaks applying.
- The dates in the commitment question's help line (21–26 November) are
  in the catalogs; change them for the next edition.
- A guest day shown with `new Date().toLocale…()` or a formatter without
  `timeZone` follows the viewer's clock: 00:00 Riyadh is still the day before
  in London. Use `slotDay` / `toDateInput` (both on `CLUB_TIME_ZONE`), and
  write days with `clubTimestamp(day, '00:00')`. Never show a slot's time.
- A slot must be saved at 00:00: "offered until the day before" depends on
  it (the database offers a slot while `starts_at` is ahead).
- Never "check the slot is free, then book it" in the app: the unique index
  on `guest_invitations.slot_id` is the claim, and a check first only widens
  the race. Keep that index if the table is ever changed.
- A new column on `guest_invitations` or `guest_slots` must be nullable (or
  have a default): rows already exist without it.
- A guest's link must never be used by a GET. The page only reads it
  (`account_link`); the button's POST uses it. Mail scanners open every link
  in an email, and a link spent by one is a guest who cannot get in.
- Never store or log a link's token or a session cookie's value: only
  `hashToken()` of it goes to the database.
- A guest page that shows anything personal must check
  `getGuestAccount()` **and** that its `project_id` is the page's. The
  cookie is one per browser, not one per project.
- `sync_accounts` must stay safe to run twice with the same rows: the app
  reads two minutes back of its cursor on purpose (a check-in's change time
  is when its transaction began, so a late commit can carry a time the
  cursor has passed).
- A new column on `accounts` must be nullable or have a default: rows
  already exist without it.
- `0074` replaces `my_component_access()` with 0072's version plus two lines.
  A later migration that changes the function must start from 0074's.
