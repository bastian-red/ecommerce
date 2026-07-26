# The free portfolio stack

The hosting pattern this project uses, written down so the rest of the portfolio
does not have to rediscover it. Researched July 2026; free tiers move, so the
dated findings below are worth re-checking before leaning on them.

## Why not a PaaS

The obvious answer is Railway or Render: push a repo, get a container, done. Both
were ruled out for concrete reasons rather than taste.

- **Railway Hobby caps a workspace at 2 projects.** This portfolio is 13. Even
  paying, it houses two of them.
- **Render's free tier** sleeps a web service after 15 minutes with a 30–60 s
  cold start, which an uptime monitor reads as an outage; background workers are
  paid-only; and **free Postgres is deleted after 30 days**, which is
  disqualifying for anything meant to stay up.
- **Fly.io** ended its free tier, and **Koyeb** closed free signups after being
  acquired.

What is genuinely free and stays up is the serverless triangle: Vercel for
compute, a managed Postgres, and a managed Redis.

## The shape

| Concern | Provider | Free-tier catch |
|---|---|---|
| Web + API | Vercel Hobby | No always-on processes. Cron is **once per day**, jittered within the hour. Commercial use prohibited — fine for a portfolio. |
| Postgres | Supabase | Pauses after 7 days idle. Bundles S3-compatible Storage. |
| Redis | Upstash | 500K commands/month, 256 MB, 10 GB bandwidth. **One free database per account**, not per project. |
| Object storage | Supabase Storage or Cloudflare R2 | Both S3-compatible. |
| Monitoring | Updown | Doubles as the keep-alive that prevents the Supabase pause. |

## The four constraints that shape the code

Everything awkward about this stack comes from one of these. Design for them up
front rather than discovering them at deploy time.

### 1. No always-on process, and no useful cron

Vercel Hobby crons run **once a day**. Anything needing finer granularity has to
live somewhere else.

The pattern that works: **do the work lazily in the request path, and put the
backstop in the database.** In this project, expired stock reservations are
reclaimed at the start of every checkout — the moment they actually matter — and
a `pg_cron` job runs the same guarded SQL every minute so the state stays honest
with zero traffic. Neither needs a process, and the two are safe to run
concurrently (`FOR UPDATE SKIP LOCKED`).

That is usually *better* than a timer, not a compromise. A background sweep on a
30-second interval is, at best, 30 seconds late; the lazy one is never late for
the only case that matters.

### 2. Job queues do not fit

BullMQ polls Redis continuously even when idle, and Upstash charges per command
against a 500K monthly allowance. Two queues exhaust it in days; Upstash's own
documentation recommends a paid plan for BullMQ.

Note also that the free allowance covers **one database for the whole account**.
Further databases are $0.50/month each, so a portfolio of thirteen projects that
all want Redis is a real (if small) line item. Prefer designs that do not need
Redis at all; where it is only carrying rate-limit counters, an in-memory limiter
is usually the honest choice for a single-instance demo.

So on this stack, work is either done inline or driven from the database. If a
project genuinely needs a durable queue, that project needs a different host —
which is a real, defensible reason to spend money on one project rather than
spreading a queue thinly across all of them.

### 3. Postgres is behind a pooler

Serverless means many short-lived instances, and each one opening its own
connection will exhaust a small Postgres. The pooler is mandatory, and it changes
the Prisma configuration:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")         // pooler + ?pgbouncer=true&connection_limit=1
  directUrl = env("DIRECT_DATABASE_URL")  // migrations only
}
```

- `pgbouncer=true` disables prepared statements, which transaction-mode pooling
  cannot carry.
- `connection_limit=1` bounds each instance; higher multiplies across warm
  instances.
- `directUrl` is **required by Prisma with no fallback**, so set it locally and
  in CI too — to the same value as `DATABASE_URL` when there is no pooler.

Interactive transactions still work, but they hold a pooled connection for their
whole duration. Keep them short and verify concurrency against the real pooler
once, because CI runs against a plain Postgres container and will not catch this.

### 4. Prisma's client must be generated into the package

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../generated/client"
}
```

The default location is inside pnpm's content-addressed store, and any
production install that rebuilds `node_modules` — a Docker image, `pnpm deploy
--prod`, a Vercel build — silently drops it. Emitting it into the package makes
it an ordinary build output. Add it to `.gitignore` and generate it in the build
command.

## Per-project checklist

1. Supabase project → pooler URL, direct URL, Storage bucket, S3 credentials.
2. Upstash database → `rediss://` URL.
3. Two Vercel projects with **Root Directory** set (`apps/web`, `apps/api`).
4. NestJS on Vercel: a one-line `api/index.ts` re-exporting a handler that caches
   the bootstrapped app in a module-scoped **promise** (so a cold start does not
   bootstrap twice) and calls `app.init()` rather than `listen()`.
5. `AUTH_SECRET` byte-identical across both projects.
6. `NEXT_PUBLIC_*` set **before** the build; it is inlined into the bundle.
7. Migrations from a laptop over the direct URL, not from a build step.
8. Updown on `/health`.

## The traps, in one list

- `NEXT_PUBLIC_*` added after a deploy does nothing until the next build.
- A mismatched `AUTH_SECRET` between web and API looks like every request 401ing.
- `output: 'standalone'` is for Docker; Vercel does not want it. Gate it on
  `process.env.VERCEL`.
- Webhook signature verification needs the **raw** body. Verify it against the
  deployed URL, not just locally — the serverless adapter is a real risk and a
  400 there means something consumed the body first.
- `cookies()` or `auth()` in a Next.js root layout opts **every** page out of
  static rendering. Push that into a client component fed by a route handler.
- `UPDATE ... FROM` applies only one matching row per target row. Aggregate
  before updating, or a sweep touching one variant from three orders decrements
  by one and strands the rest.
- Upstash gives you the **TCP** endpoint (`rediss://…:6379`) and a **REST**
  endpoint (`UPSTASH_REDIS_REST_URL` + token). `ioredis` needs the TCP one.
  Pasting the REST URL into `REDIS_URL` fails at connect time, and the console
  shows the REST pair more prominently.
- Docker Compose derives its project name from the containing directory. Every
  project here has an `infra/`, so set `name:` explicitly or two stacks evict
  each other's containers and volumes.
