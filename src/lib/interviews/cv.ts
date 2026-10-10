import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_CV_BYTES, isPdf } from './cvLimits';

/**
 * CVs live in the PRIVATE `cvs` bucket of the interviews project (migration
 * 0004). A row stores the object path, never a URL; a page that needs to show
 * one signs a URL that expires in ten minutes. Nothing in the browser can
 * reach a file any other way — the bucket has no policies and the browser has
 * no key for that project.
 */
export const CV_BUCKET = 'cvs';
const SIGNED_URL_TTL_SECONDS = 10 * 60;

/**
 * Stores a CV under a fresh folder. The path carries no student id on purpose:
 * it is created before the application row exists, and a re-submission simply
 * gets a new path while the old file is deleted afterwards.
 *
 * Every refusal is an `errors.*` key the forms translate; the storage error
 * itself only goes to the server log.
 */
export async function uploadCv(
  db: SupabaseClient,
  editionId: string,
  file: File,
): Promise<{ path: string } | { error: string }> {
  if (!isPdf(file)) return { error: 'not_pdf' };
  if (file.size === 0) return { error: 'missing_cv' };
  if (file.size > MAX_CV_BYTES) return { error: 'cv_too_large' };

  // Some phones label a PDF '' or application/octet-stream. The bucket takes
  // only application/pdf, and for a File the upload sends the File's own type
  // (the contentType option is ignored), so give it the right one.
  const body = file.type === 'application/pdf' ? file : new Blob([await file.arrayBuffer()], { type: 'application/pdf' });

  const path = `${editionId}/${randomUUID()}/${Date.now()}.pdf`;
  const { error } = await db.storage
    .from(CV_BUCKET)
    .upload(path, body, { contentType: 'application/pdf', upsert: false });
  if (error) {
    console.error('[interviews/cv] upload failed', error.message);
    return { error: 'upload_failed' };
  }
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

