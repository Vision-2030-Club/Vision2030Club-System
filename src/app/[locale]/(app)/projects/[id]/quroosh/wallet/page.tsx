import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { StatTile } from '@/components/charts/BarList';
import { Alert, Badge, Card, EmptyState, Input, Label, PageHeader } from '@/components/ui';
import { eventDay } from '@/lib/eventAttendance/links';
import { formatDateTime, localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import {
  formatQuroosh,
  formatSigned,
  getAttendancePoints,
  getLeaderboard,
  type LedgerRow,
  type WalletTotals,
} from '@/lib/quroosh/wallet';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { recountWalletAction, saveWalletSettingsAction } from './actions';

/** How many ledger rows the page shows. */
const SHOWN = 200;

/**
 * Quroosh and the ledger (Quroosh 0007), for the project's managers only:
 * how many quroosh have been handed out, what a day's attendance is worth,
 * who is ahead, and the latest entries of the ledger with full names.
 */
export default async function QurooshWalletPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const header = <PageHeader title={t('wallet.title')} description={localized(access.project, 'name', locale)} />;
  if (!isQurooshConfigured()) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const db = createQurooshClient();
  const [totalsResult, ledgerResult, perDay, top] = await Promise.all([
    db.rpc('wallet_totals', { p_project: id }),
    db.rpc('wallet_ledger', { p_project: id, p_limit: SHOWN }),
    getAttendancePoints(id),
    getLeaderboard(id, 10),
  ]);
  // Before 0007 is applied the functions do not exist: say so, do not crash.
  if (totalsResult.error || ledgerResult.error || perDay === null) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('wallet.notReady')}</Alert>
      </>
    );
  }

  const totals = ((totalsResult.data ?? []) as WalletTotals[])[0];
  const distributed = Number(totals?.distributed ?? 0);
  const holders = Number(totals?.holders ?? 0);
  const ledger = (ledgerResult.data ?? []) as LedgerRow[];

  return (
    <div className="space-y-6">
      {header}
      <p className="text-sm text-ink-muted">{t('wallet.intro')}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t('wallet.distributed')} value={formatQuroosh(distributed)} />
        <StatTile label={t('wallet.holders')} value={formatQuroosh(holders)} />
        <StatTile
          label={t('wallet.average')}
          value={formatQuroosh(holders > 0 ? Math.round(distributed / holders) : 0)}
        />
      </div>

      <Card className="space-y-6">
        <ActionForm action={saveWalletSettingsAction} submitLabel={t('wallet.save')}>
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <div className="max-w-xs">
            <Label htmlFor="attendance-points">{t('wallet.perDay')}</Label>
            <Input
              id="attendance-points"
              name="attendance_points"
              type="number"
              inputMode="numeric"
              min={0}
              max={1000000}
              step={1}
              defaultValue={perDay}
              dir="ltr"
              required
            />
          </div>
          <p className="text-xs text-ink-muted">{t('wallet.perDayHint')}</p>
        </ActionForm>

        <ActionForm
          action={recountWalletAction}
          submitLabel={t('wallet.recount')}
          successText={t('wallet.recounted')}
          variant="secondary"
        >
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <p className="text-xs text-ink-muted">{t('wallet.recountHint')}</p>
        </ActionForm>
      </Card>

      {top && top.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">{t('wallet.topTitle')}</h2>
          <ol className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {top.map((row) => (
              <li key={row.account_id} className="flex items-center gap-3 p-3">
                <span className="ltr-nums w-8 shrink-0 text-center text-sm font-bold tabular-nums text-ink-muted">
                  {row.position}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{row.name}</span>
                <span className="ltr-nums font-semibold tabular-nums text-ink" dir="ltr">
                  {formatQuroosh(row.earned)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-semibold text-ink">{t('wallet.ledgerTitle')}</h2>
        {ledger.length >= SHOWN ? <p className="text-sm text-ink-muted">{t('wallet.shown', { shown: SHOWN })}</p> : null}
        {ledger.length === 0 ? (
          <EmptyState>{t('wallet.empty')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <span className="font-medium text-ink">{entry.name}</span>
                <Badge tone={entry.voided_at ? 'neutral' : 'brand'}>{t(`wallet.kind.${entry.kind}`)}</Badge>
                {entry.voided_at ? <Badge tone="warn">{t('wallet.voided')}</Badge> : null}
                <span className="text-xs text-ink-muted">
                  {entry.day ? eventDay(entry.day, locale) : formatDateTime(entry.created_at, locale)}
                </span>
                <span
                  className={`ltr-nums ms-auto font-semibold tabular-nums ${
                    entry.voided_at ? 'text-ink-muted line-through' : 'text-ink'
                  }`}
                  dir="ltr"
                >
                  {formatSigned(entry.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
