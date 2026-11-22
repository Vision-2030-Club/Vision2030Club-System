'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Card, Input, cx } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { ActionResult } from '@/lib/actions';
import type { EventAttendeeMatch } from '@/lib/eventAttendance/types';
import { checkInByIdAction, findAttendeesAction, scanAction, undoCheckInAction } from '../actions';

/** What the last scan or search came to, shown large for the person at the gate. */
type Outcome = {
  tone: 'ok' | 'warn' | 'danger';
  title: string;
  detail?: string;
  /** Set when this outcome is a check-in made just now: it can be undone. */
  undo?: string;
};

type Camera = 'off' | 'starting' | 'on' | 'denied' | 'unsupported';

/** The browser's own QR reader, where there is one (Chrome on Android). */
type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeDetectorClass = new (options: { formats: string[] }) => NativeDetector;

/** The same pass held in front of the camera is read five times a second: act on it once. */
const SAME_CODE_MS = 5000;
const SCAN_EVERY_MS = 200;

/**
 * The gate (0075): the phone's camera reads a pass's QR code and the
 * attendee is checked in for today. Below it, a search by name or the end
 * of a mobile number for someone who came without their pass.
 *
 * The camera is started by a press, which is what a phone's browser asks
 * for. Codes are read by the browser's own detector where it has one and by
 * jsQR elsewhere (Safari on an iPhone has none); jsQR is only downloaded
 * when it is needed. Whatever is read goes to the server as it is: the
 * server decides whether it is a pass, whose, and whether the reader may
 * check them in.
 */
export function Scanner({
  projectId,
  locale,
  checkedInToday,
  live = false,
}: {
  projectId: string;
  locale: string;
  checkedInToday: number;
  /**
   * The page around the scanner shows the server's numbers and arrivals
   * (Quroosh's Reception): read it again after every change, and every half
   * minute while it is on screen. The camera keeps running through it.
   */
  live?: boolean;
}) {
  const t = useTranslations('eventAttendance.scan');
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ text: string; at: number } | null>(null);

  const [camera, setCamera] = useState<Camera>('off');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [count, setCount] = useState(checkedInToday);
  const [matches, setMatches] = useState<EventAttendeeMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [working, setWorking] = useState(false);

  /** Turns the server's answer into what the gate sees, and counts a new arrival. */
  const report = useCallback(
    (result: ActionResult) => {
      if (!result.ok || !result.data) {
        setOutcome({ tone: 'danger', title: result.hint === 'network' ? t('network') : (result.error ?? t('failed')) });
        navigator.vibrate?.([60, 60, 60]);
        return;
      }
      const { name, time, attendee_id: attendeeId } = result.data;
      if (result.data.result === 'already') {
        setOutcome({ tone: 'warn', title: name, detail: t('already', { time }) });
        navigator.vibrate?.([60, 60, 60]);
        return;
      }
      setCount((n) => n + 1);
      setOutcome({ tone: 'ok', title: name, detail: t('checkedIn'), undo: attendeeId });
      navigator.vibrate?.(80);
      if (live) router.refresh();
    },
    [t, live, router],
  );

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [live, router]);

  // The server's count is newer than this one after the page was read again.
  const [seenCount, setSeenCount] = useState(checkedInToday);
  if (seenCount !== checkedInToday) {
    setSeenCount(checkedInToday);
    setCount(checkedInToday);
  }

  // The loop below reaches `report` through a ref, so it depends on the
  // camera alone: were it to restart on a re-render, its cleanup would stop
  // the camera's stream while the page still says the camera is on.
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  // While the camera is on: show it, and look for a code a few times a second.
  useEffect(() => {
    if (camera !== 'on') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    let stopped = false;
    let timer = 0;
    let read: (() => Promise<string | null>) | null = null;

    const onRead = async (text: string) => {
      const last = lastRef.current;
      if (last && last.text === text && Date.now() - last.at < SAME_CODE_MS) return;
      lastRef.current = { text, at: Date.now() };
      busyRef.current = true;
      try {
        reportRef.current(await scanAction(projectId, locale, text));
      } catch {
        reportRef.current({ ok: false, hint: 'network' });
      } finally {
        busyRef.current = false;
      }
    };

    const tick = async () => {
      if (stopped) return;
      try {
        if (read && !busyRef.current && video.readyState >= 2) {
          const text = await read();
          if (text && !stopped) await onRead(text);
        }
      } catch {
        // One unreadable frame is not news; the next one is 200ms away.
      }
      if (!stopped) timer = window.setTimeout(tick, SCAN_EVERY_MS);
    };

    const setUp = async () => {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay refused: the video still shows once the person touches it.
      }

      const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
      if (Native) {
        try {
          const detector = new Native({ formats: ['qr_code'] });
          read = async () => (await detector.detect(video))[0]?.rawValue ?? null;
        } catch {
          read = null;
        }
      }
      if (!read) {
        const { default: jsQR } = await import('jsqr');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        read = async () => {
          if (!context || video.videoWidth === 0) return null;
          // A phone's camera gives far more pixels than a QR code needs.
          const scale = Math.min(1, 720 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
        };
      }
      void tick();
    };
    void setUp();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    };
  }, [camera, projectId, locale]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    setCamera('starting');
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      setCamera('on');
    } catch {
      setCamera('denied');
    }
  };

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    if (query.length < 3) {
      setMatches(null);
      return;
    }
    setSearching(true);
    try {
      setMatches((await findAttendeesAction(projectId, query)).matches);
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
      report(result);
      if (result.ok) {
        setMatches((rows) => rows?.map((row) => (row.id === attendeeId ? { ...row, checked_in_today: true } : row)) ?? null);
      }
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
        setCount((n) => Math.max(0, n - 1));
        setOutcome({ tone: 'warn', title: t('undone') });
        setMatches((rows) => rows?.map((row) => (row.id === attendeeId ? { ...row, checked_in_today: false } : row)) ?? null);
        // The same pass may be read again straight away.
        lastRef.current = null;
        if (live) router.refresh();
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
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {t('today')} <span className="ltr-nums text-lg font-semibold tabular-nums text-ink">{count}</span>
          </p>
          {camera === 'on' ? (
            <Button type="button" variant="secondary" onClick={() => setCamera('off')}>
              {t('stop')}
            </Button>
          ) : (
            <Button type="button" onClick={start} disabled={camera === 'starting'}>
              {camera === 'starting' ? t('starting') : t('start')}
            </Button>
          )}
        </div>

        {camera === 'denied' ? <Alert tone="warn">{t('cameraDenied')}</Alert> : null}
        {camera === 'unsupported' ? <Alert tone="warn">{t('cameraUnsupported')}</Alert> : null}

        {/* Always in the page, so the stream has somewhere to go the moment it starts. */}
        <div className={cx('overflow-hidden rounded-lg bg-ink', camera === 'on' ? 'block' : 'hidden')}>
          <video ref={videoRef} playsInline muted autoPlay className="aspect-square w-full object-cover sm:aspect-video" />
        </div>
        {camera === 'on' ? <p className="text-xs text-ink-muted">{t('pointHint')}</p> : null}

        {/* Announced to a screen reader as it changes. */}
        <div aria-live="assertive">
          {outcome ? (
            <div className={cx('rounded-xl border-2 px-4 py-5 text-center', outcomeStyles[outcome.tone])}>
              <p className="text-balance text-2xl font-bold">{outcome.title}</p>
              {outcome.detail ? <p className="mt-1 text-base font-medium">{outcome.detail}</p> : null}
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
      </Card>

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
          <Button type="submit" variant="secondary" disabled={searching}>
            {t('search.submit')}
          </Button>
        </form>

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
    </div>
  );
}
