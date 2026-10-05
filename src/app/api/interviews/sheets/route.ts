import { NextResponse } from 'next/server';
import { isGoogleConfigured } from '@/lib/google/auth';
import { pullSheets } from '@/lib/interviews/sheetsSync';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';

/**
 * The Google Sheets pull, every minute (scripts/interviews-cron-setup.mjs
 * schedules it with pg_cron next to the five-minute sweep): a Status changed
 * in the floor sheet or a company's sheet becomes the booking's stage in the
 * app, and every sheet is brought back into agreement (sheetsSync.ts,
 * sheetPull.ts). Only ACTIVE editions; a draft or archived one is left
 * alone. With nothing edited it costs one Google Drive request a minute.
 *
 * Whoever calls it sends `Authorization: Bearer $CRON_SECRET`; anyone else
 * gets 401.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!isInterviewsConfigured() || !isGoogleConfigured()) {
    return NextResponse.json({ skipped: 'interviews database or Google not configured' });
  }

  const db = createInterviewsClient();
  const { data: editions } = await db.from('editions').select('id').eq('status', 'active');

  const results: Record<string, unknown> = {};
  for (const { id } of (editions ?? []) as { id: string }[]) {
    try {
      results[id] = await pullSheets(id);
    } catch (error) {
      results[id] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return NextResponse.json({ editions: results });
}
