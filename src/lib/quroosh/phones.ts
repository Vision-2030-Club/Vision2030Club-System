import { westernDigits } from '@/lib/interviews/phone';

/**
 * International phone numbers for Quroosh's guests (0005), who may be
 * abroad: a country picker and the number, stored as E.164 (`+` and the
 * country code, digits only), the shape `guest_invitations` checks.
 *
 * Not the application form's Saudi-only rule (questions.ts). Used by the
 * booking form, to say which field is wrong before sending, and by its
 * action, which decides.
 *
 * Country names are not here: the page asks Intl.DisplayNames for them in the
 * visitor's language, so the list needs no translation.
 */

/** E.164, as guest_invitations' CHECK has it. */
export const E164 = /^\+[1-9][0-9]{7,14}$/;

/** ISO 3166 code and calling code. Saudi Arabia is the default. */
export const COUNTRIES: readonly (readonly [iso: string, dial: string])[] = [
  ['SA', '966'], ['AE', '971'], ['BH', '973'], ['KW', '965'], ['OM', '968'], ['QA', '974'],
  ['EG', '20'], ['JO', '962'], ['LB', '961'], ['IQ', '964'], ['SY', '963'], ['PS', '970'],
  ['YE', '967'], ['SD', '249'], ['LY', '218'], ['TN', '216'], ['DZ', '213'], ['MA', '212'],
  ['MR', '222'], ['SO', '252'], ['DJ', '253'], ['KM', '269'],
  ['TR', '90'], ['IR', '98'], ['PK', '92'], ['IN', '91'], ['BD', '880'], ['ID', '62'],
  ['MY', '60'], ['SG', '65'], ['CN', '86'], ['HK', '852'], ['JP', '81'], ['KR', '82'],
  ['PH', '63'], ['TH', '66'], ['VN', '84'], ['AU', '61'], ['NZ', '64'],
  ['GB', '44'], ['IE', '353'], ['FR', '33'], ['DE', '49'], ['NL', '31'], ['BE', '32'],
  ['LU', '352'], ['CH', '41'], ['AT', '43'], ['IT', '39'], ['ES', '34'], ['PT', '351'],
  ['SE', '46'], ['NO', '47'], ['DK', '45'], ['FI', '358'], ['PL', '48'], ['GR', '30'],
  ['RU', '7'], ['UA', '380'],
  ['US', '1'], ['CA', '1'], ['MX', '52'], ['BR', '55'], ['AR', '54'],
  ['ZA', '27'], ['NG', '234'], ['KE', '254'], ['ET', '251'], ['GH', '233'],
];

export const DEFAULT_COUNTRY = 'SA';

export function dialCode(iso: string): string | null {
  return COUNTRIES.find(([code]) => code === iso)?.[1] ?? null;
}

/**
 * The number typed, with the country picked, as E.164; null when it cannot
 * be one. A number typed in full (`+44…` or `0044…`) is taken as it is,
 * whatever the picker says. Otherwise the leading 0 most countries dial at
 * home is dropped (not for Italy, where it belongs to the number), and the
 * country's code goes in front: Saudi Arabia and `0501234567` is
 * `+966501234567`. Arabic digits are read as digits.
 */
export function internationalPhone(iso: string, typed: string): string | null {
  const raw = westernDigits(typed).trim();
  if (raw === '') return null;
  const digits = raw.replace(/\D/g, '');
  let phone: string;
  if (raw.startsWith('+')) phone = `+${digits}`;
  else if (digits.startsWith('00')) phone = `+${digits.slice(2)}`;
  else {
    const dial = dialCode(iso);
    if (!dial) return null;
    const national = dial === '39' ? digits : digits.replace(/^0+/, '');
    phone = `+${dial}${national}`;
  }
  return E164.test(phone) ? phone : null;
}
