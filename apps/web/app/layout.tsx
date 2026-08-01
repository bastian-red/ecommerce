import './globals.css';
import './admin.css';
import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';

/**
 * Three faces, each with one job.
 *
 * Instrument Serif is the shop's voice: product titles, prices, the hero. It is
 * a high-contrast editorial serif, which is what a page whose subject is a
 * photograph wants — it reads as a magazine rather than as software.
 *
 * Archivo is a neo-grotesque and does all the work: labels, buttons, body,
 * every word in the admin console. It stays out of the way, which is the whole
 * requirement.
 *
 * IBM Plex Mono carries identifiers — SKUs, order ids, ledger entries. Those
 * are compared character by character rather than read as words, and a
 * proportional face makes that measurably harder.
 *
 * All three are self-hosted by next/font at build time, so no runtime request
 * leaves for a font CDN.
 */
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-display',
  display: 'swap',
});
const ui = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ui',
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Shop',
  description: 'An e-commerce store with idempotent payments and oversell-proof inventory.',
};

/**
 * Matches the browser chrome to the page. Both values are the storefront's
 * `--bg`, because that is what the document element paints; the admin scope
 * repaints its own subtree.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fffdfa' },
    { media: '(prefers-color-scheme: dark)', color: '#14120e' },
  ],
};

/**
 * The root layout owns only what is genuinely global: the document, the fonts
 * and the stylesheets.
 *
 * The chrome lives one level down. `<Nav>` used to be rendered here, which put
 * a warm editorial bar across the top of the cool, dense admin console — the
 * two surfaces disagreeing in the first 60 pixels of every page. Each route
 * group now renders its own nav inside its own `data-surface` wrapper, so the
 * bar takes the palette of the surface beneath it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
