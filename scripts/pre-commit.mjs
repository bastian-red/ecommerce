#!/usr/bin/env node
/**
 * Pre-commit gate. Three checks, all mandatory, none skippable with --no-verify
 * without also skipping the others:
 *
 *   1. gitleaks protect --staged  — secret detection is deterministic work, so it
 *      is a tool, not a judgement call. A finding aborts the commit.
 *   2. env-contract.mjs           — turbo runs in strict env mode, so a variable
 *      the code reads but turbo.json does not declare is silently undefined at
 *      runtime. Free, instant, and it runs before the tests because it explains
 *      a whole class of failures the tests would only show as a symptom.
 *   3. pnpm test                  — the gate lane only (fast, no network, no DB).
 *
 * Integration and E2E lanes are deliberately NOT here: they need Postgres, Redis
 * and browsers, which would make committing slow and flaky. CI runs those.
 */
import { spawnSync } from 'node:child_process';

const steps = [
  {
    name: 'gitleaks (staged secret scan)',
    cmd: 'gitleaks',
    args: ['protect', '--staged', '--no-banner', '--redact', '--config', '.gitleaks.toml'],
    // gitleaks is installed per-machine, not via pnpm. Missing binary is a hard
    // failure: silently skipping the secret scan is exactly the outcome we are
    // guarding against.
    required: true,
  },
  {
    name: 'environment contract',
    cmd: 'node',
    args: ['scripts/env-contract.mjs'],
    required: true,
  },
  {
    name: 'gate tests',
    cmd: 'pnpm',
    args: ['run', 'test'],
    required: true,
  },
];

for (const step of steps) {
  process.stdout.write(`\n▶ ${step.name}\n`);
  const res = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: false });

  if (res.error && res.error.code === 'ENOENT') {
    process.stderr.write(
      `\n✖ ${step.name}: '${step.cmd}' is not installed or not on PATH.\n` +
        `  Install it and retry. Do not bypass this hook with --no-verify.\n`,
    );
    process.exit(1);
  }
  if (res.status !== 0) {
    process.stderr.write(`\n✖ ${step.name} failed. Commit aborted.\n`);
    process.exit(res.status ?? 1);
  }
}

process.stdout.write('\n✔ pre-commit checks passed\n');
