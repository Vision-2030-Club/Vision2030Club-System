'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, Input, cx } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { EventAttendeeMatch } from '@/lib/eventAttendance/types';
import {
  checkInByIdAction,
  findAttendeesAction,
  undoCheckInAction,
} from '../../event-attendance/actions';

/** What the last press came to, shown large for the person at the desk. */
type Outcome = {
  tone: 'ok' | 'warn' | 'danger';
  title: string;
  detail?: string;
  /** Set when this outcome is a check-in made just now: it can be undone. */
  undo?: string;
};

/** How often the numbers and the arrivals below are read again. */
const REFRESH_SECONDS = 30;

/**
 * The reception desk's working part: find an attendee by name or the end of
 * their mobile, and check them in for today. The same server actions as the
 * gate scanner's search (Event attendance, 0075), so the database decides
 * who may do it, refuses a pass of the person's own (0077), and records it
 * as `manual`.
 *
 * The numbers and the arrivals around it are the server's: the page is read
 * again after every change and every half minute while it is on screen.
 */
export function ReceptionDesk({ projectId, locale }: { projectId: string; locale: string }) {
  const t = useTranslations('quroosh.reception');
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [matches, setMatches] = useState<EventAttendeeMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [router]);

  const mark = (attendeeId: string, checkedIn: boolean) =>
    setMatches((rows) => rows?.map((row) => (row.id === attendeeId ? { ...row, checked_in_today: checkedIn } : row)) ?? null);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    if (query.length < 3) {
      setMatches(null);
      return;
    }
    setSearching(true);
    try {
      const found = await findAttendeesAction(projectId, query);
      if (found.ok) setMatches(found.matches);
      else setOutcome({ tone: 'danger', title: t('failed') });
    } catch {
      setOutcome({ tone: 'danger', title: t('network') });
    } finally {
      setSearching(false);
    }
  };

  const checkIn = async (attendeeId: string) => {
    setWorking(true);
    try {
      const result = await checkInByIdAction(projectId, locale, attendeeId);
      if (!result.ok || !result.data) {
        setOutcome({ tone: 'danger', title: result.error ?? t('failed') });
        return;
      }
      mark(attendeeId, true);
      if (result.data.result === 'already') {
        setOutcome({ tone: 'warn', title: result.data.name, detail: t('already', { time: result.data.time }) });
      } else {
        setOutcome({ tone: 'ok', title: result.data.name, detail: t('checkedIn'), undo: attendeeId });
      }
      router.refresh();
    } catch {
      setOutcome({ tone: 'danger', title: t('network') });
    } finally {
      setWorking(false);
    }
  };

  const undo = async (attendeeId: string) => {
    setWorking(true);
    try {
      const result = await undoCheckInAction(projectId, locale, attendeeId);
      if (result.ok) {
        mark(attendeeId, false);
        setOutcome({ tone: 'warn', title: t('undone') });
        router.refresh();
      } else {
        setOutcome({ tone: 'danger', title: result.error ?? t('failed') });
      }
    } catch {
      setOutcome({ tone: 'danger', title: t('network') });
    } finally {
      setWorking(false);
    }
  };

  const outcomeStyles = {
    ok: 'border-ok/40 bg-ok/10 text-ok',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    danger: 'border-danger/40 bg-danger/10 text-danger',
  } as const;

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold text-ink">{t('search.title')}</h2>
        <p className="mt-1 text-xs text-ink-muted">{t('search.hint')}</p>
      </div>
      <form onSubmit={search} className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-0 flex-1">
          <Input
            name="q"
            type="search"
            minLength={3}
            required
            autoComplete="off"
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
          />
        </div>
        <Button type="submit" disabled={searching}>
          {t('search.submit')}
        </Button>
      </form>

      {/* Announced to a screen reader as it changes. */}
      <div aria-live="assertive">
        {outcome ? (
          <div className={cx('rounded-xl border-2 px-4 py-4 text-center', outcomeStyles[outcome.tone])}>
            <p className="text-balance text-xl font-bold">{outcome.title}</p>
            {outcome.detail ? <p className="mt-1 text-sm font-medium">{outcome.detail}</p> : null}
            {outcome.undo ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                disabled={working}
                onClick={() => undo(outcome.undo as string)}
              >
                {t('undo')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {matches === null ? null : matches.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('search.empty')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {matches.map((match) => (
            <li key={match.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
              <span className="font-medium text-ink">{match.name}</span>
              <span className="ltr-nums text-sm text-ink-muted" dir="ltr">
                ••• {match.phone_tail}
              </span>
              <span className="ms-auto">
                {match.cancelled ? (
                  <Badge tone="danger">{t('search.cancelled')}</Badge>
                ) : match.checked_in_today ? (
                  <Badge tone="ok">{t('search.checkedInToday')}</Badge>
                ) : (
                  <Button type="button" disabled={working} onClick={() => checkIn(match.id)}>
                    {t('search.checkIn')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
