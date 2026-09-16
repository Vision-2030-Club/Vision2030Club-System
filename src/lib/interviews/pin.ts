import { createHash } from 'node:crypto';

/**
 * The PIN cookie. Entering the PIN once sets a cookie holding a hash of the
 * link and the PIN together, so a cookie from one company's page opens no
 * other, and changing the PIN (or rotating the link) logs everyone out.
 */
export function pinCookieName(companyId: string): string {
  return `iv_pin_${companyId.replace(/-/g, '')}`;
}

export function pinCookieValue(token: string, pin: string): string {
  return createHash('sha256').update(`${token}:${pin}`).digest('hex');
}
