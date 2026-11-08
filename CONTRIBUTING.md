# Working on this project together

`main` is the live website: every change to it is deployed to production by
Vercel within a few minutes. So nobody pushes to `main` directly. All work
goes on a branch, becomes a pull request, gets one review, and the project
lead merges it.

## Your first day

```bash
git clone https://github.com/Vision-2030-Club/Vision2030Club-System.git
cd Vision2030Club-System
npm install
npm run typecheck   # both must pass before you push;
npm run lint        # CI runs the same two on every pull request
```

You do **not** get the database keys or access to Vercel, and you do not
need them. Without keys the app does not start on your laptop (every page
needs the database), so you see your work on the **preview link** that
Vercel posts on your pull request a few minutes after each push. That link
is the real app with your change in it.

## Doing a piece of work

1. **Take an issue.** Assign it to yourself on GitHub so nobody else starts
   it. No issue for what you want to do? Ask the lead to open one first.
2. **Branch from a fresh `main`:**

   ```bash
   git checkout main
   git pull
   git checkout -b short-name-for-the-work   # e.g. quroosh-export-csv
   ```

3. **Make the change.** Keep it to the one issue; if it grows, stop and
   split it.
4. **Check it:** `npm run typecheck` and `npm run lint`.
5. **Commit and push:**

   ```bash
   git add .
   git commit -m "One sentence saying what changed and why"
   git push -u origin short-name-for-the-work
   ```

6. **Open the pull request.** GitHub shows a yellow **Compare & pull request**
   banner. Fill in the template — what changed, how to try it — and write
   `Closes #<issue number>` so the issue closes when it merges.
7. **Try it on the preview link** in Arabic and English at phone width, and
   tick the box in the template.
8. **Ask a teammate to review.** They read the diff, try the preview, and
   press **Approve** or **Request changes**. Fix what they ask on the same
   branch; the pull request updates by itself.
9. **The project lead merges** once there is an approval and CI is green.
   Then delete your branch (GitHub offers a button) and take the next issue.

## Reviewing a teammate's pull request

- Read the description first: what should change, and how to try it.
- Open the preview link and do exactly that, in both languages, on a phone
  width.
- Read the diff. Ask about anything you do not understand; that is a
  review comment, not an attack.
- **Approve** only what you would be happy to see on the live site.

## Rules that keep the club's data safe

- **Never push to `main`.** GitHub refuses it anyway.
- **Database changes go through the lead.** Write the migration file in your
  pull request (the issue says which number to use); the lead applies it to
  the database, never you. Files under `supabase/` change the live database
  and are the one place a mistake loses data, so they always get the lead's
  review.
- **No keys in the repo or in chat.** You will not have any; if you ever see
  one, tell the lead rather than copying it.
- **No real people's data** — names, phones, emails, CVs — in code, tests,
  screenshots, issues or pull requests. Use invented names and `05xxxxxxxx`.
- **Every sentence the app shows goes in both `messages/en.json` and
  `messages/ar.json`.**
- **Read the docs for the area you touch** before you start. [`HANDOFF.md`](HANDOFF.md)
  links to the file in `docs/` that explains how that part works and what
  breaks easily.
