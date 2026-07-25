import './globals.css';
import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { Nav } from '../components/nav';

// A grotesk for display and body, a mono for metadata, a dot-matrix face for the
// brand mark and prices. All three are self-hosted by next/font at build time,
// so no runtime request leaves for a font CDN.
const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-display',
  display: 'swap',
});
const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});
const doto = localFont({
  src: './fonts/doto.woff2',
  weight: '100 900',
  variable: '--font-dot',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Shop',
  description: 'An e-commerce store with idempotent payments and oversell-proof inventory.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable} ${doto.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
