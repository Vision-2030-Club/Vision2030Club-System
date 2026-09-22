# How this team ships

`main` is production: Vercel deploys every change to it within minutes.
GitHub rulesets enforce the routine below; these rules exist so an AI
assistant follows it without being told each time.

## Always

- Work on a branch named for the task (`fix-room-schedule`), branched from a
  freshly pulled `main`. Never commit on `main`.
- One task per branch, one pull request per branch. Keep a pull request to
  one thing a teammate can review in fifteen minutes. If the work grows,
  stop and split it.
- Before pushing: `npm run typecheck` and `npm run lint` must pass. CI runs
  the same two commands and blocks the merge otherwise.
- Push the branch and open a pull request against `main` with the template
  filled in: what changed, how to try it on the Vercel preview, the
  checklist. Do not leave the body empty.
- Commit messages are one plain sentence saying what changed and why, in
  the style of the existing history (`git log --oneline -20`).
- Update `HANDOFF.md` in the same pull request whenever you change how a
  part of the system works, what breaks easily, or the setup steps.

## Never

- Never push to `main`, force-push any shared branch, or rewrite history
  that has been pushed.
- Never merge a pull request. Merging is done by the project lead only,
  after one approval and green CI. Do not approve your own work.
- Never change repository or organization settings, rulesets, teams,
  collaborators, secrets, or Vercel settings. Say what should change and
  let a person do it.
- Never delete branches, tags, issues, or comments that are not yours.
- Never run a database migration, seed, or import against a real database.
  See `.claude/rules/database.md`.
- Never disable, skip, or loosen a check to get something merged
  (`--no-verify`, commenting out a lint rule, weakening a type).

## When unsure

State the assumption in the pull request description and continue. Stop
and ask only when the choice would change the data model, delete data, or
expose personal data.
