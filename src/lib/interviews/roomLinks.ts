import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EditionSettings } from './types';

/**
 * Each room's public link, /interviews/room/<token>. A room here is a company
 * with its session (createRoomAction), so the link belongs to the company.
 * Kept in the edition's settings as `room_links` ({ company id: token }),
 * which update_edition already merges, so it needs none of 0005's columns or
 * functions. A new token for a company replaces the old one, and the old link
 * stops working at once.
 */
export function roomLinks(settings: { room_links?: unknown } | null | undefined): Record<string, string> {
  const links = settings?.room_links;
  if (!links || typeof links !== 'object') return {};
  return Object.fromEntries(
    Object.entries(links as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Saves one company's link, read fresh so two quick saves do not undo each other. */
export async function saveRoomLink(
  db: SupabaseClient,
  editionId: string,
  companyId: string,
  token: string,
  actor: unknown,
): Promise<{ error: string | null }> {
  const { data } = await db.rpc('edition_settings', { p_edition: editionId });
  const links = { ...roomLinks(data as EditionSettings | null), [companyId]: token };
  const { error } = await db.rpc('update_edition', {
    p_edition: editionId,
    p_patch: { settings: { room_links: links } },
    p_actor: actor,
  });
  return { error: error?.message ?? null };
}

/**
 * The room a link opens: the edition and company it belongs to. There are a
 * handful of editions, so they are simply read and searched; an archived
 * edition's links no longer open anything.
 */
export async function findRoomByToken(
  db: SupabaseClient,
  token: string,
): Promise<{ editionId: string; companyId: string } | null> {
  const { data } = await db.from('editions').select('id, status, settings').neq('status', 'archived');
  for (const edition of (data ?? []) as { id: string; settings: EditionSettings | null }[]) {
    const match = Object.entries(roomLinks(edition.settings)).find(([, value]) => value === token);
    if (match) return { editionId: edition.id, companyId: match[0] };
  }
  return null;
}
