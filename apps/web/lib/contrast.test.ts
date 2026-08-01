import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AA_NORMAL,
  AA_UI,
  contrastRatio,
  extractTokens,
  parseHex,
  ratio,
  relativeLuminance,
  resolve,
} from './contrast';

/**
 * The colour gate.
 *
 * Every foreground/background pair the product renders is checked against WCAG
 * AA, in both colour schemes, on both surfaces. It reads the real stylesheets,
 * so it cannot pass against a stale copy of the palette — a contrast test that
 * scores a duplicated palette is worse than no test, because it reports safety
 * that is not there.
 *
 * Four palettes, not two. The storefront and the admin console have different
 * colours for the same tokens, so a value that clears AA on warm paper can fail
 * on cool slate and nothing else would catch it.
 */
const APP = join(__dirname, '..', 'app');
const globals = readFileSync(join(APP, 'globals.css'), 'utf8');
const adminCss = readFileSync(join(APP, 'admin.css'), 'utf8');

/** The storefront is the default palette, declared on the single `:root` block. */
const shopLight = extractTokens(globals, ':root');
const shopDark = {
  ...shopLight,
  ...extractTokens(globals, '@media (prefers-color-scheme: dark)'),
};

/** Admin overrides a subset, so it layers on top of the storefront palette. */
const adminLight = { ...shopLight, ...extractTokens(adminCss, "[data-surface='admin']") };
const adminDark = {
  ...shopDark,
  ...extractTokens(adminCss, "[data-surface='admin']"),
  ...extractTokens(adminCss, '@media (prefers-color-scheme: dark)'),
};

const PALETTES = {
  'shop / light': shopLight,
  'shop / dark': shopDark,
  'admin / light': adminLight,
  'admin / dark': adminDark,
} as const;

/** Backgrounds any of these foregrounds can legitimately land on. */
const BACKGROUNDS = ['--bg', '--surface', '--surface-2'] as const;

/**
 * Text-weight foregrounds: must clear 4.5:1 on every background.
 *
 * `--accent` is absent on purpose. It is a fill and a focus ring, never a text
 * colour — `--accent-ink` is the text-weight variant — so it answers to the
 * 3:1 of WCAG 1.4.11 rather than the 4.5:1 of 1.4.3, and is checked separately.
 */
const TEXT = [
  '--text',
  '--muted',
  '--accent-ink',
  '--state-ok',
  '--state-warn',
  '--state-err',
] as const;

describe('pure contrast maths', () => {
  it('computes the canonical extremes', () => {
    expect(ratio('#000000', '#ffffff')).toBe(21);
    expect(ratio('#ffffff', '#ffffff')).toBe(1);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      10,
    );
  });

  it('expands three-digit hex', () => {
    expect(parseHex('#fff')).toEqual(parseHex('#ffffff'));
    expect(parseHex('0af')).toEqual({ r: 0, g: 170, b: 255 });
  });

  it('rejects nonsense rather than scoring it', () => {
    expect(() => parseHex('rebeccapurple')).toThrow(/not a hex colour/);
    expect(() => parseHex('#12345')).toThrow(/not a hex colour/);
  });

  it('matches the WCAG luminance of the reference greys', () => {
    expect(relativeLuminance(parseHex('#000000'))).toBe(0);
    expect(relativeLuminance(parseHex('#ffffff'))).toBeCloseTo(1, 10);
    expect(relativeLuminance(parseHex('#808080'))).toBeCloseTo(0.2159, 3);
  });
});

describe('token extraction', () => {
  it('reads custom properties out of a block', () => {
    const tokens = extractTokens(':root { --a: #fff; --b: 4px; }', ':root');
    expect(tokens).toEqual({ '--a': '#fff', '--b': '4px' });
  });

  it('walks nested braces so a media query does not truncate the block', () => {
    const css = '@media (prefers-color-scheme: dark) { :root { --a: #000; } }';
    expect(extractTokens(css, '@media (prefers-color-scheme: dark)')).toEqual({ '--a': '#000' });
  });

  it('follows var() indirection', () => {
    expect(resolve({ '--a': 'var(--b)', '--b': '#123456' }, '--a')).toBe('#123456');
  });

  it('throws on a circular reference instead of hanging', () => {
    expect(() => resolve({ '--a': 'var(--b)', '--b': 'var(--a)' }, '--a')).toThrow(/circular/);
  });

  it('throws on a missing token rather than skipping the check', () => {
    expect(() => resolve({}, '--nope')).toThrow(/undefined token/);
  });

  it('found a real palette in every scope', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(resolve(palette, '--text'), name).toMatch(/^#/);
      expect(resolve(palette, '--bg'), name).toMatch(/^#/);
    }
  });

  it('the four palettes are actually four', () => {
    // Guards a copy-paste: an admin block that never overrode --bg would pass
    // every ratio below while shipping a warm storefront canvas to the console.
    const canvases = Object.values(PALETTES).map((p) => resolve(p, '--bg'));
    expect(new Set(canvases).size).toBe(4);
  });
});

describe.each(Object.entries(PALETTES))('%s palette', (scope, palette) => {
  describe.each(TEXT)('%s', (fg) => {
    it.each(BACKGROUNDS)('clears AA on %s', (bg) => {
      const foreground = resolve(palette, fg);
      const background = resolve(palette, bg);
      const measured = ratio(foreground, background);
      expect(
        measured,
        `${scope}: ${fg} (${foreground}) on ${bg} (${background}) is ${measured}:1, needs ${AA_NORMAL}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });

  it.each(BACKGROUNDS)('--border-strong bounds a control against %s', (bg) => {
    // Input edges, variant outlines, table rules: non-text UI, WCAG 1.4.11.
    const border = resolve(palette, '--border-strong');
    const background = resolve(palette, bg);
    const measured = ratio(border, background);
    expect(
      measured,
      `${scope}: --border-strong (${border}) on ${bg} (${background}) is ${measured}:1, needs ${AA_UI}:1`,
    ).toBeGreaterThanOrEqual(AA_UI);
  });

  it.each(BACKGROUNDS)('--accent reads as a control boundary against %s', (bg) => {
    const accent = resolve(palette, '--accent');
    const background = resolve(palette, bg);
    const measured = ratio(accent, background);
    expect(
      measured,
      `${scope}: --accent (${accent}) on ${bg} (${background}) is ${measured}:1, needs ${AA_UI}:1`,
    ).toBeGreaterThanOrEqual(AA_UI);
  });

  it('the primary button label is readable on its own fill', () => {
    const measured = ratio(resolve(palette, '--on-accent'), resolve(palette, '--accent'));
    expect(
      measured,
      `${scope}: --on-accent on --accent is ${measured}:1, needs ${AA_NORMAL}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('the accent wash still carries accent-ink and body text', () => {
    const wash = resolve(palette, '--accent-wash');
    for (const fg of ['--accent-ink', '--text'] as const) {
      const measured = ratio(resolve(palette, fg), wash);
      expect(
        measured,
        `${scope}: ${fg} on --accent-wash (${wash}) is ${measured}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the selected variant inverts without losing contrast', () => {
    // `.variant.selected` and `.btn:hover` paint --text as the fill and --bg as
    // the label.
    const measured = ratio(resolve(palette, '--bg'), resolve(palette, '--text'));
    expect(measured, `${scope}: inverted control`).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('--surface is distinguishable from --bg', () => {
    // Not a WCAG rule, a real regression class: a --surface equal to --bg makes
    // every .card and .summary silently lose its surface.
    expect(resolve(palette, '--surface'), `${scope}: --surface must not equal --bg`).not.toBe(
      resolve(palette, '--bg'),
    );
  });

  it('the three order states are three different colours', () => {
    const states = ['--state-ok', '--state-warn', '--state-err'].map((t) => resolve(palette, t));
    expect(new Set(states).size, `${scope}: state tokens must be distinct`).toBe(3);
  });
});

/**
 * The two surfaces have to be visibly different surfaces.
 *
 * The whole reason the admin console has its own palette is that an operator
 * who mistakes it for the storefront will eventually edit live inventory
 * believing they are browsing. "Warm paper vs cool slate" is a claim about two
 * hex values, so it is checked rather than asserted.
 */
describe('the storefront and the console do not look alike', () => {
  /** Signed warmth: red channel minus blue channel, normalised. Positive is warm. */
  const warmth = (hex: string): number => {
    const { r, b } = parseHex(hex);
    return (r - b) / 255;
  };

  it.each([
    ['light', shopLight, adminLight],
    ['dark', shopDark, adminDark],
  ])('%s: the shop canvas is warm and the admin canvas is not', (_scheme, shop, admin) => {
    expect(warmth(resolve(shop, '--bg'))).toBeGreaterThan(0);
    expect(warmth(resolve(admin, '--bg'))).toBeLessThanOrEqual(0);
  });

  it.each([
    ['light', shopLight, adminLight],
    ['dark', shopDark, adminDark],
  ])('%s: the accents are not the same colour', (_scheme, shop, admin) => {
    expect(resolve(shop, '--accent')).not.toBe(resolve(admin, '--accent'));
  });
});

/**
 * The greyscale channel.
 *
 * Paid / pending / cancelled cannot be told apart by luminance alone, and no
 * palette fixes that: in dark mode every state colour must clear 4.5:1 against
 * a near-black canvas, which forces all three into a narrow luminance band. So
 * colour cannot carry the state, and the glyph and the word have to.
 */
describe('state survives greyscale', () => {
  const glyph = (variant: string): string => {
    const rule = new RegExp(`\\.badge-${variant}::before[^{]*\\{([^}]*)\\}`).exec(globals);
    if (!rule) throw new Error(`no ::before rule for .badge-${variant}`);
    const content = /content:\s*'([^']*)'/.exec(rule[1]!);
    if (!content) throw new Error(`.badge-${variant}::before declares no content`);
    return content[1]!;
  };

  it('gives each state its own glyph', () => {
    const glyphs = ['ok', 'warn', 'err'].map(glyph);
    expect(new Set(glyphs).size, `badge glyphs must be distinct, got ${glyphs.join(' ')}`).toBe(3);
    for (const g of glyphs) expect(g.trim().length).toBeGreaterThan(0);
  });
});
