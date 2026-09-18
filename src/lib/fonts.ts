import localFont from 'next/font/local';

/** Arabic-coverage face — the default for the Arabic UI. */
export const plexArabic = localFont({
  variable: '--font-arabic',
  display: 'swap',
  src: [
    { path: '../fonts/IBMPlexSansArabic-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../fonts/IBMPlexSansArabic-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../fonts/IBMPlexSansArabic-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../fonts/IBMPlexSansArabic-Bold.ttf', weight: '700', style: 'normal' },
  ],
});

/** Brand face for Latin text. */
export const gilroy = localFont({
  variable: '--font-latin',
  display: 'swap',
  src: [
    { path: '../fonts/Gilroy-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../fonts/Gilroy-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../fonts/Gilroy-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../fonts/Gilroy-Bold.ttf', weight: '700', style: 'normal' },
  ],
});

/**
 * The Mock Interviews (افترض) face, used inside that component's pages.
 * One Light cut exists, so it is declared at 300 only: headings and buttons
 * ask for 600–700 and the browser emboldens this cut for them, which reads
 * far better than letting a single thin face claim every weight.
 */
export const dgHeaven = localFont({
  variable: '--font-interviews',
  display: 'swap',
  src: [{ path: '../fonts/DG-Heaven-Light.ttf', weight: '300', style: 'normal' }],
});
