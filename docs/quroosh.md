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
own booking page, and the managers moving or cancelling bookings). Further screens become pages under
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
- `0074` replaces `my_component_access()` with 0072's version plus two lines.
  A later migration that changes the function must start from 0074's.
