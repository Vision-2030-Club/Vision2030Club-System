import 'server-only';
import { randomBytes, randomInt } from 'node:crypto';

/**
 * The secrets that stand in for a login on the public pages.
 *
 * A student, a company and the waiting-area TV never sign in; each holds an
 * unguessable link instead. 24 random bytes as hex is 192 bits — nobody
 * enumerates that — and hex keeps the link free of characters that break in
 * a WhatsApp message or an email client's auto-linking.
 *
 * Generated here rather than in the database so the second project needs no
 * crypto extension: the server is the only thing that ever creates one.
 */
export function newToken(): string {
  return randomBytes(24).toString('hex');
}

/** A short PIN for an interviewer link — a speed bump, not a secret. */
export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

export function isToken(value: string | undefined | null): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}
