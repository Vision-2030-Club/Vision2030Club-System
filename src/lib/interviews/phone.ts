/**
 * Arabic-Indic (٠١٢…) and Persian (۰۱۲…) digits, which an Arabic phone
 * keyboard can type, as 0–9, and the Arabic decimal point (٫) as "." for a
 * GPA. Without this "٠٥٠١٢٣٤٥٦٧" is stored as typed and never matches HR's
 * list (`\D` strips them, leaving nothing).
 */
export function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}

/**
 * One spelling per phone number, the same rule as `app.normalise_phone`
 * (0009): digits only, and a Saudi number written internationally (00966…,
 * +966…, 966…) or without its leading zero (5…) folded to the local 05… form.
 * Used where the app matches numbers itself, so "+966 50 123 4567" and
 * "0501234567" are one person. Returns null for something with no digits.
 */
export function normalisePhone(phone: string | null | undefined): string | null {
  const d = westernDigits(phone ?? '').replace(/\D/g, '');
  if (d.startsWith('00966') && d.length === 14) return `0${d.slice(5)}`;
  if (d.startsWith('966') && d.length === 12) return `0${d.slice(3)}`;
  if (d.startsWith('5') && d.length === 9) return `0${d}`;
  return d || null;
}
