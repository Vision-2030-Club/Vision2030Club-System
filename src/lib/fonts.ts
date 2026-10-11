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
 * The Mock Interviews (افترض) face, used inside that component's pages:
 * TheSansArabic, which carries Arabic, Latin and both sets of digits. Two
 * cuts exist, so each claims a range: Light serves regular and medium text
 * (300–500), Bold serves semibold and bold (600–800), and no weight is
 * synthesised by the browser.
 */
export const theSansArabic = localFont({
  variable: '--font-interviews',
  display: 'swap',
  src: [
    { path: '../fonts/TheSansArabic-Light.ttf', weight: '300 500', style: 'normal' },
    { path: '../fonts/TheSansArabic-Bold.ttf', weight: '600 800', style: 'normal' },
  ],
});
