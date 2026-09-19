import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * CVs live in the PRIVATE `cvs` bucket of the interviews project (migration
 * 0004). A row stores the object path, never a URL; a page that needs to show
 * one signs a URL that expires in ten minutes. Nothing in the browser can
 * reach a file any other way — the bucket has no policies and the browser has
 * no key for that project.
 */
export const CV_BUCKET = 'cvs';
export const MAX_CV_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 10 * 60;
/** For links that have to keep working without a page reload signing them again — the floor sheet. */
const LONG_SIGNED_URL_TTL_SECONDS = 30 * 24 * 60 * 60;

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * Stores a CV under a fresh folder. The path carries no student id on purpose:
 * it is created before the application row exists, and a re-submission simply
 * gets a new path while the old file is deleted afterwards.
 */
export async function uploadCv(
  db: SupabaseClient,
  editionId: string,
  file: File,
): Promise<{ path: string } | { error: string }> {
  if (!isPdf(file)) return { error: 'not_pdf' };
  if (file.size === 0) return { error: 'missing_cv' };
  if (file.size > MAX_CV_BYTES) return { error: 'cv_too_large' };

  const path = `${editionId}/${randomUUID()}/${Date.now()}.pdf`;
  const { error } = await db.storage
    .from(CV_BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (error) return { error: error.message };
  return { path };
}

export async function removeCv(db: SupabaseClient, path: string | null | undefined): Promise<void> {
  if (!path) return;
  await db.storage.from(CV_BUCKET).remove([path]);
}

/** A URL that works for ten minutes, or null when the file is not there. */
export async function signCv(
  db: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(CV_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

/**
 * A URL good for 30 days — for the floor sheet (floorSheet.ts), which is
 * written once and then just sits there until the next sync. Every sync
 * re-signs it, so in practice it never goes stale as long as the floor is
 * still changing; a stale link past that is one "Sync now" away from fresh.
 */
export async function signCvLong(
  db: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(CV_BUCKET).createSignedUrl(path, LONG_SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
