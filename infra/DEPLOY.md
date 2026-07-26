# Deploying

Two Vercel projects, one Supabase project, one Upstash database. No always-on
process anywhere, which is what keeps the whole thing on free tiers.

For why this stack rather than a PaaS, and how to reuse it, see
[PORTFOLIO-STACK.md](./PORTFOLIO-STACK.md).

---

## 1. Supabase

Create a project, then from **Project Settings → Database**:

- **Connection pooling → Transaction** gives the app URL. Append
  `?pgbouncer=true&connection_limit=1`.
- **Direct connection** gives the migration URL.

Both are needed and they are not interchangeable. Transaction-mode pooling does
not support prepared statements, so Prisma must be told to stop generating them
(`pgbouncer=true`); and migrations cannot run through that pooler at all, which
is what `directUrl` in `packages/db/prisma/schema.prisma` exists for.

`connection_limit=1` is not a typo. Each serverless instance gets its own pool,
so anything higher multiplies by the number of warm instances and exhausts the
database's connection limit under load.

Then create a **public** Storage bucket named `product-images`, and generate S3
credentials under **Storage → Settings**. The bucket is S3-compatible, so the
existing `createS3Driver` talks to it unchanged.

Apply the schema from your machine, over the **direct** URL:

```bash
DIRECT_DATABASE_URL='<direct url>' DATABASE_URL='<direct url>' \
  pnpm --filter @shop/db exec prisma migrate deploy

DATABASE_URL='<direct url>' pnpm --filter @shop/db run seed
```

The `_reservation_sweep` migration schedules a `pg_cron` job automatically where
the extension is available. Confirm it landed:

```sql
select jobname, schedule from cron.job;
select * from release_expired_reservations(100);
```

If `cron.job` does not exist, enable **pg_cron** under Database → Extensions and
re-run the `cron.schedule` block from that migration. The application is still
correct without it — the lazy sweep in the checkout path covers the case that
matters — but orders would then only reach `EXPIRED` when someone shops.

## 2. Upstash

Create a Redis database and take the `rediss://` URL. Carts and rate limiting
only; the free allowance is 500K commands/month, which is ample for that and
would not be for anything queue-shaped.

## 3. Vercel

Two projects from the same repository. Both need **Root Directory** set, and
both need the install command run from the repo root so the workspace resolves.

| Project | Root Directory | Config |
|---|---|---|
| `shop-api` | `apps/api` | `apps/api/vercel.json` |
| `shop-web` | `apps/web` | `apps/web/vercel.json` |

Deploy the API first: the web app needs its URL.

### API variables

```
DATABASE_URL          = <pooler url>?pgbouncer=true&connection_limit=1
DIRECT_DATABASE_URL   = <direct url>
REDIS_URL             = <upstash rediss:// url>
AUTH_SECRET           = <openssl rand -base64 32>   # identical in both projects
APP_BASE_URL          = https://<web>.vercel.app
API_BASE_URL          = https://<api>.vercel.app
PAYMENTS_DRIVER       = stripe
STRIPE_SECRET_KEY     = sk_test_...
STRIPE_WEBHOOK_SECRET = whsec_...                   # from step 4
STORAGE_DRIVER        = s3
S3_BUCKET             = product-images
S3_REGION             = <supabase region>
S3_ENDPOINT           = https://<ref>.supabase.co/storage/v1/s3
S3_ACCESS_KEY_ID      = <supabase storage key>
S3_SECRET_ACCESS_KEY  = <supabase storage secret>
STORAGE_PUBLIC_URL    = https://<ref>.supabase.co/storage/v1/object/public/product-images
```

### Web variables

```
AUTH_SECRET              = <the same value as the API>
AUTH_URL                 = https://<web>.vercel.app
API_BASE_URL             = https://<api>.vercel.app
NEXT_PUBLIC_API_BASE_URL = https://<api>.vercel.app
APP_BASE_URL             = https://<web>.vercel.app
PAYMENTS_DRIVER          = stripe
```

`NEXT_PUBLIC_API_BASE_URL` is inlined into the browser bundle **at build time**.
Adding it after a deploy changes nothing until the next build, and the symptom is
a site whose client code still calls localhost.

`AUTH_SECRET` must be byte-identical across the two projects. The web app mints
an HS256 service token with it and the API verifies with it; a mismatch is a
total auth outage that looks like every admin request returning 401.

## 4. Stripe

1. Create a webhook endpoint pointing at `https://<api>.vercel.app/webhooks/stripe`.
2. Subscribe it to `checkout.session.completed`, `checkout.session.expired` and
   `payment_intent.payment_failed`.
3. Put the signing secret in `STRIPE_WEBHOOK_SECRET` and redeploy the API.

The API refuses to boot if `PAYMENTS_DRIVER=stripe` and either key is missing,
rather than silently falling back to the mock driver and taking orders it never
charges for. With Stripe active, `/webhooks/mock` rejects everything and
`/mock-checkout/*` returns 404.

## 5. Verify, in this order

```bash
# Dependencies are genuinely checked; this is 503 when either is down.
curl https://<api>.vercel.app/health

# The highest-risk item: raw body survives the serverless adapter. A 400 here
# means the signature failed and the body was consumed before Nest saw it.
# 503 is the correct answer for an unknown order and proves the MAC verified.
curl -i -X POST https://<api>.vercel.app/webhooks/mock \
  -H 'content-type: application/json' -H 'x-mock-signature: t=1,v1=deadbeef' -d '{}'
```

Then the read-only browser specs against production:

```bash
APP_BASE_URL=https://<web>.vercel.app API_BASE_URL=https://<api>.vercel.app \
  pnpm --filter @shop/e2e exec playwright test --grep "health|browse"
```

Do not run the full suite against production: it drives stock to zero, creates
orders and adjusts inventory.

Finally, race the pooler by hand — this is what validates `connection_limit=1`
under interactive transactions, which CI cannot cover because CI has no pooler.
Take a variant down to one unit in the admin panel, then open two browsers and
check out simultaneously. Exactly one must succeed and the other must get a
clean "only 0 left", not a 500.

## 6. Monitoring

Point [Updown](https://updown.io) at `https://<api>.vercel.app/health` and put
the badge in the README. The check is meaningful because the endpoint verifies
its dependencies rather than returning a static 200.

It also does a second job: Supabase pauses a free project after 7 days without
activity, and a health check that runs `SELECT 1` every minute is activity.
