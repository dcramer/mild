import localFont from 'next/font/local';

// The four typefaces, their Latin sets served by Mild itself and fetched with the page, each with a fallback sized
// to match so nothing moves when it arrives. Other scripts come from the same faces' other sets, fetched only for a
// page that has their letters (Fontsource, `web/src/index.css`). Next.js takes only literals here.

export const wordmark = localFont({
  src: '../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
  weight: '200 800',
  variable: '--typeface-wordmark',
});
export const display = localFont({
  src: '../../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--typeface-display',
});
export const text = localFont({
  src: '../../node_modules/@fontsource-variable/karla/files/karla-latin-wght-normal.woff2',
  weight: '200 800',
  variable: '--typeface-text',
});
export const mono = localFont({
  src: [
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400' },
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500' },
  ],
  variable: '--typeface-mono',
});
