'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Input, cx } from '@/components/ui';
import { formatTime, localized } from '@/lib/format';
import { normalisePhone, westernDigits } from '@/lib/interviews/phone';
import type { FloorRow, Stage } from '@/lib/interviews/types';
import { STAGE_TONES } from '@/lib/interviews/ui';
import { checkInAction, removeNoShowAction } from '../actions';

const POLL_MS = 10_000;
const MINUTE = 60_000;
/** How far ahead "Arriving soon" looks. */
const SOON_MINUTES = 45;

type Booked = FloorRow & { booking_id: string; stage: Stage };

/** Does a row answer what was typed: part of the name, or of the phone number in any spelling. */
function matches(row: Booked, typed: string): boolean {
  const needle = typed.trim().toLowerCase();
  if (!needle) return true;
  if ((row.student_name ?? '').toLowerCase().includes(needle)) return true;
  const digits = westernDigits(needle).replace(/\D/g, '');
  if (digits.length < 3) return false;
  const phone = normalisePhone(row.student_phone) ?? '';
  return phone.includes(digits) || (phone !== '' && phone === normalisePhone(needle));
}

/**
 * The door. A receptionist types a phone number or a name, sees the
 * student's interview for the day (company, room, time, how early or late),
 * and checks them in. With nothing typed it shows who is late, who is due in
 * the next three quarters of an hour, and who is already waiting. Re-reads
 * the day every ten seconds while the tab is visible, and right after every
 * press, so two desks never disagree for long.
 */
export function ReceptionBoard({
  locale,
  projectId,
  initialRows,
  pollUrl,
  isToday,
}: {
  locale: string;
  projectId: string;
  initialRows: FloorRow[];
  pollUrl: string;
  /** Lateness only means something on the day itself. */
  isToday: boolean;
}) {
  const t = useTranslations('interviews');
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date().getTime());
  const [pending, startTransition] = useTransition();
  /** The no-show whose Delete was pressed once and waits for the confirming press. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(pollUrl, { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { rows: FloorRow[] };
      setRows(body.rows);
      setNow(new Date().getTime());
    } catch {
      // A missed poll is nothing; the next one is ten seconds away.
    }
  }, [pollUrl]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const act = (bookingId: string, move: 'checkIn' | 'undo' | 'noShow' | 'undoNoShow') => {
    setError(null);
    setConfirming(null);
    startTransition(async () => {
      const result = await checkInAction({ projectId, locale, bookingId, move });
      if (!result.ok) {
        setError(
          result.hint && t.has(`errors.${result.hint}`)
            ? t(`errors.${result.hint}`)
            : (result.error ?? t('reception.refused')),
        );
      }
      await refresh();
    });
  };

  const remove = (bookingId: string) => {
    setError(null);
    setConfirming(null);
    startTransition(async () => {
      const result = await removeNoShowAction({ projectId, locale, bookingId });
      if (!result.ok) {
        setError(
          result.hint && t.has(`errors.${result.hint}`)
            ? t(`errors.${result.hint}`)
            : (result.error ?? t('reception.refused')),
        );
      }
      await refresh();
    });
  };

  const booked = rows
    .filter((r): r is Booked => Boolean(r.booking_id && r.stage))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const count = (stages: Stage[]) => booked.filter((r) => stages.includes(r.stage)).length;
  const startsIn = (row: Booked) => Math.round((new Date(row.starts_at).getTime() - now) / MINUTE);

  const searching = query.trim() !== '';
  const found = searching ? booked.filter((r) => matches(r, query)) : [];

  const late = booked.filter((r) => r.stage === 'scheduled' && startsIn(r) <= 0);
  const soon = booked.filter((r) => r.stage === 'scheduled' && startsIn(r) > 0 && startsIn(r) <= SOON_MINUTES);
  const waiting = booked.filter((r) => r.stage === 'arrived');
  const noShows = booked.filter((r) => r.stage === 'no_show');

  const when = (row: Booked) => {
    if (!isToday || row.stage !== 'scheduled') return null;
    const minutes = startsIn(row);
    if (minutes > 0) return <span className="text-xs text-ink-muted">{t('reception.inMinutes', { minutes })}</span>;
    if (minutes === 0) return <span className="text-xs font-semibold text-warn">{t('reception.now')}</span>;
    return <span className="text-xs font-semibold text-danger">{t('reception.lateBy', { minutes: -minutes })}</span>;
  };

  const row = (r: Booked) => (
    <li key={r.booking_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span className="ltr-nums w-14 shrink-0 text-base font-semibold">{formatTime(r.starts_at, locale)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{r.student_name}</span>
        <span className="block truncate text-sm font-semibold text-brand-700">
          {localized({ name_en: r.company_name_en, name_ar: r.company_name_ar }, 'name', locale)}
        </span>
        <span className="block truncate text-xs text-ink-muted">
          {r.room_name}
          {r.student_phone ? (
            <>
              {' · '}
              <span className="ltr-nums" dir="ltr">
                {r.student_phone}
              </span>
            </>
          ) : null}
        </span>
      </span>
      {when(r)}
      <Badge tone={STAGE_TONES[r.stage]}>{t(`stage.${r.stage}`)}</Badge>
      {r.stage === 'scheduled' ? (
        <span className="flex flex-wrap gap-1">
          <Button type="button" disabled={pending} onClick={() => act(r.booking_id, 'checkIn')}>
            {t('reception.checkIn')}
          </Button>
          {confirming === `ns-${r.booking_id}` ? (
            <>
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => act(r.booking_id, 'noShow')}
                className="px-2.5 py-1 text-xs"
              >
                {t('reception.noShowConfirm')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirming(null)}
                className="px-2.5 py-1 text-xs"
              >
                {t('floor.deleteKeep')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirming(`ns-${r.booking_id}`)}
              className="px-2.5 py-1 text-xs"
            >
              {t('stage.no_show')}
            </Button>
          )}
        </span>
      ) : r.stage === 'arrived' ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => act(r.booking_id, 'undo')}
          className="px-2.5 py-1 text-xs"
        >
          ↶ {t('reception.undo')}
        </Button>
      ) : r.stage === 'no_show' ? (
        confirming === r.booking_id ? (
          <span className="flex gap-1">
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => remove(r.booking_id)}
              className="px-2.5 py-1 text-xs"
            >
              {t('floor.deleteConfirm')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirming(null)}
              className="px-2.5 py-1 text-xs"
            >
              {t('floor.deleteKeep')}
            </Button>
          </span>
        ) : (
          <span className="flex gap-1">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => act(r.booking_id, 'undoNoShow')}
              className="px-2.5 py-1 text-xs"
            >
              ↶ {t('reception.undoNoShow')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => setConfirming(r.booking_id)}
              className="px-2.5 py-1 text-xs"
            >
              {t('floor.delete')}
            </Button>
          </span>
        )
      ) : null}
    </li>
  );

  const section = (title: string, list: Booked[], tone?: 'danger') => (
    <section className="space-y-2">
      <h2 className={cx('text-sm font-semibold', tone === 'danger' && 'text-danger')}>
        {title} <span className="ltr-nums text-ink-muted">({list.length})</span>
      </h2>
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <ul className="divide-y divide-line">
          {list.length ? list.map(row) : <li className="px-4 py-6 text-center text-sm text-ink-muted">{t('reception.nobody')}</li>}
        </ul>
      </div>
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="neutral">
          {t('reception.expected')} {booked.length}
        </Badge>
        <Badge tone="neutral">
          {t('stage.scheduled')} {count(['scheduled'])}
        </Badge>
        <Badge tone={STAGE_TONES.arrived}>
          {t('reception.waiting')} {count(['arrived'])}
        </Badge>
        <Badge tone={STAGE_TONES.in_interview}>
          {t('stage.in_interview')} {count(['in_interview'])}
        </Badge>
        <Badge tone={STAGE_TONES.done}>
          {t('stage.done')} {count(['done'])}
        </Badge>
        <Badge tone={STAGE_TONES.no_show}>
          {t('stage.no_show')} {count(['no_show'])}
        </Badge>
      </div>

      <Input
        type="search"
        inputMode="search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('reception.search')}
        aria-label={t('reception.search')}
        className="py-3 text-lg!"
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {searching ? (
        section(t('reception.results'), found)
      ) : isToday ? (
        <>
          {section(t('reception.late'), late, 'danger')}
          {section(t('reception.soon', { minutes: SOON_MINUTES }), soon)}
          {section(t('reception.waitingList'), waiting)}
          {noShows.length ? section(t('reception.noShows'), noShows) : null}
        </>
      ) : (
        <>
          <Alert tone="warn">{t('reception.notToday')}</Alert>
          {section(t('reception.allOfDay'), booked)}
        </>
      )}

      <p className="text-xs text-ink-muted">{t('reception.refreshes')}</p>
    </div>
  );
}
