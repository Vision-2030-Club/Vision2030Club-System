/**
 * Phone helpers for the UI.
 *
 * The authority on the stored format is `app.normalize_phone` (migration
 * 0022): a trigger rewrites every number to `+9665XXXXXXXX` on the way in, and
 * a CHECK constraint refuses whatever it could not rewrite. Nothing here is a
 * second gate — the two functions below only make the search box and the form
 * hints behave the way the database already will.
 */

/** The stored shape, for `pattern` attributes and placeholders. */
export const PHONE_PATTERN = '\\+9665[0-9]{8}';
export const PHONE_PLACEHOLDER = '+9665XXXXXXXX';

/**
 * Turn whatever someone typed into the run of digits that would appear inside
 * a stored number, so a substring match finds them.
 *
 * `0512345678`, `+966512345678` and `512345678` are all the same person, and
 * all three reduce to `512345678` here — which `%…%` then finds inside
 * `+966512345678`. Returns null when there is nothing numeric to search on,
 * which is how the caller knows to leave phone out of the query entirely.
 */
export function phoneSearchTerm(query: string): string | null {
  let digits = query.replace(/[^0-9]/g, '');
  if (digits.startsWith('00966')) digits = digits.slice(5);
  else if (digits.startsWith('966')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits === '' ? null : digits;
}
