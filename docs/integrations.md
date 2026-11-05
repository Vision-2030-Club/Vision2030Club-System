# Google and push notifications

Part of the project handoff — start at [`HANDOFF.md`](../HANDOFF.md).

## Connecting Google

Everything is written; it needs a Google application and one authorisation.
Until then, confirmed online meetings sit at `meet_state = 'pending'` and the
admin page says so. **This is not a blocker** — the meeting is agreed, booked
and on the club's own calendar regardless.

A Super Admin does this once:

1. Google Cloud console → new project → enable the **Google Calendar API**.
2. Create an OAuth client, type **Web application**.
3. Add the redirect URL shown on `/admin/google` to its Authorised redirect
   URIs. It must match character for character. That page now always shows the
   value — it used to render `—` whenever `GOOGLE_REDIRECT_URI` was unset,
   which is precisely when somebody is standing in the Cloud console needing
   it, so it falls back to deriving the URL from the host it is served on. On
   the current deployment it is
   `https://vision2030club-system.vercel.app/api/google/callback`.
4. Put these in `.env.local` and restart:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
5. Sign in as Super Admin, open **Admin → Google**, press Connect, and approve
   as the club's shared account — not a personal one.

The refresh token is stored in `google_credentials`, which has RLS enabled and
**no policies at all**, so only the service-role client can read it. The client
ID and secret stay in environment variables, because they identify the
application rather than the account.

Note what has NOT been exercised: the calls to Google themselves. Everything up
to the API call is covered by `db:meetings`, but nobody has watched a real Meet
link come back, because that needs an account this repo does not have. Expect
to iterate on that first connection.

## Push notifications

Every member is on an iPhone, and on iOS a website can only receive push when
it has been **added to the Home Screen** (iOS 16.4+). So the feature is in two
halves: the site is installable (`src/app/manifest.ts`, the `appleWebApp`
metadata in the root layout, `public/icons/`), and once installed a card on
the person's own profile turns notifications on for that device
(`src/components/PushSettings.tsx`). The dashboard nudges anyone who has not.
No Apple Developer account, certificate or App Store is involved: standard Web
Push with VAPID keys, which Apple routes through APNs itself.

Sending is split the same way the Meet link is:

- **The database decides who.** `0049` writes a row per person to
  `notification_outbox` from triggers on `requests`, `tasks` and
  `task_assignees` (`0050` adds tasks posted for claiming). The recipient rules are the permission map run backwards
  (`app.members_who_can`, `app.request_actors`, `app.task_reviewers`), with
  the narrowest authority preferred — the target team's Directors, not the
  President, are told about a team-level request. Nothing is written for a
  person with no device, and a bug in a trigger is caught and logged rather
  than blocking the write it is about.
- **The server sends.** `src/lib/push.ts` leases rows (`push_claim_outbox`),
  renders each in the language of the device, sends with `web-push`, and
  deletes any subscription the push service reports gone (404/410 — that is
  what removing the icon from the Home Screen looks like). It is kicked at
  the end of the request and task actions, so a phone hears about an approval
  at once, and swept by `/api/push/cron` every five minutes, which also queues
  reminders for anything on the calendar starting
  within the hour (`push_enqueue_reminders`, keyed so a second sweep writes
  nothing) and prunes rows sent a week ago.

What gets sent today: request submitted (to whoever can act), request moved
(to the requester) and awaiting (to whoever is next), meeting confirmed (to
everyone in it), task assigned / ready for review / confirmed / returned / not
done, a project task posted for claiming (to the split's members when it is
scoped to a split, otherwise the project's — `0050`), a claim (to whoever
posted it), and a reminder before a calendar entry. Adding one is an
`app.push_enqueue(...)` call in a trigger; there is no code path outside the
database that decides a recipient.

Setting it up once:

1. `npx web-push generate-vapid-keys`, put the pair in Vercel as
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, and **keep it** —
   every device's subscription is bound to the public key, so a new pair logs
   every phone out of notifications. The `.env.local` on the laptop that
   built this has a pair already; use the same one.
2. Set `CRON_SECRET` to any long random string, in Vercel AND in `.env.local`,
   then run `npm run push:cron`. That schedules the sweep with **pg_cron inside
   Supabase** (every five minutes, calling the deployed route with the secret
   as a bearer token, kept in Supabase Vault). Not a Vercel cron: the Hobby plan
   allows one a day, and the build is refused outright for anything more — that
   is exactly how the first deploy of this failed. `npm run push:cron -- --status`
   shows the last runs and the HTTP status the site answered; `-- --off` removes
   it. If it is ever not scheduled, only reminders and retries stop — the
   inline sends after each action still happen.
3. Redeploy (the public key is `NEXT_PUBLIC_*`, so it is baked in at build).

iOS things that will come up:

- The installed app has its **own cookie jar** — everyone signs in once more
  inside the icon. Email + password makes that a non-event.
- The permission prompt appears only inside the installed app and only from a
  tap, which is why the card's states are what they are. "Don't Allow" is
  final for that install; the fix is to remove and re-add the icon.
- Testing needs HTTPS: the deployed site, or a tunnel such as ngrok
  (installed on your own machine, not in this project) in front of
  `next dev`. Nothing about push can be exercised over http://localhost from a phone.

`npm run db:notify` proves the database half: who is and is not told, per
event, plus that the outbox and the two service-role functions are unreachable
through the API. What it cannot prove is Apple delivering — that is the test
button on the profile card, pressed on a real iPhone.
