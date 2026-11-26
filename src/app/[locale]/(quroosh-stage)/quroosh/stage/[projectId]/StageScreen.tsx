'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { QurooshFin } from '@/components/QurooshLogo';
import { MEDALS } from '@/components/QurooshMedal';
import { QurooshWaves } from '@/components/QurooshWaves';
import { cx } from '@/components/ui';
import { isStageSnapshot, type StageProject, type StageSnapshot } from '@/lib/quroosh/stageBoard';

/*
 * The stage screen's picture (docs/quroosh.md, "The stage screen"): a canvas
 * of exactly 1620x3240, the size of the screen on the stage, written in
 * plain pixels and then moved and scaled as one piece to fit the window. So
 * lines break on a laptop exactly as they do on the wall.
 *
 * Nobody touches it. It asks the poll route every two seconds and shows the
 * change: totals count up, a row that overtakes another slides past it, and
 * "+500" rises beside a total that grew.
 *
 * Nothing here is behind `motion-safe:`, unlike the rest of the app. The
 * motion is what the hall is watching, and a stage computer with Windows
 * animations switched off would otherwise show a board that never moves.
 *
 * Only types and plain functions are imported from src/lib: the Quroosh
 * helpers (`formatQuroosh`, `FINAL_STEP`) live in server-only files, and
 * importing one here breaks the build, which CI does not run.
 */

/** The canvas, in pixels. */
const W = 1620;
const H = 3240;
/** The band the rows live in; the header is above it and the footer below. */
const BOARD_TOP = 446;
const BOARD_H = 2400;

const POLL_MS = 2000;
/** A read slower than this is given up. */
const POLL_TIMEOUT_MS = 6000;
/** How long a "+amount" stays, and its keyframes' length (globals.css). */
const POP_MS = 1800;
/** After a gap this long a rise is many gifts, not one: no "+amount" for it. */
const POP_GAP_MS = 10_000;
/** Misses in a row before the live dot dims. Nothing else ever shows a failure. */
const STALE_AFTER = 5;

const LOGO = { src: '/brand/quroosh-logo-rayh.png', width: 900, height: 383 };
const COINS = { src: '/brand/quroosh-coins-purple.png', width: 420, height: 311 };

/** Quroosh in Latin digits, grouped, as everywhere in the market. */
const NUMBER = new Intl.NumberFormat('en-US');
const format = (amount: number) => NUMBER.format(amount);

export type StageFit = 'contain' | 'exact';
export type StageRotate = 0 | 90 | 270;

export type StageLabels = {
  title: string;
  open: string;
  closed: string;
  soon: string;
  supporters: string;
  given: string;
  gifts: string;
  unit: string;
  scan: string;
  join: string;
  thanks: string;
  qrAlt: string;
};

/** A "+amount" on its way up beside a project's total. */
type Pop = { key: string; id: string; amount: number; at: number };

/** Where the canvas sits in the window: its scale and its top-left corner. */
type Placement = { s: number; x: number; y: number };

/**
 * Fits the canvas to the window, and keeps it fitted (the window can be
 * resized or moved to another screen). `contain` scales it to fit, centred.
 * `exact` leaves it at one canvas pixel per screen pixel from the top-left
 * corner, whatever the display's scaling or the browser's zoom, for a screen
 * processor that crops an exact region. Null until first measured.
 */
function usePlacement(ref: RefObject<HTMLElement | null>, fit: StageFit, sideways: boolean): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (fit === 'exact') {
        setPlacement({ s: 1 / (window.devicePixelRatio || 1), x: 0, y: 0 });
        return;
      }
      // Turned on its side, the canvas takes 3240 across and 1620 down.
      const across = sideways ? H : W;
      const down = sideways ? W : H;
      const s = Math.min(width / across, height / down);
      setPlacement({ s, x: Math.round((width - across * s) / 2), y: Math.round((height - down * s) / 2) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fit, sideways]);
  return placement;
}

/** The canvas's transform, from its top-left corner: scaled, turned if asked, then moved into place. */
function transformOf({ s, x, y }: Placement, rotate: StageRotate): string {
  if (rotate === 90) return `translate(${x + H * s}px, ${y}px) rotate(90deg) scale(${s})`;
  if (rotate === 270) return `translate(${x}px, ${y + W * s}px) rotate(-90deg) scale(${s})`;
  return `translate(${x}px, ${y}px) scale(${s})`;
}

/**
 * A number that counts up (or down) to its new value instead of jumping.
 * A timer lands it on the exact value as well, so a window whose animation
 * frames are asleep still shows the right number.
 */
function useCountUp(target: number, ms = 900): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(Math.max((now - began) / ms, 0), 1);
      const value = Math.round(start + (target - start) * (1 - (1 - progress) ** 3));
      from.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const land = window.setTimeout(() => {
      from.current = target;
      setShown(target);
    }, ms + 300);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(land);
    };
  }, [target, ms]);
  return shown;
}

/**
 * The totals that grew between two reads, as "+amount"s to show. Only while
 * giving is open on both sides, only for a project that was already on the
 * board (a project shown again after being hidden gets none), and not across
 * a gap in the reads.
 */
function rises(before: StageSnapshot | null, after: StageSnapshot, gap: number, now: number): Pop[] {
  if (!before || before.status !== 'open' || after.status !== 'open' || gap > POP_GAP_MS) return [];
  const was = new Map(before.projects.map((project) => [project.id, project.received]));
  const pops: Pop[] = [];
  for (const project of after.projects) {
    const previous = was.get(project.id);
    if (previous !== undefined && project.received > previous) {
      pops.push({
        key: `${project.id}:${project.received}`,
        id: project.id,
        amount: project.received - previous,
        at: now,
      });
    }
  }
  return pops;
}

/** How a row is drawn at a given height: fewer projects, larger type. Class names are whole, for Tailwind. */
type RowSpec = { pad: string; medal: number; name: string; total: string; brief: string | null; meta: string };

function rowSpec(rowH: number): RowSpec {
  if (rowH >= 380) {
    return {
      pad: 'py-[18px]',
      medal: 124,
      name: 'text-[72px] leading-[100px]',
      total: 'text-[100px]',
      brief: 'text-[40px] leading-[54px] line-clamp-3',
      meta: 'text-[32px]',
    };
  }
  if (rowH >= 290) {
    return {
      pad: 'py-[14px]',
      medal: 110,
      name: 'text-[64px] leading-[92px]',
      total: 'text-[92px]',
      brief: 'text-[36px] leading-[49px] line-clamp-2',
      meta: 'text-[30px]',
    };
  }
  // Ten projects, the ceremony's size: 240 a row.
  if (rowH >= 236) {
    return {
      pad: 'py-[10px]',
      medal: 96,
      name: 'text-[56px] leading-[78px]',
      total: 'text-[78px]',
      brief: 'text-[33px] leading-[45px] line-clamp-2',
      meta: 'text-[26px]',
    };
  }
  if (rowH >= 170) {
    return {
      pad: 'py-[8px]',
      medal: 80,
      name: 'text-[50px] leading-[68px]',
      total: 'text-[66px]',
      brief: 'text-[29px] leading-[40px] line-clamp-1',
      meta: 'text-[24px]',
    };
  }
  return {
    pad: 'py-[6px]',
    medal: 60,
    name: 'text-[42px] leading-[58px]',
    total: 'text-[52px]',
    brief: null,
    meta: 'text-[22px]',
  };
}

/** The frame and glow of a place on the final results. Whole class names, for Tailwind. */
const WINNERS = [
  'border-medal-gold shadow-[0_0_90px_-14px_var(--color-medal-gold)]',
  'border-medal-silver shadow-[0_0_90px_-14px_var(--color-medal-silver)]',
  'border-medal-bronze shadow-[0_0_90px_-14px_var(--color-medal-bronze)]',
] as const;

export function StageScreen({
  locale,
  name,
  initial,
  pollUrl,
  qr,
  fit,
  rotate,
  labels,
}: {
  locale: string;
  /** The logo's accessible name. */
  name: string;
  /** What the server read for the first paint. Null when it could not. */
  initial: StageSnapshot | null;
  pollUrl: string;
  /** The guests' QR code, a data URL made on the server. */
  qr: string;
  fit: StageFit;
  rotate: StageRotate;
  labels: StageLabels;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [pops, setPops] = useState<Pop[]>([]);
  const [stale, setStale] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const placement = usePlacement(shell, fit, rotate !== 0);

  useEffect(() => {
    let alive = true;
    let busy = false;
    let timer = 0;
    let failures = 0;
    // The last board read, and when: what the next read is compared with.
    let last = initial;
    let lastAt = performance.now();

    const poll = async () => {
      if (busy || !alive) return;
      busy = true;
      // Given up after a while, so one hung request cannot stop the board.
      const request = new AbortController();
      const giveUp = window.setTimeout(() => request.abort(), POLL_TIMEOUT_MS);
      try {
        // No `cache: 'no-store'`: it sends no-cache headers, which would have
        // the CDN skip its one-second copy. The answer's own headers keep the
        // browser from reusing it.
        const response = await fetch(pollUrl, { signal: request.signal });
        if (!response.ok) throw new Error(String(response.status));
        const next: unknown = await response.json();
        if (!isStageSnapshot(next)) throw new Error('shape');
        if (!alive) return;
        failures = 0;
        setStale(false);
        // An answer older than the one showing (a late copy) changes nothing.
        if (last && next.at < last.at) return;
        const now = performance.now();
        const fresh = rises(last, next, now - lastAt, now);
        last = next;
        lastAt = now;
        setSnapshot(next);
        // Old ones are dropped here, on the next read, not on `animationend`:
        // nothing is left behind if an animation never ran.
        setPops((old) => [...old.filter((pop) => now - pop.at < POP_MS + 600), ...fresh]);
      } catch {
        // The last board stays. Only the live dot says anything, and only after a while.
        failures += 1;
        if (alive && failures >= STALE_AFTER) setStale(true);
      } finally {
        window.clearTimeout(giveUp);
        busy = false;
        if (alive) {
          window.clearTimeout(timer);
          timer = window.setTimeout(poll, POLL_MS);
        }
      }
    };

    timer = window.setTimeout(poll, POLL_MS);
    // Not paused while hidden (the screen may be captured from a covered
    // window); coming back into view only asks at once.
    const wake = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [pollUrl, initial]);

  // Hidden, not read yet, or no project to show: the holding screen.
  const board = snapshot && snapshot.status !== 'hidden' && snapshot.projects.length > 0 ? snapshot : null;
  const closed = board?.status === 'closed';

  return (
    <div
      ref={shell}
      dir="ltr"
      translate="no"
      className="fixed inset-0 z-50 cursor-none overflow-hidden bg-brand-950 select-none"
    >
      {/* `left-0`, the physical side, on purpose: the canvas is moved and scaled
          from its top-left corner in both languages. `start-0` follows this
          element's own direction, and in Arabic pinned it to the right. */}
      <div
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        className={cx(
          'quroosh-type pointer-events-none absolute top-0 left-0 isolate h-[3240px] w-[1620px] origin-top-left overflow-hidden bg-brand-950 text-brand-50 transition-opacity duration-500',
          placement ? 'opacity-100' : 'opacity-0',
        )}
        style={placement ? { transform: transformOf(placement, rotate) } : undefined}
      >
        <Backdrop />

        <header className="absolute inset-x-0 top-0 h-[440px] px-[70px] pt-[40px]">
          {/* The logo on the right and the coins on the left in both languages, as
              the identity places them; the row does not flip with the page. */}
          <div dir="rtl" className="flex items-start justify-between">
            <Image {...LOGO} alt={name} preload sizes="400px" className="h-auto w-[400px]" />
            <Image
              {...COINS}
              alt=""
              aria-hidden="true"
              preload
              sizes="230px"
              className="-mt-[4px] h-auto w-[230px] rotate-[20deg]"
            />
          </div>
          <h1 className="mt-[4px] text-center text-[112px] leading-[1.3] font-bold text-brand-50">{labels.title}</h1>
          <p className="mt-[2px] flex items-center justify-center gap-[22px] text-[48px] leading-[1.35] font-semibold text-accent-2">
            {board && !closed ? <LiveDot still={stale} /> : null}
            {board ? (closed ? labels.closed : labels.open) : labels.soon}
          </p>
        </header>

        {board ? (
          <>
            <Board board={board} pops={pops} labels={labels} />
            <footer className="absolute inset-x-0 bottom-0 h-[390px]">
              {/* `isolate`: the waves' fins carry a z-index of their own, which
                  would otherwise lift one over the QR code's white frame. */}
              <div className="absolute inset-x-0 bottom-0 isolate h-[110px]">
                <QurooshWaves className="h-full" />
              </div>
              <div
                className={cx(
                  'absolute inset-x-[70px] top-[8px] flex h-[300px] items-center gap-[50px]',
                  closed && 'justify-center text-center',
                )}
              >
                {closed ? null : (
                  <div className="shrink-0 rounded-[34px] bg-surface p-[16px]">
                    {/* A data URL made on the server: nothing for next/image to optimise.
                        Dark on white whatever the theme, so phones can read it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr} alt={labels.qrAlt} width={268} height={268} className="size-[268px]" />
                  </div>
                )}
                <div className={cx('min-w-0', !closed && 'flex-1')}>
                  <p className="text-[46px] leading-[1.35] font-bold text-balance text-brand-50">
                    {closed ? labels.thanks : labels.scan}
                  </p>
                  <div className={cx('mt-[18px] flex gap-[80px]', closed && 'justify-center')}>
                    <Stat label={labels.given} value={board.total} />
                    <Stat label={labels.gifts} value={board.gifts} />
                  </div>
                </div>
              </div>
            </footer>
            {/* Once, each time the final results come up: when a manager closes
                giving, and when the page is opened after that. Not before the
                canvas is placed, or the coins would fall while it is still unseen. */}
            {closed && placement ? <CoinShower /> : null}
          </>
        ) : (
          <Holding qr={qr} labels={labels} />
        )}
      </div>
    </div>
  );
}

/** Soft light behind the header and the board, and the identity's fin, much enlarged. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute start-[-320px] top-[-380px] size-[1200px] rounded-full bg-[radial-gradient(closest-side,var(--color-brand-600),transparent)] opacity-45" />
      <div className="absolute end-[-620px] top-[1300px] size-[1500px] rounded-full bg-[radial-gradient(closest-side,var(--color-brand-800),transparent)] opacity-60" />
      <QurooshFin className="absolute start-[-260px] top-[1900px] h-[1500px]! text-brand-900/60" />
    </div>
  );
}

/** Giving is open. Still and dim when the reads keep failing. */
function LiveDot({ still }: { still: boolean }) {
  return (
    <span aria-hidden="true" className="relative flex size-[26px]">
      {still ? null : <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-70" />}
      <span className={cx('relative inline-flex size-[26px] rounded-full', still ? 'bg-brand-400' : 'bg-accent')} />
    </span>
  );
}

function Board({ board, pops, labels }: { board: StageSnapshot; pops: Pop[]; labels: StageLabels }) {
  const count = board.projects.length;
  const rowH = Math.min(400, Math.floor(BOARD_H / count));
  const spec = rowSpec(rowH);
  // Fewer rows than fill the band sit in its middle.
  const offset = Math.max(0, Math.round((BOARD_H - rowH * count) / 2));
  const rank = new Map(board.projects.map((project, index) => [project.id, index]));
  // The rows keep one order in the page, by id, and their rank only moves
  // them (`translateY`). Reordered in the page, a row that overtakes another
  // would be taken out and put back by the browser, and would jump instead
  // of sliding.
  const fixed = [...board.projects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // The newest "+amount" of each project.
  const popOf = new Map(pops.map((pop) => [pop.id, pop]));

  return (
    <ol className="absolute inset-x-0" style={{ top: BOARD_TOP + offset, height: rowH * count }}>
      {fixed.map((project) => (
        <Row
          key={project.id}
          project={project}
          index={rank.get(project.id) ?? 0}
          count={count}
          rowH={rowH}
          spec={spec}
          closed={board.status === 'closed'}
          pop={popOf.get(project.id) ?? null}
          labels={labels}
        />
      ))}
    </ol>
  );
}

function Row({
  project,
  index,
  count,
  rowH,
  spec,
  closed,
  pop,
  labels,
}: {
  project: StageProject;
  /** Its rank on the board, from 0. */
  index: number;
  count: number;
  rowH: number;
  spec: RowSpec;
  closed: boolean;
  pop: Pop | null;
  labels: StageLabels;
}) {
  const total = useCountUp(project.received);
  const medal = project.place !== null && project.place <= 3 ? project.place : null;

  return (
    // The row's place is this transform and nothing else. No keyframes on this
    // element: an animated transform would replace it and the row would jump
    // to the top of the board.
    <li
      className="absolute inset-x-[50px] top-0 pb-[10px]"
      style={{
        height: rowH,
        transform: `translateY(${index * rowH}px)`,
        transition: 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1)',
        zIndex: pop ? count + 1 : count - index,
      }}
    >
      <div
        className={cx(
          'relative flex h-full items-center gap-[26px] rounded-[30px] border-[3px] bg-brand-900/70 px-[30px] transition-[opacity,border-color,box-shadow] duration-700',
          spec.pad,
          closed
            ? medal
              ? WINNERS[medal - 1]
              : 'border-brand-800 opacity-60'
            : medal
              ? cx('border-brand-800 border-s-[14px]', MEDALS[medal - 1].strip)
              : 'border-brand-800',
        )}
      >
        {pop ? (
          <span
            key={pop.key}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 animate-[stage-flash_1400ms_ease-out_both] rounded-[27px] bg-accent/30"
          />
        ) : null}

        <PlaceMark place={project.place} size={spec.medal} />

        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-[24px]">
            {/* `dir="auto"` so a Latin name is cut at its own end on the Arabic
                page; the wrapper keeps every name at the row's start. */}
            <div className="flex min-w-0 flex-1 justify-start">
              <p dir="auto" className={cx('min-w-0 truncate font-bold text-brand-50', spec.name)}>
                {project.name}
              </p>
            </div>
            <div className="relative min-w-[350px] shrink-0 text-end">
              {pop ? (
                <span
                  key={pop.key}
                  className="absolute end-full top-1/2 me-[18px] -mt-[36px] block animate-[stage-pop_1800ms_ease-out_both] rounded-full bg-brand-950 px-[22px] text-[50px] leading-[72px] font-bold whitespace-nowrap text-accent-2"
                >
                  {/* Left to right on the Arabic page too: "+250", not "250+". */}
                  <span className="ltr-nums" dir="ltr">
                    +{format(pop.amount)}
                  </span>
                </span>
              ) : null}
              <p className={cx('leading-none font-bold whitespace-nowrap text-accent', spec.total)}>
                <span className="ltr-nums" dir="ltr">
                  {format(total)}
                </span>{' '}
                <span className="text-[0.36em] font-semibold text-brand-300">{labels.unit}</span>
              </p>
            </div>
          </div>

          {spec.brief && project.brief ? (
            <p dir="auto" className={cx('text-brand-200', spec.brief)}>
              {project.brief}
            </p>
          ) : null}

          <div className="mt-[4px] flex items-center gap-[22px]">
            {/* Its share of the leader's total. A block that grows from the start
                side, so it runs the right way in both languages. */}
            <div className="h-[14px] min-w-0 flex-1 overflow-hidden rounded-full bg-brand-800">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-[900ms] ease-out"
                style={{ width: `${project.share}%` }}
              />
            </div>
            <p className={cx('shrink-0 leading-none font-semibold whitespace-nowrap text-accent-2', spec.meta)}>
              {labels.supporters}{' '}
              <span className="ltr-nums" dir="ltr">
                {format(project.givers)}
              </span>
            </p>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * A place on the board: the leaderboards' medal for the first three
 * (QurooshMedal's shapes and colours, drawn to the row's size), a ringed
 * number after that, and only a dot for a project nobody has backed yet.
 */
function PlaceMark({ place, size }: { place: number | null; size: number }) {
  const box: CSSProperties = { height: size, width: Math.round(size * 0.9) };
  if (place !== null && place <= 3) {
    const medal = MEDALS[place - 1];
    return (
      <svg viewBox="0 0 36 40" className="shrink-0" style={box} role="img" aria-label={String(place)}>
        <path d="M9 0h7l4 14h-7z" className="fill-coin" />
        <path d="M27 0h-7l-4 14h7z" className="fill-accent" />
        <circle cx="18" cy="24" r="13" className={cx(medal.face, medal.rim)} strokeWidth="2.5" />
        <circle cx="18" cy="24" r="9" fill="none" className={medal.rim} strokeWidth="1" strokeOpacity="0.6" />
        <text
          x="18"
          y="24"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-brand-950 text-[13px] font-bold"
          aria-hidden="true"
        >
          {place}
        </text>
      </svg>
    );
  }
  const ring = Math.round(size * 0.78);
  return (
    <span className="grid shrink-0 place-items-center" style={box}>
      {place === null ? (
        <span className="size-[18px] rounded-full bg-brand-700" />
      ) : (
        <span
          className="grid place-items-center rounded-full border-[3px] border-brand-400 font-bold text-brand-100"
          style={{ height: ring, width: ring, fontSize: Math.round(ring * 0.5) }}
        >
          <span className="ltr-nums">{place}</span>
        </span>
      )}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const shown = useCountUp(value);
  return (
    <div>
      <p className="text-[72px] leading-none font-bold text-accent">
        <span className="ltr-nums" dir="ltr">
          {format(shown)}
        </span>
      </p>
      <p className="mt-[10px] text-[28px] leading-[1.35] text-brand-200">{label}</p>
    </div>
  );
}

/** Before giving opens, and whenever there is nothing to rank: the way in, large. */
function Holding({ qr, labels }: { qr: string; labels: StageLabels }) {
  return (
    <>
      <div className="absolute inset-x-[90px] top-[640px] flex flex-col items-center text-center">
        <div className="rounded-[72px] bg-surface p-[48px] shadow-[0_50px_140px_-40px_var(--color-brand-600)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={labels.qrAlt} width={900} height={900} className="size-[900px]" />
        </div>
        <p className="mt-[90px] text-[72px] leading-[1.4] font-bold text-balance text-brand-50">{labels.join}</p>
      </div>
      <div className="absolute inset-x-0 bottom-0 isolate h-[260px]">
        <QurooshWaves className="h-full" />
      </div>
    </>
  );
}

/**
 * The coins of the final results. Where each falls, how large and how fast
 * come from its number, not from chance: the same shower every time, and
 * nothing impure in render.
 */
const SHOWER = Array.from({ length: 40 }, (_, i) => ({
  start: (i * 37 + 9) % 100,
  size: 70 + ((i * 53) % 80),
  delay: (i * 137) % 2000,
  duration: 2600 + ((i * 211) % 1700),
  spin: (i % 2 === 0 ? 1 : -1) * (300 + ((i * 97) % 500)),
  tone: i % 3,
}));

/** Whole class names, for Tailwind: gold, the identity's purple coin, and mint. */
const COIN_TONES = [
  { face: 'fill-medal-gold stroke-medal-gold-rim', ring: 'stroke-medal-gold-rim' },
  { face: 'fill-coin stroke-accent', ring: 'stroke-accent-2' },
  { face: 'fill-accent stroke-accent-3', ring: 'stroke-accent-3' },
] as const;

function CoinShower() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {SHOWER.map((coin, i) => {
        const tone = COIN_TONES[coin.tone];
        return (
          <span
            key={i}
            className="absolute top-0 block animate-[stage-coin_3000ms_ease-in_both]"
            style={
              {
                insetInlineStart: `${coin.start}%`,
                width: coin.size,
                height: coin.size,
                animationDelay: `${coin.delay}ms`,
                animationDuration: `${coin.duration}ms`,
                '--stage-spin': `${coin.spin}deg`,
              } as CSSProperties
            }
          >
            <svg viewBox="0 0 40 40" className="size-full">
              <circle cx="20" cy="20" r="18" strokeWidth="3" className={tone.face} />
              <circle cx="20" cy="20" r="12" fill="none" strokeWidth="1.5" strokeDasharray="2 3" className={tone.ring} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}
