import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Button, Card } from '@/components/ui';
import { getAttendeesById, UUID } from '@/lib/eventAttendance/api';
import type { EventPublic } from '@/lib/eventAttendance/types';
import { COUNTRIES } from '@/lib/quroosh/phones';
import { createAdminClient } from '@/lib/supabase/admin';
import { eventDay, passUrl } from '@/lib/eventAttendance/links';
import { accountHomePath, getGuestAccount } from '@/lib/quroosh/accounts';
import { getSessionPoints } from '@/lib/quroosh/sessions';
import { CLUB_TIME_ZONE } from '@/lib/time';
import {
  formatQuroosh,
  formatSigned,
  getAttendancePoints,
  getWalletEntries,
  getWalletOverview,
} from '@/lib/quroosh/wallet';
import { signOutAction } from '../actions';
import { GuestTabs } from '../GuestTabs';
import { QurooshCard, QurooshNote } from '@/components/QurooshHero';
import { MailIcon, SignInForm } from '../SignInForm';
import { SignUpForm } from '../SignUpForm';
import { StartTabs } from '../StartTabs';

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
  searchParams: Promise<{ created?: string; welcome?: string; signin?: string }>;
}) {
  const { locale, projectId } = await params;
  const { created, welcome, signin } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.account');

  const account = await getGuestAccount();
  // A session of another project's account is nobody here.
  if (account && account.project_id === projectId) {
    const [wallet, entries, perDay, perSession, pass] = await Promise.all([
      getWalletOverview(account.account_id),
      getWalletEntries(account.account_id),
      getAttendancePoints(projectId),
      // Null before 0009 is applied: the session line is left out.
      getSessionPoints(projectId),
      // Their pass is what the gate scans. Its link is theirs already (it was
      // emailed to them); trouble reading it only hides the button. A guest
      // who made their own account (0017) has no pass to show: no QR code
      // appears on their phone, so the button is left out for them.
      getAttendeesById(projectId, [account.attendee_id])
        .then((people) => (people[0] && people[0].source !== 'quroosh_signup' ? people[0].token : null))
        .catch(() => null),
    ]);
    // The event's day on the club's clock, as the ledger writes it.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: CLUB_TIME_ZONE }).format(new Date());
    // Attendance pays the first visit only (Quroosh 0010), so once paid it is done.
    const firstVisitPaid = entries.some((entry) => entry.kind === 'attendance');
    const sessionToday = entries.some((entry) => entry.kind === 'session' && entry.day === today);

    if (wallet) {
      return (
        <div className="mx-auto max-w-md space-y-5">
          {created ? <Alert tone="ok">{t('home.created')}</Alert> : null}
          {/* Just made their own account (0017): say so, with the bonus it brought. */}
          {welcome !== undefined ? (
            <Alert tone="ok">
              {/^[1-9][0-9]{0,6}$/.test(welcome)
                ? t('home.welcomeBonus', { name: account.name, bonus: formatQuroosh(Number(welcome)) })
                : t('home.welcomeNew', { name: account.name })}
            </Alert>
          ) : null}
          <GuestTabs projectId={projectId} current="wallet" />

          {/* The balance: a navy card on the light page, its number the mint that shines. */}
          <section className="rounded-3xl bg-brand-950 p-7 text-center text-brand-50 shadow-xl shadow-brand-950/20">
            <p className="text-sm text-brand-200">{account.name}</p>
            <p className="mt-3 text-sm font-medium text-accent-2">{t('wallet.balance')}</p>
            <p className="ltr-nums mt-1 text-6xl font-bold tracking-tight text-accent tabular-nums" dir="ltr">
              {formatQuroosh(wallet.balance)}
            </p>
            <p className="mt-4 inline-block rounded-full border border-brand-800 px-4 py-1.5 text-sm text-brand-50">
              {wallet.earned > 0
                ? t('wallet.place', { position: wallet.position, players: wallet.players })
                : t('wallet.noPlaceYet')}
            </p>
          </section>

          {/* Ways to earn today: one card each, framed mint once collected. */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{t('wallet.earnTitle')}</h2>
            <EarnCard
              title={t('wallet.attendance')}
              hint={firstVisitPaid ? t('wallet.attendanceDone') : t('wallet.attendanceHint')}
              amount={perDay}
              done={firstVisitPaid}
            />
            {perSession ? (
              <EarnCard
                title={t('wallet.session')}
                hint={sessionToday ? t('wallet.sessionDone') : t('wallet.sessionHint')}
                amount={perSession}
                done={sessionToday}
              />
            ) : null}
            {pass ? (
              <a
                href={passUrl(locale, pass)}
                className="flex min-h-12 items-center justify-center rounded-2xl border-2 border-line px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
              >
                {t('wallet.showPass')}
              </a>
            ) : null}
          </section>

          {/* The ledger: a clean list of small cards, a teal strip for what came in
              and the coins' purple for what went out. */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{t('wallet.ledgerTitle')}</h2>
            {entries.length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-line p-4 text-sm text-ink-muted">
                {t('wallet.ledgerEmpty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className={`flex items-center justify-between gap-3 rounded-2xl border border-line border-s-4 bg-surface px-4 py-3 ${
                      entry.amount > 0 ? 'border-s-accent-3' : 'border-s-coin'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">{t(`wallet.kind.${entry.kind}`)}</p>
                      {entry.day ? <p className="text-xs text-ink-muted">{eventDay(entry.day, locale)}</p> : null}
                    </div>
                    <span
                      className={`ltr-nums font-bold tabular-nums ${entry.amount > 0 ? 'text-accent-3' : 'text-ink-muted'}`}
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

  // Nobody signed in: make an account (0017) or sign in to one. Making one
  // needs the event's sign-up to be open (Event attendance's switch); when it
  // is not, or the project has no Event attendance, only signing in is offered.
  const [signupOpen, tStart] = await Promise.all([eventSignupOpen(projectId), getTranslations('quroosh.account.start')]);
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const countries = COUNTRIES.map(([iso, dial]) => ({ iso, dial, name: regionNames.of(iso) ?? iso }));
  const signInCard = (
    <QurooshCard icon={<MailIcon className="size-5" />} title={t('signIn.cardTitle')}>
      <SignInForm
        locale={locale}
        projectId={projectId}
        look={{ label: t('signIn.email'), hint: t('signIn.hint'), submit: t('signIn.submit') }}
      />
    </QurooshCard>
  );

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-balance text-3xl font-bold text-ink">{t('signIn.title')}</h1>
        <p className="mt-2 text-base text-ink-muted">{signupOpen ? tStart('intro') : t('signIn.intro')}</p>
      </div>
      {signupOpen ? (
        <StartTabs
          initial={signin ? 'signin' : 'signup'}
          labels={{ label: tStart('label'), signup: tStart('signup'), signin: tStart('signin') }}
          signUp={
            <QurooshCard icon={<UserPlusIcon />} title={tStart('cardTitle')}>
              <SignUpForm
                projectId={projectId}
                locale={locale}
                countries={countries}
                signInHref={`${accountHomePath(projectId)}?signin=1`}
              />
            </QurooshCard>
          }
          signIn={signInCard}
        />
      ) : (
        <>
          {signInCard}
          <QurooshNote>{t('signIn.howToGet')}</QurooshNote>
        </>
      )}
    </div>
  );
}

/** Whether the project's event takes sign-ups (Event attendance, club database). False when it cannot tell. */
async function eventSignupOpen(projectId: string): Promise<boolean> {
  if (!UUID.test(projectId)) return false;
  const { data } = await createAdminClient().rpc('event_public', { p_project: projectId });
  return (data as EventPublic[] | null)?.[0]?.signup_open === true;
}

function UserPlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M18 8v6M15 11h6" />
    </svg>
  );
}

/**
 * One way to earn quroosh today, as its own card: framed in mint with a thick
 * strip on the reading side once collected, in lavender while still to do.
 */
function EarnCard({
  title,
  hint,
  amount,
  done,
}: {
  title: string;
  hint: string;
  amount: number | null;
  done: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-2xl border-2 border-s-[6px] bg-surface p-5 ${
        done ? 'border-accent border-s-accent-3' : 'border-brand-200 border-s-brand-300'
      }`}
    >
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{hint}</p>
      </div>
      {amount ? (
        <span
          className={`ltr-nums shrink-0 text-xl font-bold tabular-nums ${done ? 'text-accent-3' : 'text-ink'}`}
          dir="ltr"
        >
          {formatSigned(amount)}
        </span>
      ) : null}
    </div>
  );
}
