import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Company logos uploaded from the Applicants tab live in the PRIVATE `logos`
 * bucket (migration 0010), like everything else in this project. They are
 * not secret — they are on the public apply form — but a private bucket
 * needs no storage policy, and the rule here is that nothing opens one.
 * /api/interviews/logo streams a file to whoever asks for it by path.
 *
 * `companies.logo_url` stores that route's RELATIVE address, so a logo
 * uploaded on a Vercel preview works on production too (both read the same
 * interviews project). A pasted external URL keeps working as before.
 */
export const LOGO_BUCKET = 'logos';
export const MAX_LOGO_BYTES = 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const CONTENT_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]),
);

/** `<edition uuid>/<random uuid>.<ext>` — the only shape the route will serve. */
export const LOGO_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

export function logoUrlFor(path: string): string {
  return `/api/interviews/logo?path=${encodeURIComponent(path)}`;
}

/** The bucket path behind a logo_url this module wrote, or null for anything else. */
export function logoPathOf(url: string | null | undefined): string | null {
  if (!url?.startsWith('/api/interviews/logo?')) return null;
  const path = new URLSearchParams(url.split('?')[1]).get('path');
  return path && LOGO_PATH.test(path) ? path : null;
}

/** Stores a logo under a fresh name; returns the URL to put in `logo_url`. */
export async function uploadLogo(
  db: SupabaseClient,
  editionId: string,
  file: File,
): Promise<{ url: string } | { error: string }> {
  const ext = EXTENSIONS[file.type];
  if (!ext) return { error: 'not_image' };
  if (file.size > MAX_LOGO_BYTES) return { error: 'logo_too_large' };

  const path = `${editionId}/${randomUUID()}.${ext}`;
  const { error } = await db.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: error.message };
  return { url: logoUrlFor(path) };
}

/** Deletes a logo this module uploaded; anything else (a pasted URL) is left alone. */
export async function removeLogo(db: SupabaseClient, url: string | null | undefined): Promise<void> {
  const path = logoPathOf(url);
  if (path) await db.storage.from(LOGO_BUCKET).remove([path]);
}
