import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Profile photos live in a PRIVATE storage bucket (migration 0024), so a page
 * cannot simply build a URL — it has to ask Supabase to sign one, and that
 * request is itself subject to the bucket's policies. The consequence worth
 * knowing: an unreadable photo comes back as `null` rather than as a broken
 * image, and that is the storage policy refusing, not a missing file.
 */
export const AVATAR_BUCKET = 'avatars';

/** How long a signed photo URL stays valid. Long enough to render a page. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Sign a batch of avatar paths in one round trip.
 *
 * Takes the paths a page already has (from `members.avatar_path`) and returns
 * path -> URL. Signing 180 directory photos one at a time would be 180 network
 * calls, which is why this is a batch and not a per-row helper.
 */
export async function signAvatars(
  supabase: SupabaseClient,
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const signed = new Map<string, string>();
  if (unique.length === 0) return signed;

  const { data } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  for (const row of data ?? []) {
    if (row.signedUrl && row.path) signed.set(row.path, row.signedUrl);
  }
  return signed;
}

/** The single-photo case, for a profile page. */
export async function signAvatar(
  supabase: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  return (await signAvatars(supabase, [path])).get(path) ?? null;
}

/**
 * Initials for the fallback tile.
 *
 * Works on Arabic and Latin names alike because it slices words rather than
 * ASCII letters — `Intl.Segmenter` would be more correct for scripts with
 * combining marks, but a name's first two words cover every case in the club.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '؟';
  return words
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('');
}
