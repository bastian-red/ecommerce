# Deploying to Railway

Five services in one project: `web`, `api`, `worker`, managed `Postgres`, managed
`Redis`. Every trap below has already cost a deploy once, so they are written
down rather than remembered.

## 1. Provision the databases first

Create the managed `Postgres` and `Redis` services from Railway's official
templates before any application service. They publish the reference variables
everything else points at.

## 2. Create the three application services from this repo

Each one builds from its own Dockerfile at the repo root:

| Service | Dockerfile | Public? |
|---|---|---|
| `api` | `infra/Dockerfile.api` | yes |
| `web` | `infra/Dockerfile.web` | yes |
| `worker` | `infra/Dockerfile.worker` | no |

## 3. Variables

Shared by `api` and `worker`:

```
DATABASE_URL      = ${{Postgres.DATABASE_URL}}
REDIS_URL         = ${{Redis.REDIS_URL}}
AUTH_SECRET       = <openssl rand -base64 32>   # identical across all three
APP_BASE_URL      = https://<web domain>
```

`api` additionally:

```
PORT                  = 4000
API_BASE_URL          = https://<api domain>
PAYMENTS_DRIVER       = stripe
STRIPE_SECRET_KEY     = sk_test_...      # pasted by hand, never committed
STRIPE_WEBHOOK_SECRET = whsec_...        # from the endpoint created in step 5
STORAGE_DRIVER        = local
STORAGE_LOCAL_DIR     = /data/uploads    # mount a volume here
STORAGE_PUBLIC_URL    = https://<api domain>/media
```

`web` additionally:

```
API_BASE_URL             = http://api.railway.internal:4000   # private network
NEXT_PUBLIC_API_BASE_URL = https://<api domain>
HOSTNAME                 = 0.0.0.0
PAYMENTS_DRIVER          = stripe
```

### The four things that break a deploy

1. **`PORT=4000` on `api`.** Railway probes the port it thinks the service uses.
   Nest listens on `API_PORT` or `PORT`; set `PORT` so both agree.
2. **`HOSTNAME=0.0.0.0` on `web`.** Next's standalone server binds localhost by
   default, and a container that answers only itself fails every health probe.
3. **`NEXT_PUBLIC_API_BASE_URL` must be set before the build.** It is inlined
   into the browser bundle at build time. Setting it as a runtime variable
   produces an app whose client code still points at localhost.
4. **`preDeployCommand` on `api`:** `npx prisma migrate deploy --schema=prisma/schema.prisma`.
   Migrations must run before the new code serves traffic, and only one service
   should run them.

## 4. Health checks

Set `api`'s healthcheck path to `/health`. It returns 503 when Postgres or Redis
is unreachable, so a bad deploy fails rather than going live broken.

## 5. Stripe

With `PAYMENTS_DRIVER=stripe`:

1. Create a webhook endpoint in the Stripe dashboard pointing at
   `https://<api domain>/webhooks/stripe`.
2. Subscribe it to `checkout.session.completed`,
   `checkout.session.expired` and `payment_intent.payment_failed`.
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.

The API refuses to boot if `PAYMENTS_DRIVER=stripe` and either key is missing,
rather than silently falling back to the mock driver and taking orders it never
charges for. The `/webhooks/mock` endpoint rejects everything while the Stripe
driver is active, and `/mock-checkout/*` returns 404.

## 6. Monitoring

Point [Updown](https://updown.io) at `https://<api domain>/health` and put the
badge in the README. The check is meaningful because the endpoint verifies its
dependencies; a green check here means the database and Redis are genuinely up.

## 7. Verify

```bash
curl https://<api domain>/health          # 200, db + redis true
APP_BASE_URL=https://<web domain> \
API_BASE_URL=https://<api domain> \
  pnpm --filter @shop/e2e exec playwright test --grep "health|browse"
```

Running the read-only specs against production is the completion proof. Do not
run the full suite there: it drives stock to zero and creates orders.
