import { NextResponse } from 'next/server';
import { deliverPendingPasses } from '@/lib/eventAttendance/email';
import { sweepGuestAccounts } from '@/lib/quroosh/accountSync';
import { createAdminClient } from '@/lib/supabase/admin';
import { deliverPendingNotifications, pruneOutbox } from '@/lib/push';

/**
 * The scheduled sweep. Three jobs, in order:
 *
 *   1. queue a reminder for anything on the calendar starting soon
 *   2. send whatever is queued — reminders, plus any row an earlier inline
 *      delivery could not send
 *   3. forget rows that were sent a week ago
 *   4. send the event passes still waiting (Event attendance, 0075): the
 *      emails an inline delivery could not send, or that were queued while
 *      email was not configured
 *   5. make the Quroosh guest accounts of whoever was checked in at the gate
 *      since the last sweep, and send their emails (Quroosh 0006)
 *
 * Called every five minutes by pg_cron inside Supabase (scripts/push-cron-
 * setup.mjs), not by Vercel: the Hobby plan allows one cron a day, which is
 * useless for "your meeting starts in an hour". Whoever calls it sends
 * `Authorization: Bearer $CRON_SECRET`; anyone else gets 401. The proxy
 * matcher already excludes /api, so no session is involved.
 */
// The database is a continent away and a busy pass sends dozens of pushes;
// the platform's default budget (10s on Hobby) is not enough. Delivery stops
// starting new sends at 40s and leaves the rest leased for the next sweep.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const admin = createAdminClient();

  // How far ahead a reminder looks. Wider than the sweep interval so a slow
  // or skipped run cannot miss a meeting; the dedupe key stops repeats.
  const minutes = Number(process.env.PUSH_REMINDER_MINUTES ?? '60');

  const { data: reminders, error } = await admin.rpc('push_enqueue_reminders', {
    p_minutes: Number.isFinite(minutes) ? minutes : 60,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const report = await deliverPendingNotifications(200);
  await pruneOutbox();

  // Never fails the sweep: the pushes above have already gone.
  const passes = await deliverPendingPasses(100, 15_000).catch(() => null);

  // Quroosh guest accounts (Quroosh 0006): an account and its email for
  // whoever was checked in since the last sweep, and the emails still waiting.
  const guestAccounts = await sweepGuestAccounts().catch(() => null);

  return NextResponse.json({ reminders: reminders ?? 0, ...report, passes, guestAccounts });
}
