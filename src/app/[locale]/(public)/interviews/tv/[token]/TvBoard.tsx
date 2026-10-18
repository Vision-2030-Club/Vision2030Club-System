'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
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

/** The size of an element, kept up to date (the screen can be turned, or the window resized). */
function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

/**
 * How to lay out n cards in a box: the number of columns that makes each card
 * as large as possible while keeping roughly the given width-to-height shape.
 * A vertical screen ends up with one or two columns, a wide one with more.
 */
function fitGrid(n: number, width: number, height: number, gap: number, aspect: number) {
  let best = { cols: 1, cardW: 0, cardH: 0 };
  let bestScore = -1;
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // The card is the cell, trimmed to the shape it reads best in.
    const cardH = Math.min(cellH, cellW / aspect * 1.6);
    const cardW = cellW;
    const score = Math.min(cardW / aspect, cardH);
    if (score > bestScore) {
      bestScore = score;
      best = { cols, cardW, cardH };
    }
  }
  return best;
}

/**
 * The name's font size and line count for a card: one line when it reads
 * nearly as large as two would, otherwise two. The name gets at most about
 * 60% of the card's height, so the room line below always fits.
 */
const NAME_LEADING = 1.35;
function fitName(text: string, width: number, height: number) {
  const chars = Math.max(6, [...text].length);
  const perChar = 0.6;
  const one = Math.min(width / (chars * perChar), (height * 0.6) / NAME_LEADING);
  const two = Math.min((width * 2) / (chars * perChar), (height * 0.6) / (2 * NAME_LEADING));
  return one >= two * 0.85 ? { size: Math.max(12, one), lines: 1 } : { size: Math.max(12, two), lines: 2 };
}

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
  const callingRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const callingBox = useBox(callingRef);
  const queueBox = useBox(queueRef);

  const GAP = 16;
  const callGrid = fitGrid(calling.length, callingBox.width, callingBox.height, GAP, 2.2);
  const queueGrid = fitGrid(board.queue.length, queueBox.width, queueBox.height, 10, 4);
  // One name size for every card on screen (the one the longest name needs),
  // so the cards read as a set; each name then takes one line or two.
  const nameWidth = callGrid.cardW * 0.88;
  const nameSize = Math.min(...calling.map((b) => fitName(b.student_name ?? '', nameWidth, callGrid.cardH).size));
  const oneLine = (name: string) => [...name].length * 0.6 * nameSize <= nameWidth;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-brand-600 text-white">
      <header className="flex items-center justify-between gap-6 px-[3vmin] py-[1.5vmin]">
        {/* The brand's own mark, white on its deep teal, as on its banner. */}
        <InterviewsLogo name={title} tone="white" className="h-[6vmin] min-h-10" />
        <span className="ltr-nums text-[3.5vmin] font-semibold tabular-nums text-brand-200">{clock}</span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-[2vmin] px-[3vmin] pb-[2vmin]">
        <section className="flex min-h-0 flex-[3] flex-col">
          <div className="mb-[1.5vmin] text-center text-[2.6vmin] font-medium uppercase tracking-[0.3em] text-accent">
            {calling.length ? labels.nowCalling : '\u00a0'}
          </div>
          <div ref={callingRef} className="relative min-h-0 flex-1">
            {calling.length ? (
              <ul
                className="grid h-full content-center justify-center"
                style={{ gap: GAP, gridTemplateColumns: `repeat(${callGrid.cols}, ${Math.floor(callGrid.cardW)}px)` }}
              >
                {calling.map((b) => {
                  const name = b.student_name ?? '';
                  const metaSize = Math.max(12, Math.min(callGrid.cardH * 0.12, callGrid.cardW * 0.055));
                  return (
                    <li
                      key={b.booking_id}
                      className="flex flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-accent bg-brand-700/80 px-[4%] text-center shadow-lg motion-safe:animate-pulse"
                      style={{ height: Math.floor(callGrid.cardH) }}
                    >
                      <div
                        className={`w-full font-bold break-words ${oneLine(name) ? 'truncate' : 'line-clamp-2'}`}
                        style={{ fontSize: nameSize, lineHeight: NAME_LEADING }}
                      >
                        {name}
                      </div>
                      <div className="mt-[3%] flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1" style={{ fontSize: metaSize }}>
                        <span className="rounded-lg bg-accent px-3 py-0.5 font-bold text-brand-800">
                          {labels.room} {b.room_name}
                        </span>
                        <span className="truncate text-brand-100">{companyName(b)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-[5vmin] text-brand-200">
                {labels.quiet}
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-[2] flex-col border-t border-brand-500 pt-[1.5vmin]">
          <div className="mb-[1vmin] text-[2vmin] font-medium uppercase tracking-[0.25em] text-accent-2">{labels.upNext}</div>
          <div ref={queueRef} className="min-h-0 flex-1">
            <ul
              className="grid h-full content-start"
              style={{ gap: 10, gridTemplateColumns: `repeat(${queueGrid.cols}, minmax(0, 1fr))` }}
            >
              {board.queue.map((b) => {
                const h = Math.min(queueGrid.cardH, 140);
                const size = Math.max(12, Math.min(h * 0.3, queueGrid.cardW * 0.05));
                return (
                  <li
                    key={b.booking_id}
                    className="flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-brand-500 bg-brand-700/60 px-3"
                    style={{ height: Math.floor(h), fontSize: size }}
                  >
                    <span className="ltr-nums shrink-0 font-semibold tabular-nums text-accent">{timeLabel(b.starts_at, locale)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{b.student_name}</span>
                      <span className="block truncate text-[0.75em] text-brand-200">
                        {labels.room} {b.room_name} · {companyName(b)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
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
