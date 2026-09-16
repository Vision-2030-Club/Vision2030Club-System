'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Input, cx } from '@/components/ui';
import type { FloorRow, Stage } from '@/lib/interviews/types';
import { FORWARD_MOVES, ORGANIZER_MOVES, STAGE_TONES } from '@/lib/interviews/ui';
import { stageAction } from '../actions';

const POLL_MS = 12_000;
const ALL_STAGES: Stage[] = ['scheduled', 'arrived', 'in_interview', 'done', 'no_show'];

function timeLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * The live list. Re-fetches every twelve seconds while the tab is visible,
 * and right after any button press, so what an organizer at the door sees
 * is what the one in the corridor did a moment ago.
 */
export function FloorBoard({
  locale,
  projectId,
  initialRows,
  pollUrl,
  canAct,
  isManager,
}: {
  locale: string;
  projectId: string;
  initialRows: FloorRow[];
  pollUrl: string;
  canAct: boolean;
  isManager: boolean;
}) {
  const t = useTranslations('interviews');
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date().getTime());
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(pollUrl, { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { rows: FloorRow[] };
      setRows(body.rows);
      setNow(new Date().getTime());
    } catch {
      // A missed poll is nothing; the next one is twelve seconds away.
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

  const move = (bookingId: string, to: Stage) => {
    setError(null);
    startTransition(async () => {
      const result = await stageAction({ projectId, locale, bookingId, to });
      if (!result.ok) setError(result.error ?? 'Refused');
      await refresh();
    });
  };

  const needle = filter.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      !needle ||
      (row.student_name ?? '').toLowerCase().includes(needle) ||
      (row.student_phone ?? '').includes(needle),
  );

  const booked = rows.filter((r) => r.booking_id);
  const summary = ALL_STAGES.map((stage) => ({
    stage,
    n: booked.filter((r) => r.stage === stage).length,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('floor.search')}
          aria-label={t('floor.search')}
          className="max-w-xs"
        />
        <div className="ms-auto flex flex-wrap gap-1 text-xs">
          {summary.map(({ stage, n }) => (
            <Badge key={stage} tone={STAGE_TONES[stage]}>
              {t(`stage.${stage}`)} {n}
            </Badge>
          ))}
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <ul className="divide-y divide-line">
          {visible.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-ink-muted">{t('floor.empty')}</li>
          ) : null}
          {visible.map((row) => {
            const live = new Date(row.starts_at).getTime() <= now && now < new Date(row.ends_at).getTime();
            const stage = row.stage;
            return (
              <li
                key={row.slot_id}
                className={cx('flex flex-wrap items-center gap-3 px-4 py-2.5', live && 'bg-brand-50/60')}
              >
                <span className="ltr-nums w-24 shrink-0 text-sm font-semibold">
                  {timeLabel(row.starts_at, locale)}
                </span>
                <span className="w-20 shrink-0 text-xs text-ink-muted">{row.room_name}</span>

                {row.booking_id && stage ? (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.student_name}</span>
                      {row.student_phone ? (
                        <span className="ltr-nums block text-xs text-ink-muted">{row.student_phone}</span>
                      ) : null}
                    </span>
                    <Badge tone={STAGE_TONES[stage]}>{t(`stage.${stage}`)}</Badge>

                    {canAct ? (
                      <span className="flex flex-wrap gap-1">
                        {ORGANIZER_MOVES[stage].map((to) => {
                          const forward = FORWARD_MOVES.has(`${stage}>${to}`);
                          return (
                            <Button
                              key={to}
                              type="button"
                              variant={forward ? 'primary' : to === 'no_show' ? 'danger' : 'secondary'}
                              disabled={pending}
                              onClick={() => move(row.booking_id!, to)}
                              className="px-2.5 py-1 text-xs"
                            >
                              {forward || to === 'no_show' ? t(`stage.${to}`) : `↶ ${t(`stage.${to}`)}`}
                            </Button>
                          );
                        })}
                        {isManager ? (
                          <select
                            aria-label={t('floor.setStage')}
                            value=""
                            disabled={pending}
                            onChange={(event) => {
                              if (event.target.value) move(row.booking_id!, event.target.value as Stage);
                            }}
                            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-muted"
                          >
                            <option value="">{t('floor.setStage')}</option>
                            {ALL_STAGES.filter((s) => s !== stage).map((s) => (
                              <option key={s} value={s}>
                                {t(`stage.${s}`)}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="min-w-0 flex-1 text-sm text-ink-muted">
                    {row.is_closed ? t('schedule.closed') : t('schedule.free')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-ink-muted">{t('floor.refreshes')}</p>
    </div>
  );
}
