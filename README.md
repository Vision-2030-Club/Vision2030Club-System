# Vision 2030 Club System

The management system of the Vision 2030 Club: members and teams, projects
and tasks, requests and meetings, rooms, KPIs, and the club's project
components — Mock Interviews (افترض), Outreach, and Quroosh (قروش).

Arabic is the primary language (right to left); every screen also works in
English.

## Start here

1. **Read [`CONTRIBUTING.md`](CONTRIBUTING.md).** It is the routine: one task,
   one branch, one pull request, one review. `main` is the live website.
2. **Pick a task** from the repository's Issues. Each one says what "done"
   looks like and whether it needs a database change.
3. **Read the part of the docs for the area you touch.** [`HANDOFF.md`](HANDOFF.md)
   is the map; [`docs/`](docs/) has one file per area.
4. **Using an AI assistant?** It reads [`AGENTS.md`](AGENTS.md) and
   [`.claude/rules/`](.claude/rules/) on its own. Read them once yourself, so
   you know what it has been told.

## The stack, in one breath

Next.js (App Router) with `next-intl`, TypeScript, Tailwind v4, and three
Supabase databases: the club, Mock Interviews, and Quroosh. Deployed on
Vercel from `main`; every pull request gets its own preview link.

## What you can and cannot do

| You can | Only the project lead does |
|---|---|
| Work on a branch and open a pull request | Merge into `main` |
| Review a teammate's pull request | Apply database migrations |
| Write a migration file in your pull request | Hold the keys and the Vercel and Supabase settings |
| Try your change on the pull request's preview link | Change GitHub, Vercel or Supabase settings |

## Folders

```
src/          the app: pages (app/), shared UI (components/), logic (lib/)
messages/     every sentence the app shows, in en.json and ar.json
supabase/     database migrations, one folder per database
scripts/      database tests, imports, and maintenance (lead only)
docs/         how each part works
design/       brand originals (not served)
public/       logos and icons the site serves
```
