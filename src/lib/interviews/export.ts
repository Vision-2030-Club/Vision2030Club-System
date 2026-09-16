import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toDateInput } from '@/lib/time';

/**
 * The club's own copy of an edition.
 *
 * Supabase Pro keeps daily backups for a week; this is the second copy, the
 * one the club holds. `edition_snapshot` in the database renders everything
 * about an edition as one JSON document; it is written to the private
 * `exports` bucket, once a night by the sweep and whenever a manager asks.
 * The same document is what the Export button downloads.
 */
export const EXPORT_BUCKET = 'exports';

export async function snapshotEdition(db: SupabaseClient, editionId: string): Promise<unknown> {
  const { data, error } = await db.rpc('edition_snapshot', { p_edition: editionId });
  if (error) throw new Error(error.message);
  return data;
}

function counts(snapshot: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (snapshot && typeof snapshot === 'object') {
    for (const [key, value] of Object.entries(snapshot as Record<string, unknown>)) {
      if (Array.isArray(value)) out[key] = value.length;
    }
  }
  return out;
}

export async function takeExport(
  db: SupabaseClient,
  editionId: string,
  actor: { kind: string; id?: string; name?: string },
  day = toDateInput(new Date()),
): Promise<{ path: string; counts: Record<string, number> }> {
  const snapshot = await snapshotEdition(db, editionId);
  const path = `${editionId}/${day}.json`;
  const body = JSON.stringify(snapshot);

  const { error } = await db.storage
    .from(EXPORT_BUCKET)
    .upload(path, new Blob([body], { type: 'application/json' }), {
      contentType: 'application/json',
      upsert: true,
    });
  if (error) throw new Error(error.message);

  const summary = counts(snapshot);
  const { error: recordError } = await db.rpc('record_export', {
    p_edition: editionId,
    p_taken_on: day,
    p_path: path,
    p_counts: summary,
    p_actor: actor,
  });
  if (recordError) throw new Error(recordError.message);

  return { path, counts: summary };
}

/** True when today's export has not been taken yet for this edition. */
export async function exportDueToday(db: SupabaseClient, editionId: string, day = toDateInput(new Date())): Promise<boolean> {
  const { data } = await db
    .from('exports')
    .select('id')
    .eq('edition_id', editionId)
    .eq('taken_on', day)
    .maybeSingle();
  return !data;
}
