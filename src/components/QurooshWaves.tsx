import { cx } from '@/components/ui';
import { QurooshFin } from '@/components/QurooshLogo';

/**
 * The identity's waves: stacked bands of navy, purple, teal, lavender and
 * mint, with fins cutting through. Drawn here rather than copied from the
 * guide so it stretches to any width; the colours are theme tokens, so it
 * only looks right under `data-theme="quroosh"`. Decorative.
 */
export function QurooshWaves({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('pointer-events-none relative', className)}>
      <QurooshFin className="absolute bottom-[62%] start-[14%] z-10 h-5 text-accent-2" />
      <QurooshFin className="absolute bottom-[45%] end-[22%] z-10 h-4 text-accent-2" />
      <svg viewBox="0 0 1200 160" preserveAspectRatio="none" className="block h-full w-full">
      <path className="fill-brand-900" d="M0 30 Q60 22 120 30 T240 30 Q300 22 360 30 T480 30 Q540 22 600 30 T720 30 Q780 22 840 30 T960 30 Q1020 22 1080 30 T1200 30 Q1260 22 1320 30 T1440 30 Q1500 22 1560 30 T1680 30 V160 H0 Z" />
      <path className="fill-brand-600" d="M-100 58 Q-50 50 0 58 T100 58 Q150 50 200 58 T300 58 Q350 50 400 58 T500 58 Q550 50 600 58 T700 58 Q750 50 800 58 T900 58 Q950 50 1000 58 T1100 58 Q1150 50 1200 58 T1300 58 Q1350 50 1400 58 T1500 58 V160 H-100 Z" />
      <path className="fill-accent-3" d="M-65 84 Q0 77 65 84 T195 84 Q260 77 325 84 T455 84 Q520 77 585 84 T715 84 Q780 77 845 84 T975 84 Q1040 77 1105 84 T1235 84 Q1300 77 1365 84 T1495 84 V160 H-65 Z" />
      <path className="fill-brand-400" d="M-165 108 Q-110 101 -55 108 T55 108 Q110 101 165 108 T275 108 Q330 101 385 108 T495 108 Q550 101 605 108 T715 108 Q770 101 825 108 T935 108 Q990 101 1045 108 T1155 108 Q1210 101 1265 108 T1375 108 V160 H-165 Z" />
      <path className="fill-accent-2" d="M-96 132 Q-36 126 24 132 T144 132 Q204 126 264 132 T384 132 Q444 126 504 132 T624 132 Q684 126 744 132 T864 132 Q924 126 984 132 T1104 132 Q1164 126 1224 132 T1344 132 Q1404 126 1464 132 T1584 132 V160 H-96 Z" />
      </svg>
    </div>
  );
}
