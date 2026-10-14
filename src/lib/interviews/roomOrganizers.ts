import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { EditionSettings } from './types';

/**
 * Which organizer runs which room, so that only one person moves the
 * students of a room. Kept in the edition's settings as `room_organizers`
 * ({ key: club member id }), merged by update_edition, so no migration:
 *
 *   "<room id>"              the room's organizer on every day
 *   "<room id>:<YYYY-MM-DD>" a different organizer on that one day
 *
 * An organizer can hold several rooms. A room with nobody assigned is open
 * to every organizer, as before this existed; a room with somebody is theirs
 * alone (and the managers', who may act anywhere). The rule is enforced in
 * stageAction (actions.ts); the floor only greys the buttons out.
 */
export type RoomOrganizers = Record<string, string>;

const KEY = /^[0-9a-f-]{36}(:\d{4}-\d{2}-\d{2})?$/;

export function roomOrganizers(settings: { room_organizers?: unknown } | null | undefined): RoomOrganizers {
  const map = settings?.room_organizers;
  if (!map || typeof map !== 'object') return {};
  return Object.fromEntries(
    Object.entries(map as Record<string, unknown>).filter(
      (entry): entry is [string, string] => KEY.test(entry[0]) && typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );
}

/** The member who runs this room on this day, or null when it is open to every organizer. */
export function organizerOf(map: RoomOrganizers, roomId: string, day: string): string | null {
  return map[`${roomId}:${day}`] ?? map[roomId] ?? null;
}

/** The rooms (of those given) a member runs on a day. */
export function roomsRunBy(map: RoomOrganizers, memberId: string, day: string, roomIds: string[]): string[] {
  return roomIds.filter((roomId) => organizerOf(map, roomId, day) === memberId);
}

/** One room's own entries: its every-day organizer and its per-day ones. */
export function entriesOf(map: RoomOrganizers, roomId: string): { all: string | null; days: Record<string, string> } {
  const days: Record<string, string> = {};
  for (const [key, memberId] of Object.entries(map)) {
    if (key.startsWith(`${roomId}:`)) days[key.slice(roomId.length + 1)] = memberId;
  }
  return { all: map[roomId] ?? null, days };
}

/**
 * Replaces one room's entries, read fresh so two managers saving different
 * rooms a moment apart do not undo each other (update_edition merges the
 * settings' top-level keys, so the whole map is written each time). A day
 * set to the room's every-day organizer is not stored twice.
 */
export async function saveRoomOrganizers(
  db: SupabaseClient,
  editionId: string,
  roomId: string,
  next: { all: string | null; days: Record<string, string> },
  actor: unknown,
): Promise<{ error: string | null }> {
  const { data } = await db.rpc('edition_settings', { p_edition: editionId });
  const map = roomOrganizers(data as EditionSettings | null);
  for (const key of Object.keys(map)) {
    if (key === roomId || key.startsWith(`${roomId}:`)) delete map[key];
  }
  if (next.all) map[roomId] = next.all;
  for (const [day, memberId] of Object.entries(next.days)) {
    if (memberId && memberId !== next.all && /^\d{4}-\d{2}-\d{2}$/.test(day)) map[`${roomId}:${day}`] = memberId;
  }

  const { error } = await db.rpc('update_edition', {
    p_edition: editionId,
    p_patch: { settings: { room_organizers: map } },
    p_actor: actor,
  });
  return { error: error?.message ?? null };
}

export type OrganizerOption = { id: string; name_en: string; name_ar: string };

/**
 * The project's organizers, from the CLUB database (0062), read as the
 * signed-in person: the roster is names, which everyone signed in may see.
 * These are the people a room can be given to.
 */
export async function loadOrganizers(projectId: string): Promise<OrganizerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('project_component_people')
    .select('member_id, members:member_id(id, name_en, name_ar)')
    .eq('project_id', projectId)
    .eq('role', 'organizer');
  return ((data ?? []) as unknown as { members: OrganizerOption | null }[])
    .map((row) => row.members)
    .filter((member): member is OrganizerOption => Boolean(member))
    .sort((a, b) => a.name_en.localeCompare(b.name_en));
}
