'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Card, Input, Select } from '@/components/ui';
import { formatTime, localized } from '@/lib/format';
import type { ActionResult } from '@/lib/actions';
import { DECISION_TONES, STAGE_TONES } from '@/lib/interviews/ui';
import type { QueueItem, WalkinQueue as Queue } from '@/lib/interviews/walkins';
import { confirmWalkinAction, rejectWalkinAction, reopenWalkinAction } from '../actions';

const POLL_MS = 10_000;

/**
 * Walk-ins waiting at the desk (0016). Each request shows who it is, the one
 * company they asked for, and what they already have from the online
 * application (HR's decisions, interviews booked), so the receptionist sees
 * it before confirming. Confirm takes one of that company's free times
 * today; the database refuses one that has started or been taken meanwhile.
 * Today's decided requests sit underneath, each with Undo.
 */
export function WalkinQueue({
  locale,
  projectId,
  initial,
}: {
  locale: string;
  projectId: string;
  initial: Queue;
}) {
  const t = useTranslations('interviews');
  const [queue, setQueue] = useState(initial);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date().getTime());
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/interviews/walkins?project=${projectId}`, { cache: 'no-store' });
      if (!response.ok) return;
      setQueue((await response.json()) as Queue);
      setNow(new Date().getTime());
    } catch {
      // The next poll is ten seconds away.
    }
  }, [projectId]);

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

  const run = (action: () => Promise<ActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
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

  const company = (item: QueueItem) =>
    localized({ name_en: item.company_name_en, name_ar: item.company_name_ar }, 'name', locale);

  const history = (item: QueueItem) => {
    if (!item.history) return <p className="text-xs text-ink-muted">{t('walkins.newStudent')}</p>;
    return (
      <div className="space-y-1 text-xs">
        {item.history.decisions.length ? (
          <p className="flex flex-wrap items-center gap-1">
            <span className="text-ink-muted">{t('walkins.appliedOnline')}</span>
            {item.history.decisions.map((d, i) => (
              <Badge key={i} tone={DECISION_TONES[d.decision]}>
                {localized({ name_en: d.company_name_en, name_ar: d.company_name_ar }, 'name', locale)} ·{' '}
                {t(`decision.${d.decision}`)}
              </Badge>
            ))}
          </p>
        ) : null}
        {item.history.interviews.length ? (
          <p className="flex flex-wrap items-center gap-1">
            <span className="text-ink-muted">{t('walkins.hasInterviews')}</span>
            {item.history.interviews.map((b, i) => (
              <Badge key={i} tone={STAGE_TONES[b.stage]}>
                {localized({ name_en: b.company_name_en, name_ar: b.company_name_ar }, 'name', locale)}{' '}
                <span className="ltr-nums">{formatTime(b.starts_at, locale)}</span>
              </Badge>
            ))}
          </p>
        ) : null}
      </div>
    );
  };

  if (!queue.ready) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">
        {t('walkins.title')} <span className="ltr-nums text-ink-muted">({queue.pending.length})</span>
      </h2>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {queue.pending.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('walkins.none')}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {queue.pending.map((item) => {
            const times = queue.times[item.company_id] ?? [];
            const slot = times.some((s) => s.slot_id === chosen[item.id]) ? chosen[item.id] : (times[0]?.slot_id ?? '');
            const minutes = Math.max(0, Math.round((now - new Date(item.created_at).getTime()) / 60_000));
            return (
              <Card key={item.id}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <span className="ltr-nums text-2xl font-semibold text-brand-700">#{item.seq}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{item.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {item.phone ? (
                          <span className="ltr-nums" dir="ltr">
                            {item.phone}
                          </span>
                        ) : null}
                        {item.phone ? ' · ' : ''}
                        <span dir="ltr">{item.email}</span>
                      </span>
                    </span>
                    <span className="text-xs text-ink-muted">{t('walkins.waitingFor', { minutes })}</span>
                  </div>

                  <p className="text-sm">
                    <span className="text-ink-muted">{t('company')}: </span>
                    <span className="font-medium">{company(item)}</span>
                  </p>
                  {history(item)}

                  {times.length ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1">
                        <label htmlFor={`walkin-${item.id}`} className="mb-1 block text-xs font-medium">
                          {t('walkins.time')}
                        </label>
                        <Select
                          id={`walkin-${item.id}`}
                          value={slot}
                          onChange={(event) => setChosen((prev) => ({ ...prev, [item.id]: event.target.value }))}
                        >
                          {times.map((s) => (
                            <option key={s.slot_id} value={s.slot_id}>
                              {formatTime(s.starts_at, locale)} · {s.room_name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <Button
                        type="button"
                        disabled={pending || !slot}
                        onClick={() =>
                          run(() => confirmWalkinAction({ projectId, locale, requestId: item.id, slotId: slot }))
                        }
                      >
                        {t('walkins.confirm')}
                      </Button>
                    </div>
                  ) : (
                    <Alert tone="warn">{t('walkins.noTimes')}</Alert>
                  )}

                  <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                    <Input
                      value={notes[item.id] ?? ''}
                      onChange={(event) => setNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
                      placeholder={t('walkins.rejectReason')}
                      aria-label={t('walkins.rejectReason')}
                      className="min-w-40 flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          rejectWalkinAction({ projectId, locale, requestId: item.id, note: notes[item.id] ?? '' }),
                        )
                      }
                    >
                      {t('walkins.reject')}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {queue.decided.length ? (
        <details className="rounded-xl border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
            {t('walkins.decidedToday')} <span className="ltr-nums text-ink-muted">({queue.decided.length})</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {queue.decided.map((item) => {
              const started = item.booking && (item.booking.stage === 'in_interview' || item.booking.stage === 'done');
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <span className="ltr-nums font-semibold">#{item.seq}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.name} · {company(item)}
                  </span>
                  {item.status === 'confirmed' ? (
                    <Badge tone="ok">
                      {item.booking ? (
                        <>
                          <span className="ltr-nums">{formatTime(item.booking.starts_at, locale)}</span> · {item.booking.room_name}
                        </>
                      ) : (
                        t('walkins.confirmed')
                      )}
                    </Badge>
                  ) : (
                    <Badge tone="danger">
                      {t('walkins.rejected')}
                      {item.decision_note ? ` · ${item.decision_note}` : ''}
                    </Badge>
                  )}
                  {item.decided_by ? <span className="text-xs text-ink-muted">{item.decided_by}</span> : null}
                  {!started ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => run(() => reopenWalkinAction({ projectId, locale, requestId: item.id }))}
                      className="px-2.5 py-1 text-xs"
                    >
                      ↶ {t('walkins.undo')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
