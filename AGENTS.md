<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Vision 2030 Club System — rules for coding assistants

This file is read by Claude Code (through `CLAUDE.md`), Codex, Cursor and
Copilot. The team is students working together for the first time, and most
of the code is written with an AI assistant, so these rules are written for
the assistant as much as for the person.

## The one rule that matters

`main` is the live website. Nothing reaches it except a pull request that a
teammate approved, CI passed, and the project lead merged. An assistant
never pushes to `main`, never merges, and never changes GitHub, Vercel or
Supabase settings. Branch, commit, push the branch, open the pull request,
stop.

## Read before working

- `CONTRIBUTING.md` — the branch-and-review routine and the commands.
- `HANDOFF.md` — how every part of the system works, what breaks easily,
  and what is still open. Read the section for the area you are touching.
- `.claude/rules/` — the detailed rules. `team-workflow.md` and
  `secrets.md` always apply; `database.md`, `interviews.md` and
  `i18n-ui.md` apply to the paths they name. Other assistants: read them all.

## The project in five lines

- Next.js App Router with `next-intl`, Arabic (RTL, primary) and English.
  Read `node_modules/next/dist/docs/` before writing Next.js code; this
  version differs from training data.
- Two Supabase databases: the club (members, tasks, rooms, requests) and the
  Mock Interviews component (`supabase/interviews/`), which is server-only
  behind the service role.
- Tailwind v4 with colour tokens in `src/app/globals.css`; the interviews
  pages repaint the tokens under `html[data-theme="interviews"]`.
- Deployed on Vercel from `main`; every branch gets a preview URL on its
  pull request.
- Keys live in Vercel and `.env.local` only. Never print or commit one.

## Definition of done for a pull request

1. `npm run typecheck` and `npm run lint` pass locally.
2. New text is in both `messages/en.json` and `messages/ar.json`.
3. The change was tried on the Vercel preview, in Arabic and English, at
   phone width.
4. `HANDOFF.md` is updated if behaviour, setup, or a fragile part changed.
5. A database migration says in the pull request who applies it and when.
6. The pull request body says what changed, why, and how to try it.
