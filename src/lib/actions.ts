import 'server-only';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Shape every server action returns, so forms can render success and failure
 * the same way.
 *
 * `error` carries the database's own message when a permission or validation
 * rule rejects the write. Those messages are written to be readable — e.g.
 * "Permission denied: members.manage" or "Status change pending -> approved is
 * not allowed for this request type" — which is the point of raising them in
 * the database rather than failing silently.
 */
export type ActionResult = {
  ok: boolean;
  /** Message key in the `common` catalog, shown on success. */
  message?: string;
  /** Raw error text from the database or a validation check. */
  error?: string;
};

export const ok = (message = 'saved'): ActionResult => ({ ok: true, message });

export const fail = (error: string): ActionResult => ({ ok: false, error });

export function fromPostgrest(error: PostgrestError | null): ActionResult {
  if (!error) return ok();
  return { ok: false, error: error.message };
}

/** Reads a trimmed string field, returning null when empty. */
export function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? '').trim();
  return value === '' ? null : value;
}

/** Reads a required string field. */
export function requiredText(formData: FormData, key: string): string {
  const value = text(formData, key);
  if (value === null) throw new Error(`Missing required field: ${key}`);
  return value;
}

export function all(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((v) => String(v).trim())
    .filter(Boolean);
}
