import { NextResponse } from 'next/server';
import { deliverPendingEmails } from '@/lib/interviews/email';
import { exportDueToday, takeExport } from '@/lib/interviews/export';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { CLUB_TIME_ZONE } from '@/lib/time';

/**
 * The interviews sweep, every five minutes (scripts/interviews-cron-setup.mjs
 * schedules it with pg_cron in the club's Supabase project, exactly like the
 * push sweep). Three jobs:
 *
 *   1. queue a reminder for every interview in the next 24 hours
 *   2. send whatever the outbox holds — reminders, plus anything an inline
 *      delivery could not send
 *   3. once a day after 03:00 club time, write each active edition to the
 *      private `exports` bucket — the club's own copy of its data
 *
 * Whoever calls it sends `Authorization: Bearer $CRON_SECRET`; anyone else
 * gets 401. The proxy already excludes /api, so no session is involved.
 */
export const maxDuration = 60;

const EXPORT_AFTER_HOUR = 3;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!isInterviewsConfigured()) {
    return NextResponse.json({ skipped: 'interviews database not configured' });
  }

  const db = createInterviewsClient();

  const { data: reminders, error } = await db.rpc('enqueue_reminders', { p_hours: 24 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const report = await deliverPendingEmails(200, 35_000);

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: CLUB_TIME_ZONE, hour: '2-digit', hour12: false }).format(
      new Date(),
    ),
  );

  const exported: string[] = [];
  const exportErrors: string[] = [];
  if (hour >= EXPORT_AFTER_HOUR) {
    const { data: editions } = await db.from('editions').select('id').eq('status', 'active');
    for (const edition of editions ?? []) {
      const id = edition.id as string;
      if (!(await exportDueToday(db, id))) continue;
      try {
        await takeExport(db, id, { kind: 'system', name: 'nightly export' });
        exported.push(id);
      } catch (caught) {
        exportErrors.push(`${id}: ${caught instanceof Error ? caught.message : 'failed'}`);
      }
    }
  }

  return NextResponse.json({ reminders: reminders ?? 0, ...report, exported, exportErrors });
}
