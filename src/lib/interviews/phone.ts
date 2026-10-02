/**
 * One spelling per phone number, the same rule as `app.normalise_phone`
 * (0009): digits only, and a Saudi number written internationally (00966…,
 * +966…, 966…) or without its leading zero (5…) folded to the local 05… form.
 * Used where the app matches numbers itself, so "+966 50 123 4567" and
 * "0501234567" are one person. Returns null for something with no digits.
 */
export function normalisePhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.startsWith('00966') && d.length === 14) return `0${d.slice(5)}`;
  if (d.startsWith('966') && d.length === 12) return `0${d.slice(3)}`;
  if (d.startsWith('5') && d.length === 9) return `0${d}`;
  return d || null;
}
