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

/**
 * The Quroosh (قروش) face, used inside that component's pages: Titillium
 * Web, as the identity specifies. It has no Arabic glyphs, so Arabic text
 * falls back to IBM Plex Sans Arabic glyph by glyph (see globals.css).
 *
 * No generated fallback face: next/font would add "titillium Fallback", an
 * Arial with Titillium's metrics, and Arial carries Arabic, so every Arabic
 * letter stopped there and IBM Plex Sans Arabic was never used.
 */
export const titillium = localFont({
  variable: '--font-quroosh',
  display: 'swap',
  adjustFontFallback: false,
  src: [
    { path: '../fonts/TitilliumWeb-300.woff2', weight: '300', style: 'normal' },
    { path: '../fonts/TitilliumWeb-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/TitilliumWeb-600.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/TitilliumWeb-700.woff2', weight: '700', style: 'normal' },
  ],
});

/**
 * Arabic on the Quroosh guest pages: thmanyah Sans (خط ثمانية الرقمي), the
 * files exactly as thmanyah ships them (woff2), with their license beside
 * them (src/fonts/thmanyah-LICENSE.pdf). The license allows websites only as
 * part of a compiled product and forbids changing, renaming or handing out
 * the files: leave them as they are, and load them only through next/font,
 * never from public/.
 */
export const thmanyahSans = localFont({
  variable: '--font-quroosh-arabic',
  display: 'swap',
  src: [
    { path: '../fonts/thmanyahsans-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/thmanyahsans-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/thmanyahsans-Bold.woff2', weight: '600 700', style: 'normal' },
  ],
});
