import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { StatTile } from '@/components/charts/BarList';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { isEmailConfigured } from '@/lib/email/resend';
import { formatDate, formatDateTime, localized } from '@/lib/format';
import { getMyComponentAccess } from '@/lib/interviews/access';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { accountHomePath, type AccountRow } from '@/lib/quroosh/accounts';
import { siteUrl } from '@/lib/site';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { CopyField } from '../../interviews/CopyField';
import { GuestStartQr } from '../GuestStartQr';
import { resendAccountEmailAction, syncAccountsAction } from './actions';

/** How many rows the page shows. */
const SHOWN = 300;

type Status = 'completed' | 'emailed' | 'failed' | 'waiting' | 'disabled';
const STATUS_TONE: Record<Status, 'ok' | 'brand' | 'danger' | 'warn' | 'neutral'> = {
  completed: 'ok',
  emailed: 'brand',
  failed: 'danger',
  waiting: 'warn',
  disabled: 'neutral',
};

function statusOf(row: AccountRow): Status {
  if (row.disabled_at) return 'disabled';
  if (row.completed_at) return 'completed';
  if (row.emailed_at) return 'emailed';
  return row.email_error ? 'failed' : 'waiting';
}

/**
 * The guests' accounts of the project's Quroosh event (Quroosh 0006), for
 * its managers only: everyone who was checked in at the gate, whether their
 * "complete your account" email went out, and whether they completed it.
 *
 * Accounts are made by themselves after each check-in and on the
 * five-minute sweep; "Read the check-ins now" does the same pass at once.
 */
export default async function QurooshAccountsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const header = <PageHeader title={t('accounts.title')} description={localized(access.project, 'name', locale)} />;
  if (!isQurooshConfigured()) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const { data, error } = await createQurooshClient().rpc('account_list', { p_project: id });
  // Before 0006 is applied the function does not exist: say so, do not crash.
  if (error) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('accounts.notReady')}</Alert>
      </>
    );
  }

  const accounts = (data ?? []) as AccountRow[];
  const shown = accounts.slice(0, SHOWN);
  const completed = accounts.filter((a) => a.completed_at && !a.disabled_at).length;
  const waiting = accounts.filter((a) => statusOf(a) === 'waiting' || statusOf(a) === 'failed').length;
  // A manager of the project may open every component it carries.
  const hasAttendance = (await getMyComponentAccess()).some(
    (c) => c.project_id === id && c.component_key === 'event_attendance',
  );

  return (
    <div className="space-y-6">
      {header}
      <p className="text-sm text-ink-muted">{t('accounts.intro')}</p>

      {hasAttendance ? null : <Alert tone="warn">{t('accounts.needsAttendance')}</Alert>}
      {isEmailConfigured() ? null : <Alert tone="warn">{t('accounts.emailOff')}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t('accounts.total')} value={String(accounts.length)} />
        <StatTile label={t('accounts.completedCount')} value={String(completed)} tone="ok" />
        <StatTile
          label={t('accounts.waitingCount')}
          value={String(waiting)}
          tone={waiting > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <GuestStartQr projectId={id} locale={locale} />

      <Card className="space-y-4">
        <CopyField label={t('accounts.signInLink')} value={`${siteUrl()}/${locale}${accountHomePath(id)}`} />
        <p className="text-xs text-ink-muted">{t('accounts.signInLinkHint')}</p>
        {hasAttendance ? (
          <ActionForm
            action={syncAccountsAction}
            submitLabel={t('accounts.sync')}
            successText={t('accounts.synced')}
            variant="secondary"
          >
            <input type="hidden" name="project_id" value={id} />
            <input type="hidden" name="locale" value={locale} />
            <p className="text-xs text-ink-muted">{t('accounts.syncHint')}</p>
          </ActionForm>
        ) : null}
      </Card>

      <div className="space-y-3">
        {accounts.length > shown.length ? (
          <p className="text-sm text-ink-muted">{t('accounts.shown', { shown: shown.length, total: accounts.length })}</p>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState>{t('accounts.empty')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {shown.map((account) => {
              const status = statusOf(account);
              return (
                <li key={account.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-ink">{account.name}</span>
                    <Badge tone={STATUS_TONE[status]}>{t(`accounts.status.${status}`)}</Badge>
                    <span className="ms-auto text-xs text-ink-muted">
                      {t('accounts.checkedIn', { date: formatDateTime(account.checked_in_at, locale) })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                    <span className="ltr-nums break-all" dir="ltr">
                      {account.email}
                    </span>
                    {account.phone ? (
                      <span className="ltr-nums" dir="ltr">
                        {account.phone}
                      </span>
                    ) : null}
                    {account.completed_at ? (
                      <span>{t('accounts.completedOn', { date: formatDate(account.completed_at, locale) })}</span>
                    ) : null}
                  </div>
                  {status === 'failed' && account.email_error ? (
                    <p className="ltr-nums break-all text-xs text-danger" dir="ltr">
                      {account.email_error}
                    </p>
                  ) : null}
                  {status === 'disabled' ? null : (
                    <ActionForm
                      action={resendAccountEmailAction}
                      submitLabel={account.completed_at ? t('accounts.resendSignIn') : t('accounts.resendComplete')}
                      successText={t('accounts.resent')}
                      variant="secondary"
                    >
                      <input type="hidden" name="project_id" value={id} />
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="account_id" value={account.id} />
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
