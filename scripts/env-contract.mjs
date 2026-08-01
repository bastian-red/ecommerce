#!/usr/bin/env node
/**
 * Environment contract gate.
 *
 * Turborepo 2 runs tasks in strict environment mode by default: a task's child
 * process sees only the variables named in `globalEnv` / `globalPassThroughEnv`
 * (plus turbo's own system allowlist). Everything else is stripped, silently.
 *
 * That silence is the whole problem. This repo shipped with six names declared
 * and thirty-five read, so `pnpm dev` started an API with no AUTH_SECRET and a
 * web app pointed at a default API_BASE_URL. Nothing failed loudly at the point
 * of the mistake; it surfaced four layers down as ECONNREFUSED. The E2E lane
 * never caught it because scripts/e2e.sh sources .env and launches the apps
 * directly, without turbo, so it exercises a different code path than the one
 * the README tells a reader to run.
 *
 * Which names a program reads and which names a config file declares is
 * same-input-same-output work, so it is a script rather than a review habit.
 *
 * Four assertions:
 *
 *   A. Every variable the source reads is declared.       <- the bug above
 *   B. Every variable .env.example documents is declared. <- config that does nothing
 *   C. Every declared variable is read or documented.     <- dead / misspelled entries
 *   D. Every variable .env.example documents is read.     <- documentation that lies
 *
 * Usage: node scripts/env-contract.mjs
 * Exit:  0 contract holds, 1 a violation, 2 could not read an input.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where application code lives. Build output and generated clients are not it. */
const SOURCE_DIRS = ['apps', 'packages', 'services'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'generated', 'coverage']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js', '.prisma']);

/**
 * Variables that are legitimately read by something other than our own source,
 * so the scanner cannot see the read. Each one needs a reason: an unexplained
 * entry here is how a gate rots into a rubber stamp.
 */
const READ_BY_DEPENDENCY = {
  AUTH_URL: 'Auth.js reads it directly from the environment (@auth/core).',
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE_EXT.has(extname(path))) out.push(path);
  }
  return out;
}

/**
 * Every environment name a file reads.
 *
 * Three shapes, because the codebase genuinely uses three:
 *   process.env.NAME        — the common case
 *   env.NAME                — config loaders take `env: NodeJS.ProcessEnv = process.env`
 *                             so they can be unit-tested against a fake environment
 *   env("NAME")             — prisma/schema.prisma
 *
 * The bare `env.NAME` form needs the SCREAMING_CASE constraint to avoid matching
 * ordinary property access; two characters minimum keeps it off `env.ID`-style
 * false hits while still catching every real name in this repo.
 */
function namesReadBy(source) {
  const names = new Set();
  for (const [, name] of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(name);
  for (const [, name] of source.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g))
    names.add(name);
  for (const [, name] of source.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/g)) names.add(name);
  for (const [, name] of source.matchAll(/\benv\(["']([A-Z][A-Z0-9_]*)["']\)/g)) names.add(name);
  return names;
}

/** Every workspace package.json, plus the root one, added by the caller. */
function walkManifests(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkManifests(path, out);
    else if (entry === 'package.json') out.push(path);
  }
  return out;
}

/**
 * Names a package's npm scripts expand in the shell.
 *
 * `"dev": "next dev -p ${WEB_PORT:-3000}"` is a read site as real as any
 * `process.env` access, and it is the one a TypeScript scanner can never see.
 * Missing it is how WEB_PORT looked like dead configuration on the first run of
 * this check when it is in fact what chooses the port.
 */
function namesReadByScripts(manifestPath) {
  const names = new Set();
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return names;
  }
  for (const script of Object.values(manifest.scripts ?? {})) {
    for (const [, name] of String(script).matchAll(/\$\{?([A-Z][A-Z0-9_]*)\b/g)) names.add(name);
  }
  return names;
}

/**
 * Parse turbo.json, which is JSONC.
 *
 * `JSON.parse` cannot read it, and stripping `//` with a regex is worse than not
 * trying: the very first line is `"$schema": "https://turbo.build/schema.json"`,
 * and a naive strip turns that into `"https:` and a syntax error. So this walks
 * the text tracking whether it is inside a string, which is the only way to know
 * that a `//` is a comment rather than two characters of a URL.
 */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      // A backslash escapes the next character, so `"a\"b"` does not end here.
      if (char === '\\') {
        out += char + (next ?? '');
        i += 1;
        continue;
      }
      if (char === '"') inString = false;
      out += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  // Trailing commas are legal in JSONC and turbo accepts them.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function declaredNames(turbo) {
  const declared = new Map();
  for (const key of ['globalEnv', 'globalPassThroughEnv']) {
    for (const name of turbo[key] ?? []) {
      if (name.includes('*')) {
        fail(
          `turbo.json ${key} contains the wildcard "${name}".\n` +
            'Declare names in full. A wildcard makes this contract unverifiable: it cannot\n' +
            'tell a variable that is covered from one that was never considered.',
        );
      }
      declared.set(name.replace(/^\$/, ''), key);
    }
  }
  return declared;
}

function documentedNames(example) {
  const names = new Set();
  for (const line of example.split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

// --- Read the three inputs -------------------------------------------------

let turbo;
let example;
try {
  turbo = parseJsonc(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  example = readFileSync(join(ROOT, '.env.example'), 'utf8');
} catch (error) {
  fail(`cannot read the contract inputs: ${error.message}`);
}

const declared = declaredNames(turbo);
const documented = documentedNames(example);

/** name -> the files that read it, so a failure says where to look. */
const read = new Map();
const noteRead = (name, file) => {
  if (!read.has(name)) read.set(name, []);
  read.get(name).push(relative(ROOT, file));
};

for (const dir of SOURCE_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    for (const name of namesReadBy(readFileSync(file, 'utf8'))) noteRead(name, file);
  }
}
for (const manifest of walkManifests(ROOT)) {
  for (const name of namesReadByScripts(manifest)) noteRead(name, manifest);
}

// --- The four assertions ---------------------------------------------------

const violations = [];

for (const [name, files] of [...read].sort()) {
  if (!declared.has(name)) {
    violations.push({
      rule: 'A',
      detail:
        `${name} is read by ${files[0]}${files.length > 1 ? ` (+${files.length - 1} more)` : ''} ` +
        'but is not declared in turbo.json. Turbo strips it, so the code sees undefined.',
    });
  }
}

for (const name of [...documented].sort()) {
  if (!declared.has(name)) {
    violations.push({
      rule: 'B',
      detail: `${name} is documented in .env.example but not declared in turbo.json, so setting it has no effect.`,
    });
  }
}

for (const [name, where] of [...declared].sort()) {
  if (!read.has(name) && !documented.has(name)) {
    violations.push({
      rule: 'C',
      detail: `${name} is declared in turbo.json ${where} but nothing reads it and .env.example does not document it.`,
    });
  }
}

for (const name of [...documented].sort()) {
  if (!read.has(name) && !(name in READ_BY_DEPENDENCY)) {
    violations.push({
      rule: 'D',
      detail:
        `${name} is documented in .env.example but no source file reads it. ` +
        'Either wire it up or delete the entry; a knob that does nothing is worse than no knob.',
    });
  }
}

// --- Report ----------------------------------------------------------------

if (violations.length > 0) {
  console.error('Environment contract broken:\n');
  for (const rule of ['A', 'B', 'C', 'D']) {
    const group = violations.filter((violation) => violation.rule === rule);
    if (group.length === 0) continue;
    console.error(
      `  [${rule}] ${
        {
          A: 'read by the code, not declared in turbo.json',
          B: 'documented in .env.example, not declared in turbo.json',
          C: 'declared in turbo.json, neither read nor documented',
          D: 'documented in .env.example, read by nothing',
        }[rule]
      } (${group.length})`,
    );
    for (const violation of group) console.error(`      - ${violation.detail}`);
    console.error('');
  }
  console.error(
    `${violations.length} violation(s). Turbo runs in strict env mode; anything undeclared\n` +
      'never reaches the process. Fix turbo.json or .env.example, do not weaken this check.',
  );
  process.exit(1);
}

console.log(
  `Environment contract holds: ${read.size} names read, ${documented.size} documented, ` +
    `${declared.size} declared.`,
);
