'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/session';
import { fail, ok, requiredText, type ActionResult } from '@/lib/actions';
import { clearCredentials, consentUrl } from '@/lib/google/auth';
import { retryPendingMeetLinks } from '@/lib/google/meetings';

/**
 * Everything here is gated on `integrations.configure` in code rather than by
 * a policy, because none of it is a database write — it is an OAuth redirect,
 * a delete of a row only the service role can see, and a call out to Google.
 * The service-role client has no notion of who is asking, so this is the only
 * place the check can live. Super Admin holds the permission; nobody else does.
 */
async function requireAdmin(): Promise<string | null> {
  if (!(await hasPermission('integrations.configure'))) {
    return 'Only a Super Admin can change the club Google connection.';
  }
  return null;
}

/** Sends the Super Admin to Google's consent screen. */
export async function connectGoogleAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const denied = await requireAdmin();
  if (denied) return fail(denied);

  let url: string;
  try {
    // `state` carries the locale so the callback can come back to the right
    // language. Google returns it untouched.
    url = consentUrl(locale);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Google is not configured.');
  }

  redirect(url);
}

export async function disconnectGoogleAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const denied = await requireAdmin();
  if (denied) return fail(denied);

  await clearCredentials();
  revalidatePath(`/${locale}/admin/google`);
  return ok();
}

/** Retries whatever could not reach Google when it was confirmed. */
export async function retryMeetLinksAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = requiredText(formData, 'locale');
  const denied = await requireAdmin();
  if (denied) return fail(denied);

  const results = await retryPendingMeetLinks();
  const failures = results.filter((result) => result.status === 'failed');

  revalidatePath(`/${locale}/admin/google`);

  if (results.length === 0) return ok();
  if (failures.length > 0) {
    return fail(
      `${results.length - failures.length} of ${results.length} succeeded. ` +
        `Last problem: ${failures[failures.length - 1].error}`,
    );
  }
  return ok();
}
