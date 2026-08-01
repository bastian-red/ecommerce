import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTokens, resolve } from './contrast';

/**
 * The identity lock.
 *
 * This repo is one of a portfolio, and the portfolio's failure mode is that
 * every project ends up wearing whatever visual language the last one wore.
 * That is not hypothetical: this app and the booking one previously shipped a
 * byte-identical token block and the same three typefaces, so a reader opening
 * both saw one designer with one trick.
 *
 * "Shop looks like Shop" is not a judgement call — it is a set of values in
 * three files. So it lives here, where drifting back toward a shared palette
 * fails a commit instead of passing review.
 *
 * When the identity genuinely changes, change these constants deliberately and
 * say why in the commit. That is the point: it should cost a decision.
 */
const APP = join(__dirname, '..', 'app');
const globals = readFileSync(join(APP, 'globals.css'), 'utf8');
const adminCss = readFileSync(join(APP, 'admin.css'), 'utf8');
const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');

/** "Editorial retail", plus a console. See the header comments in the CSS. */
const IDENTITY = {
  shopLight: { '--bg': '#fffdfa', '--accent': '#7a2e2e' },
  shopDark: { '--bg': '#14120e', '--accent': '#e39a9a' },
  adminLight: { '--bg': '#f6f7f9', '--accent': '#1f6feb' },
  radius: { shop: '2px', admin: '4px' },
  fonts: ['Archivo', 'IBM_Plex_Mono', 'Instrument_Serif'],
} as const;

const shopLight = extractTokens(globals, ':root');
const shopDark = { ...shopLight, ...extractTokens(globals, '@media (prefers-color-scheme: dark)') };
const adminLight = { ...shopLight, ...extractTokens(adminCss, "[data-surface='admin']") };

/** Every face this app pulls out of `next/font/google`. */
function importedFaces(): string[] {
  const line = /import\s*\{([^}]*)\}\s*from\s*'next\/font\/google'/.exec(layout);
  if (!line) throw new Error('layout.tsx imports nothing from next/font/google');
  return line[1]!
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

describe('visual identity', () => {
  it.each(Object.entries(IDENTITY.shopLight))('storefront light %s is %s', (token, expected) => {
    expect(resolve(shopLight, token).toLowerCase()).toBe(expected);
  });

  it.each(Object.entries(IDENTITY.shopDark))('storefront dark %s is %s', (token, expected) => {
    expect(resolve(shopDark, token).toLowerCase()).toBe(expected);
  });

  it.each(Object.entries(IDENTITY.adminLight))('admin light %s is %s', (token, expected) => {
    expect(resolve(adminLight, token).toLowerCase()).toBe(expected);
  });

  it('loads exactly the faces this identity is built on', () => {
    // Exact, not "at least": an extra face is how a shared house style creeps
    // back in one import at a time.
    expect(importedFaces()).toEqual([...IDENTITY.fonts].sort());
  });

  it('keeps the storefront sharper than the console', () => {
    // A retail photograph wants a crisp edge; a rounded card reads as software.
    // The console is allowed to soften, because it *is* software.
    expect(shopLight['--radius']).toBe(IDENTITY.radius.shop);
    expect(adminLight['--radius']).toBe(IDENTITY.radius.admin);
  });

  it('sets product titles and prices in the serif, not the grotesque', () => {
    // The whole editorial argument collapses if the display face is only used
    // in the hero.
    expect(globals).toMatch(/\.price\s*\{[^}]*--ff-display/);
  });

  it('does not reintroduce the shared signal red', () => {
    // #ff0000 was the one accent all three portfolio projects shared.
    for (const [name, css] of [
      ['globals.css', globals],
      ['admin.css', adminCss],
    ] as const) {
      expect([...css.matchAll(/#ff0000|#f00\b/gi)], `${name}`).toHaveLength(0);
    }
  });

  it('keeps the two surfaces on separate stylesheets', () => {
    // admin.css must only override. If it starts declaring layout the split
    // stops being a palette swap and the surfaces drift apart structurally.
    expect(adminCss).toMatch(/\[data-surface='admin'\]/);
    expect(globals).not.toMatch(/\[data-surface='admin'\]/);
  });
});
