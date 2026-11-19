import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Button, Card, Input, Label } from '@/components/ui';
import { getAttendeesById } from '@/lib/eventAttendance/api';
import { eventDay, passUrl } from '@/lib/eventAttendance/links';
import { getGuestAccount } from '@/lib/quroosh/accounts';
import { CLUB_TIME_ZONE } from '@/lib/time';
import {
  formatQuroosh,
  formatSigned,
  getAttendancePoints,
  getWalletEntries,
  getWalletOverview,
} from '@/lib/quroosh/wallet';
import { requestSignInAction, signOutAction } from '../actions';
import { GuestTabs } from '../GuestTabs';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A guest's Quroosh account: /quroosh/account/<club project id> (Quroosh 0006).
 *
 * Signed in (the session cookie belongs to an account of this project): their
 * wallet (Quroosh 0007). The balance, their place among the guests, how to
 * earn today, and every entry of their ledger. Before 0007 is applied the
 * page says the account is ready and nothing more.
 *
 * Not signed in: one field, their email, and a sign-in link is sent to it.
 * The page says the same thing whether or not that email has an account.
 */
export default async function QurooshAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale, projectId } = await params;
  const { created } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.account');

  const account = await getGuestAccount();
  // A session of another project's account is nobody here.
  if (account && account.project_id === projectId) {
    const [wallet, entries, perDay, pass] = await Promise.all([
      getWalletOverview(account.account_id),
      getWalletEntries(account.account_id),
      getAttendancePoints(projectId),
      // Their pass is what the gate scans. Its link is theirs already (it was
      // emailed to them); trouble reading it only hides the button.
      getAttendeesById(projectId, [account.attendee_id])
        .then((people) => people[0]?.token ?? null)
        .catch(() => null),
    ]);
    // The event's day on the club's clock, as the ledger writes it.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: CLUB_TIME_ZONE }).format(new Date());
    const paidToday = entries.some((entry) => entry.kind === 'attendance' && entry.day === today);

    if (wallet) {
      return (
        <div className="mx-auto max-w-md space-y-5">
          {created ? <Alert tone="ok">{t('home.created')}</Alert> : null}
          <GuestTabs projectId={projectId} current="wallet" />

          <section className="rounded-2xl bg-brand-950 p-6 text-center text-brand-50 shadow-sm">
            <p className="text-sm text-brand-200">{account.name}</p>
            <p className="mt-3 text-sm font-medium text-accent-2">{t('wallet.balance')}</p>
            <p className="ltr-nums mt-1 text-5xl font-bold tracking-tight tabular-nums" dir="ltr">
              {formatQuroosh(wallet.balance)}
            </p>
            <p className="mt-3 text-sm text-brand-100">
              {wallet.earned > 0
                ? t('wallet.place', { position: wallet.position, players: wallet.players })
                : t('wallet.noPlaceYet')}
            </p>
          </section>

          <Card className="space-y-3">
            <h2 className="font-semibold text-ink">{t('wallet.earnTitle')}</h2>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">{t('wallet.attendance')}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {paidToday ? t('wallet.attendanceDone') : t('wallet.attendanceHint')}
                </p>
              </div>
              {perDay ? (
                <span
                  className={`ltr-nums shrink-0 font-semibold tabular-nums ${paidToday ? 'text-ok' : 'text-ink'}`}
                  dir="ltr"
                >
                  {formatSigned(perDay)}
                </span>
              ) : null}
            </div>
            {pass ? (
              <a
                href={passUrl(locale, pass)}
                className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
              >
                {t('wallet.showPass')}
              </a>
            ) : null}
          </Card>

          <section className="space-y-2">
            <h2 className="font-semibold text-ink">{t('wallet.ledgerTitle')}</h2>
            {entries.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">
                {t('wallet.ledgerEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-ink">{t(`wallet.kind.${entry.kind}`)}</p>
                      {entry.day ? <p className="text-xs text-ink-muted">{eventDay(entry.day, locale)}</p> : null}
                    </div>
                    <span
                      className={`ltr-nums font-semibold tabular-nums ${entry.amount > 0 ? 'text-ok' : 'text-ink'}`}
                      dir="ltr"
                    >
                      {formatSigned(entry.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={projectId} />
            <Button type="submit" variant="secondary">
              {t('home.signOut')}
            </Button>
          </form>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-md space-y-5">
        {created ? <Alert tone="ok">{t('home.created')}</Alert> : null}
        <div>
          <p className="text-sm text-ink-muted">{t('home.welcome')}</p>
          <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-ink">{account.name}</h1>
          <p className="ltr-nums mt-1 break-all text-sm text-ink-muted" dir="ltr">
            {account.email}
          </p>
        </div>
        <Card>
          <h2 className="font-semibold text-ink">{t('home.readyTitle')}</h2>
          <p className="mt-2 text-sm text-ink-muted">{t('home.readyBody')}</p>
        </Card>
        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="project_id" value={projectId} />
          <Button type="submit" variant="secondary">
            {t('home.signOut')}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">{t('signIn.title')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t('signIn.intro')}</p>
      </div>
      <Card>
        <ActionForm action={requestSignInAction} submitLabel={t('signIn.submit')} successText={t('signIn.sent')}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="project_id" value={projectId} />
          {/* Hidden from people, tempting to bots. */}
          <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
            <label htmlFor="signin-website">Website</label>
            <input id="signin-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="signin-email">{t('signIn.email')}</Label>
            <Input
              id="signin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              required
              maxLength={254}
            />
          </div>
        </ActionForm>
      </Card>
      <p className="text-xs text-ink-muted">{t('signIn.howToGet')}</p>
    </div>
  );
}
