# Working on this project together

`main` is the live website: every change to it is deployed to production by
Vercel within a few minutes. So nobody pushes to `main` directly. All work
goes on a branch, becomes a pull request, gets one review, and is merged.

## Doing a piece of work

```bash
git checkout main
git pull                                  # start from the latest main
git checkout -b short-name-for-the-work   # e.g. fix-room-schedule

# ...edit, run the app locally, check it works...

git add .
git commit -m "One sentence saying what changed"
git push -u origin short-name-for-the-work
```

Then open GitHub. A yellow banner offers **Compare & pull request**. Fill in
the template, and ask a teammate to review. Vercel posts a preview link on
the pull request within a few minutes: that is the change running on a real
URL, safe to click around in.

The reviewer reads the diff, tries the preview, and presses **Approve** or
**Request changes**. When CI is green and there is an approval, anyone can
press **Merge**. Delete the branch afterwards; GitHub offers a button.

## Rules that keep the club's data safe

- **Never push to `main`.** GitHub refuses it anyway.
- **Database migrations get a careful review.** Files under `supabase/` change
  the live database and are the one place a mistake loses data. Say in the
  pull request who will apply the migration and when.
- **No secrets in the repo.** Keys live in Vercel. To run the app locally, ask
  an admin for access to the Vercel project and run `npx vercel env pull`.
  Never paste a key into chat.
- **Every user-facing string goes in both `messages/en.json` and
  `messages/ar.json`.**
- **Read `HANDOFF.md` before touching an area you have not worked in.** It
  explains how each part works and what breaks easily.

## Running locally

```bash
npm install
npx vercel env pull .env.local   # after an admin adds you to the Vercel project
npm run dev
```

`npm run typecheck` and `npm run lint` are what CI runs on every pull request.
