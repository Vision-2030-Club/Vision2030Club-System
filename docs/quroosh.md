# The Quroosh component (قروش)

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

Quroosh is the club's Shark Tank–style project (renamed from "Shark Tank" in
club migration `0073`). Since `0074` it is a **project component** of its
own, like Mock Interviews and Outreach: a project carries it, and its pages
wear the Quroosh identity instead of the club's.

**State: a skeleton.** One overview page, the identity, and the access rule.
The component's real screens, and any tables they need, are still to be
decided with the club. Each one becomes a page under
`projects/[id]/quroosh/` and an item in the Quroosh sidebar.

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
- `0074` replaces `my_component_access()` with 0072's version plus two lines.
  A later migration that changes the function must start from 0074's.
