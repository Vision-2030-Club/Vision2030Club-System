import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EditionSettings } from './types';

/**
 * The public candidate links, /interviews/room/<token> (the room flow). Each
 * assignment (a session: one company in one room on one day) has its own,
 * kept in the edition's settings as `session_links` ({ session id: token }).
 * The older per-company links, `room_links` ({ company id: token }), are no
 * longer shown or made, but a link already handed out keeps working. Both
 * are merged by update_edition, so neither needs a migration. A new token
 * replaces the old one, and the old link stops working at once.
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

/** Each assignment's link, by session id. */
export function sessionLinks(settings: { session_links?: unknown } | null | undefined): Record<string, string> {
  return roomLinks({ room_links: settings?.session_links });
}

/** Saves one assignment's link, read fresh so two quick saves do not undo each other. */
export async function saveSessionLink(
  db: SupabaseClient,
  editionId: string,
  sessionId: string,
  token: string,
  actor: unknown,
): Promise<{ error: string | null }> {
  const { data } = await db.rpc('edition_settings', { p_edition: editionId });
  const links = { ...sessionLinks(data as EditionSettings | null), [sessionId]: token };
  const { error } = await db.rpc('update_edition', {
    p_edition: editionId,
    p_patch: { settings: { session_links: links } },
    p_actor: actor,
  });
  return { error: error?.message ?? null };
}

/**
 * What a link opens: the edition, the company, and the assignment for an
 * assignment's link (null for an older company link). There are a handful
 * of editions, so they are simply read and searched; an archived edition's
 * links no longer open anything.
 */
export async function findRoomByToken(
  db: SupabaseClient,
  token: string,
): Promise<{ editionId: string; companyId: string; sessionId: string | null } | null> {
  const { data } = await db.from('editions').select('id, status, settings').neq('status', 'archived');
  for (const edition of (data ?? []) as { id: string; settings: EditionSettings | null }[]) {
    const session = Object.entries(sessionLinks(edition.settings)).find(([, value]) => value === token);
    if (session) {
      const { data: row } = await db
        .from('sessions')
        .select('company_id')
        .eq('id', session[0])
        .eq('edition_id', edition.id)
        .maybeSingle();
      // A removed assignment's link stops working.
      return row ? { editionId: edition.id, companyId: row.company_id as string, sessionId: session[0] } : null;
    }
    const company = Object.entries(roomLinks(edition.settings)).find(([, value]) => value === token);
    if (company) return { editionId: edition.id, companyId: company[0], sessionId: null };
  }
  return null;
}
