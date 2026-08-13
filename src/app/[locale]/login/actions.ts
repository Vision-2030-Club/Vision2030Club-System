'use server';

import { redirect } from '@/i18n/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { routing, type Locale } from '@/i18n/routing';

/**
 * Login is a two-step flow (spec §5):
 *
 *   1. enter email
 *      - no profile with that email  -> "No account found". Nothing is created.
 *      - profile with no password yet -> set one, once
 *      - otherwise                    -> ordinary password sign-in
 *
 * There is no public registration and no self-service password reset anywhere
 * in this file, by design.
 */
export type LoginState = {
  step: 'email' | 'set-password' | 'password';
  email: string;
  /** A key into the `auth` message catalog, so the text stays translated. */
  error?: string;
};

const MIN_PASSWORD_LENGTH = 8;

function localeOf(formData: FormData): Locale {
  const value = String(formData.get('locale') ?? '');
  return (routing.locales as readonly string[]).includes(value)
    ? (value as Locale)
    : routing.defaultLocale;
}

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const intent = String(formData.get('intent') ?? 'lookup');
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const locale = localeOf(formData);

  if (!email) {
    return { step: 'email', email: '', error: 'noAccount' };
  }

  // The lookup happens before anyone is signed in, so it uses the service-role
  // client — an anonymous visitor has no read access to `members` at all.
  const admin = createAdminClient();
  const { data: member } = await admin
    .from('members')
    .select('id, auth_user_id, status')
    .eq('email', email)
    .maybeSingle();

  if (!member) {
    return { step: 'email', email, error: 'noAccount' };
  }

  if (member.status !== 'active') {
    return { step: 'email', email, error: 'inactive' };
  }

  const needsPassword = member.auth_user_id === null;

  if (intent === 'lookup') {
    return { step: needsPassword ? 'set-password' : 'password', email };
  }

  const password = String(formData.get('password') ?? '');

  if (intent === 'set-password') {
    if (!needsPassword) {
      // Someone finished this step in another tab; fall back to signing in.
      return { step: 'password', email };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { step: 'set-password', email, error: 'passwordTooShort' };
    }
    if (password !== String(formData.get('confirmPassword') ?? '')) {
      return { step: 'set-password', email, error: 'passwordsDoNotMatch' };
    }

    // Create the login account and attach it to the imported profile. This is
    // the one moment a member's auth account comes into existence.
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createError || !created.user) {
      return { step: 'set-password', email, error: 'unexpected' };
    }

    const { error: linkError } = await admin
      .from('members')
      .update({ auth_user_id: created.user.id })
      .eq('id', member.id);

    if (linkError) {
      // Don't leave an orphan auth account behind.
      await admin.auth.admin.deleteUser(created.user.id);
      return { step: 'set-password', email, error: 'unexpected' };
    }
  } else if (intent !== 'signin') {
    return { step: 'email', email };
  }

  // Sign in through the cookie-aware client so the session lands in the
  // browser and every later query runs as this user under RLS.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return { step: 'password', email, error: 'wrongPassword' };
  }

  // `redirect` throws; returning it keeps TypeScript happy about the signature.
  return redirect({ href: '/dashboard', locale });
}

/** Used directly as a `<form action>`; the locale rides along as a hidden field. */
export async function signOutAction(formData: FormData) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: '/login', locale: localeOf(formData) });
}
