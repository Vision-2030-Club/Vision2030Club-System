# The Quroosh component (قروش)

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

Quroosh is the club's Shark Tank–style project (renamed from "Shark Tank" in
club migration `0073`). Since `0074` it is a **project component** of its
own, like Mock Interviews and Outreach: a project carries it, and its pages
wear the Quroosh identity instead of the club's.

**State:** the overview page, the identity, the access rule (`0074`), and
**applying** (below), stored in the Quroosh database. Further screens become pages under
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
- **One list drives everything:** `src/lib/quroosh/questions.ts`. The form,
  the server action and the managers' view all read it. To add a question:
  a column (with its CHECK) in a new Quroosh migration, an entry in `SECTIONS`, and
  its wording under `quroosh.apply` in both catalogs.
- **A project's form exists once a manager saves its settings** on the
  Applications page (the first "Open applications" does it). Until then the
  public link says the form does not exist.
- **Validation lives in the database.** The Quroosh database's `apply()`,
  called by the server with the secret key, checks the form is open and
  inserts the application and its team in one transaction; the table's CHECK constraints decide what is valid, and a
  refusal comes back with a hint the page translates (`already_applied`,
  `applications_closed`, `invalid`, …). The page checks phones and the
  multi-choice questions first only so it can say which field is wrong.
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
- **The columns follow `QUESTIONS`**: a question added there gets its column
  with no change here. Headers and choices are the English form's labels;
  the other team members sit in one cell after the team question.
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
- The option values in `questions.ts` must match the CHECK lists in
  `supabase/quroosh/migrations/0001_applications.sql`.
  A value in one and not the other makes every answer with it fail as
  `invalid`.
- The dates in the commitment question's help line (21–26 November) are
  in the catalogs; change them for the next edition.
- `0074` replaces `my_component_access()` with 0072's version plus two lines.
  A later migration that changes the function must start from 0074's.
