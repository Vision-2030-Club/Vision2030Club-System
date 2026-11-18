import 'server-only';
import type { PostgrestError } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';
import { fail, fromPostgrest, ok, type ActionResult } from '@/lib/actions';

/**
 * A refusal in the reader's language. The database names why it refused
 * with a hint (`app.refuse`, 0075); `eventAttendance.errors` holds the
 * wording, and the database's own message is the fallback.
 */
export async function refusal(locale: string, hint: string, message: string): Promise<ActionResult> {
  const t = await getTranslations({ locale, namespace: 'eventAttendance.errors' });
  return fail(t.has(hint) ? t(hint) : message, hint);
}

/** The database's answer, its refusal translated. */
export async function answer(locale: string, error: PostgrestError | null): Promise<ActionResult> {
  if (!error) return ok();
  const result = fromPostgrest(error);
  return refusal(locale, result.hint ?? 'unexpected', result.error ?? '');
}
