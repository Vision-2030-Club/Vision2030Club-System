/**
 * The titles a manager picks for an invited guest (Quroosh 0005), in the
 * order the New invitation form lists them. There is no title column: on
 * saving, the chosen title is put in front of the name with a space and
 * saved as the name, so the invitation shows it exactly ("سعادة الأستاذة
 * فلانة الفلانية").
 *
 * The words themselves are in the catalogs (`quroosh.guests.new.titles`):
 * `option` is what the dropdown shows, `text` what is written before the
 * name. They differ only where the dropdown must tell two choices apart
 * that write the same word (Dr., in English).
 *
 *   other  the manager types the title (`title_custom`)
 *   none   the name alone
 */
export const GUEST_TITLES = ['ustadh', 'ustadha', 'doctor_m', 'doctor_f', 'maali', 'other', 'none'] as const;

export type GuestTitle = (typeof GUEST_TITLES)[number];

/** The titles with fixed words, which the invitation can split off a saved name. */
export const WRITTEN_TITLES = ['ustadh', 'ustadha', 'doctor_m', 'doctor_f', 'maali'] as const;

/**
 * A saved name split into the title in front of it and the rest, when it
 * starts with one of the written titles (in either language) and a space;
 * otherwise no title and the whole name. The longest title is tried first,
 * so "سعادة الأستاذة" is not read as "سعادة الأستاذ" and a stray "ة".
 * A custom title ("Other") cannot be told from the name, so it stays in it.
 */
export function splitTitle(name: string, titles: string[]): { title: string | null; name: string } {
  const found = titles
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .find((title) => name.startsWith(`${title} `) && name.length > title.length + 1);
  return found ? { title: found, name: name.slice(found.length + 1).trim() } : { title: null, name };
}

/** A custom title, at most this long. */
export const MAX_CUSTOM_TITLE = 60;

export function isGuestTitle(value: string): value is GuestTitle {
  return (GUEST_TITLES as readonly string[]).includes(value);
}
