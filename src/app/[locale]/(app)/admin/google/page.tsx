import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { headers } from 'next/headers';
import {
  expectedRedirectUri,
  getCredentials,
  isGoogleConfigured,
  redirectUri,
} from '@/lib/google/auth';
import {
  connectGoogleAction,
  disconnectGoogleAction,
  retryMeetLinksAction,
} from './actions';

/** Codes the OAuth callback can come back with. */
const RESULT_TONES: Record<string, 'ok' | 'danger'> = {
  connected: 'ok',
};

export default async function AdminGooglePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { locale } = await params;
  const { result } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('google');
  const tCommon = await getTranslations('common');

  if (!(await hasPermission('integrations.configure'))) {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState>{tCommon('notPermitted')}</EmptyState>
      </>
    );
  }

  const configured = isGoogleConfigured();
  const credentials = configured ? await getCredentials() : null;

  // How much work is waiting. Read with the service role because
  // `meeting_details` rows for meetings this admin is not party to are not
  // theirs to see through the ordinary client.
  const admin = createAdminClient();
  const { count: waiting } = await admin
    .from('meeting_details')
    .select('request_id', { count: 'exact', head: true })
    .in('meet_state', ['pending', 'failed']);

  /*
   * Show the URL even when nothing is configured. It used to render as "—"
   * exactly when somebody needed to paste it into the Cloud console, because
   * `redirectUri()` throws on a missing setting.
   */
  let callbackUrl: string;
  try {
    callbackUrl = redirectUri();
  } catch {
    const requestHeaders = await headers();
    const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? '';
    const proto = requestHeaders.get('x-forwarded-proto') ?? 'https';
    callbackUrl = host ? expectedRedirectUri(`${proto}://${host}`) : '—';
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {result ? (
        <div className="mb-4">
          <Alert tone={RESULT_TONES[result] ?? 'danger'}>
            {result === 'connected' ? t('connected') : t('failed', { code: result })}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">{t('status')}</h2>

          {!configured ? (
            <>
              <Alert tone="warn">{t('notConfigured')}</Alert>
              <div className="mt-4 space-y-2 text-sm text-ink-muted">
                <p>{t('setupIntro')}</p>
                <ol className="ms-4 list-decimal space-y-1">
                  <li>{t('setupStep1')}</li>
                  <li>{t('setupStep2')}</li>
                  <li>{t('setupStep3')}</li>
                  <li>{t('setupStep4')}</li>
                </ol>
                <p className="pt-2">
                  {t('redirectLabel')}:{' '}
                  <code
                    className="select-all rounded bg-surface-muted px-1.5 py-0.5 text-xs"
                    dir="ltr"
                  >
                    {callbackUrl}
                  </code>
                </p>
              </div>
            </>
          ) : credentials ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone="ok">{t('linked')}</Badge>
                <span className="text-sm text-ink" dir="ltr">
                  {credentials.google_email ?? '—'}
                </span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-muted">{t('connectedAt')}</dt>
                <dd>{formatDateTime(credentials.connected_at, locale)}</dd>
                <dt className="text-ink-muted">{t('clubCalendar')}</dt>
                <dd>{credentials.calendar_id ? t('calendarReady') : t('calendarOnFirstUse')}</dd>
              </dl>

              <p className="mt-3 text-xs text-ink-muted">{t('calendarNote')}</p>

              <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
                <ActionForm
                  action={connectGoogleAction}
                  submitLabel={t('reconnect')}
                  variant="secondary"
                >
                  <input type="hidden" name="locale" value={locale} />
                </ActionForm>
                <ActionForm
                  action={disconnectGoogleAction}
                  submitLabel={t('disconnect')}
                  variant="danger"
                >
                  <input type="hidden" name="locale" value={locale} />
                </ActionForm>
              </div>
            </>
          ) : (
            <>
              <Alert tone="warn">{t('notLinked')}</Alert>
              <p className="mt-3 text-sm text-ink-muted">{t('connectHint')}</p>
              <div className="mt-4">
                <ActionForm action={connectGoogleAction} submitLabel={t('connect')}>
                  <input type="hidden" name="locale" value={locale} />
                </ActionForm>
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('pending')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('pendingHint')}</p>

          <div className="mb-4 text-3xl font-semibold tabular-nums text-ink">{waiting ?? 0}</div>

          <ActionForm action={retryMeetLinksAction} submitLabel={t('retry')} variant="secondary">
            <input type="hidden" name="locale" value={locale} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
