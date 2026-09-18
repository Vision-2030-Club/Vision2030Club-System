'use client';

import { useEffect, useState } from 'react';
import { InterviewsLogo } from '@/components/InterviewsLogo';
import type { Board } from '@/lib/interviews/board';

const POLL_MS = 10_000;

export type TvLabels = {
  nowCalling: string;
  proceed: string;
  upNext: string;
  room: string;
  inside: string;
  next: string;
  idle: string;
  quiet: string;
};

function timeLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function TvBoard({
  locale,
  title,
  initial,
  pollUrl,
  labels,
}: {
  locale: string;
  title: string;
  initial: Board;
  pollUrl: string;
  labels: TvLabels;
}) {
  const [board, setBoard] = useState(initial);
  const [clock, setClock] = useState('');
  const isArabic = locale === 'ar';
  const companyName = (b: { company_name_en: string; company_name_ar: string }) =>
    isArabic ? b.company_name_ar : b.company_name_en;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const response = await fetch(pollUrl, { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as Board;
        if (alive) setBoard(next);
      } catch {
        // Keep showing the last board; the next poll is ten seconds away.
      }
    };
    const timer = setInterval(poll, POLL_MS);
    const tick = () => setClock(timeLabel(new Date().toISOString(), locale));
    tick();
    const clockTimer = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(clockTimer);
    };
  }, [pollUrl, locale]);

  const calling = board.calling;
  const nameSize =
    calling.length <= 1
      ? 'text-[clamp(3rem,11vw,9rem)]'
      : calling.length === 2
        ? 'text-[clamp(2.25rem,7vw,6rem)]'
        : 'text-[clamp(1.75rem,5vw,4rem)]';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-brand-600 text-white">
      <header className="flex items-center justify-between gap-6 px-8 py-4">
        {/* The brand's own mark, white on its deep teal, as on its banner. */}
        <InterviewsLogo name={title} tone="white" className="h-12" />
        <span className="ltr-nums text-2xl font-semibold tabular-nums text-brand-200">{clock}</span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col px-8">
        <section className="flex min-h-0 flex-[3] flex-col items-center justify-center text-center">
          {calling.length ? (
            <>
              <div className="mb-4 text-xl font-medium uppercase tracking-[0.3em] text-accent">{labels.nowCalling}</div>
              <ul className="space-y-4">
                {calling.map((b) => (
                  <li key={b.booking_id} className="motion-safe:animate-pulse">
                    <div className={`${nameSize} font-bold leading-none`}>{b.student_name}</div>
                    <div className="mt-3 text-[clamp(1.25rem,3vw,2.5rem)] text-brand-200">
                      {labels.proceed} · {labels.room} {b.room_name} · {companyName(b)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-[clamp(1.5rem,4vw,3rem)] text-brand-200">{labels.quiet}</div>
          )}
        </section>

        <section className="min-h-0 flex-[2] border-t border-brand-500 pt-4">
          <div className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-accent-2">{labels.upNext}</div>
          <ul className="grid gap-x-8 gap-y-1 text-[clamp(1rem,2.2vw,1.75rem)] md:grid-cols-2">
            {board.queue.map((b) => (
              <li key={b.booking_id} className="flex items-baseline gap-4 truncate">
                <span className="ltr-nums w-20 shrink-0 tabular-nums text-brand-200">{timeLabel(b.starts_at, locale)}</span>
                <span className="truncate font-semibold">{b.student_name}</span>
                <span className="truncate text-brand-200">
                  {companyName(b)} · {labels.room} {b.room_name}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="overflow-hidden border-t border-brand-500 bg-brand-700 py-3">
        <div className="tv-ticker flex w-max gap-12 whitespace-nowrap px-8 text-lg text-brand-100">
          {[...board.ticker, ...board.ticker].map((item, i) => (
            <span key={`${item.room_name}-${i}`} className="flex items-baseline gap-2">
              <span className="font-semibold text-accent">
                {labels.room} {item.room_name}
              </span>
              <span className="text-accent-2">{companyName(item)}</span>
              <span>
                {item.state === 'in_interview'
                  ? `${labels.inside}: ${item.student_name ?? ''}`
                  : item.state === 'next'
                    ? `${labels.next}: ${item.student_name ?? ''} ${item.starts_at ? timeLabel(item.starts_at, locale) : ''}`
                    : labels.idle}
              </span>
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
