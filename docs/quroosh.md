# The Quroosh component (قروش)

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

Quroosh is the club's Shark Tank–style project (renamed from "Shark Tank" in
club migration `0073`). Since `0074` it is a **project component** of its
own, like Mock Interviews and Outreach: a project carries it, and its pages
wear the Quroosh identity instead of the club's.

**State:** the overview page, the identity, the access rule (`0074`),
**applying** (below), stored in the Quroosh database, and the managers
**editing the questions** (Quroosh `0004`). Further screens become pages under
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
- `0074` replaces `my_component_access()` with 0072's version plus two lines.
  A later migration that changes the function must start from 0074's.
