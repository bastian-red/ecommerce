-- The reservation sweep, in the database.
--
-- There used to be an always-on worker process doing this on a 30-second timer.
-- It is gone, because an always-on process is the one thing a free serverless
-- deploy cannot have, and because the timer was never the real mechanism: a
-- queued job can be lost, a query over the orders table cannot miss a row that
-- is sitting in it.
--
-- Expiry now has two triggers. The API sweeps lazily at the start of every
-- checkout, which is the one that matters — a stale reservation only costs
-- anything when it is standing between a customer and stock they want. This
-- function is the backstop, so orders still reach EXPIRED with zero traffic and
-- the admin's numbers stay honest.
--
-- Putting it here rather than behind an HTTP endpoint and an external cron
-- service means no shared secret to leak, no third-party scheduler to depend on,
-- and no network hop between the logic and the rows it operates on. On Supabase
-- it has a useful side effect: a job that touches the database every minute is
-- also what stops a free project being paused for inactivity.

CREATE OR REPLACE FUNCTION release_expired_reservations(batch_size integer DEFAULT 100)
RETURNS TABLE (expired_orders integer, released_lines integer)
LANGUAGE plpgsql
AS $$
DECLARE
  order_ids text[];
  orders_count integer := 0;
  lines_count integer := 0;
BEGIN
  -- Claim the past-due orders in one statement.
  --
  -- FOR UPDATE SKIP LOCKED is what makes this safe to run concurrently with
  -- itself and with the API's lazy sweep: a row another transaction is already
  -- expiring is skipped rather than waited on, so overlapping sweeps divide the
  -- work instead of blocking each other.
  --
  -- The status and deadline are re-checked inside the UPDATE, not just in the
  -- SELECT, so an order paid between the two cannot be expired out from under a
  -- customer who has already been charged.
  WITH due AS (
    SELECT "id"
      FROM "orders"
     WHERE "status" = 'PENDING'::"OrderStatus"
       AND "reservation_expires_at" IS NOT NULL
       AND "reservation_expires_at" <= NOW()
     ORDER BY "reservation_expires_at" ASC
     LIMIT batch_size
       FOR UPDATE SKIP LOCKED
  ),
  expired AS (
    UPDATE "orders" o
       SET "status" = 'EXPIRED'::"OrderStatus",
           "closed_at" = NOW(),
           "updated_at" = NOW()
      FROM due
     WHERE o."id" = due."id"
       AND o."status" = 'PENDING'::"OrderStatus"
       AND o."reservation_expires_at" <= NOW()
    RETURNING o."id"
  )
  SELECT array_agg("id") INTO order_ids FROM expired;

  IF order_ids IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  orders_count := array_length(order_ids, 1);

  -- Give the stock back.
  --
  -- The quantities are summed per variant BEFORE the UPDATE, and that is not a
  -- tidiness choice. `UPDATE ... FROM` applies only one matching row per target
  -- row: if three expiring orders each hold one unit of the same variant, the
  -- naive join decrements by one and silently strands the other two. Aggregating
  -- first makes it one row per variant, which is the only shape `UPDATE ... FROM`
  -- handles correctly.
  --
  -- The guard `stock_reserved >= total` is the same one InventoryService.release
  -- uses, now applied to the aggregate: either every line for that variant is
  -- released or none is. That is what keeps this idempotent — a variant some
  -- other sweep already released updates zero rows and writes no ledger entry,
  -- rather than driving the counter negative.
  --
  -- Ordering by variant id gives every sweep the same lock order as every
  -- checkout, so the two cannot deadlock against each other.
  WITH lines AS (
    SELECT oi."order_id", oi."variant_id", oi."quantity"
      FROM "order_items" oi
     WHERE oi."order_id" = ANY(order_ids)
  ),
  totals AS (
    SELECT "variant_id", SUM("quantity")::integer AS total
      FROM lines
     GROUP BY "variant_id"
     ORDER BY "variant_id" ASC
  ),
  released AS (
    UPDATE "product_variants" v
       SET "stock_reserved" = v."stock_reserved" - totals.total,
           "updated_at" = NOW()
      FROM totals
     WHERE v."id" = totals."variant_id"
       AND v."stock_reserved" >= totals.total
    RETURNING v."id" AS variant_id
  ),
  logged AS (
    -- One ledger row per order line, not per variant, so the audit trail still
    -- says which order released what. Every stock movement leaves a ledger row:
    -- summing a variant's ledger has to reconstruct its counters, and a release
    -- that skipped the ledger would silently break that reconciliation.
    INSERT INTO "stock_ledger" ("id", "variant_id", "order_id", "kind",
                                "on_hand_delta", "reserved_delta", "reason", "created_at")
    SELECT gen_random_uuid()::text, lines."variant_id", lines."order_id",
           'RELEASE'::"StockMovementKind", 0, -lines."quantity",
           'reservation-expired', NOW()
      FROM lines
      JOIN released ON released.variant_id = lines."variant_id"
    RETURNING 1
  )
  SELECT count(*)::integer INTO lines_count FROM logged;

  RETURN QUERY SELECT orders_count, lines_count;
END;
$$;

COMMENT ON FUNCTION release_expired_reservations(integer) IS
  'Expire past-due PENDING orders and return their reserved stock. Idempotent and safe to run concurrently.';

-- Schedule it every minute where pg_cron exists (Supabase enables it; a plain
-- Postgres container in CI does not). The DO block keeps this migration
-- portable: without pg_cron the function is still created and still callable,
-- which is all the integration tests need, and the API's lazy sweep is
-- unaffected either way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- Unschedule first so re-running this migration cannot stack duplicate jobs.
    PERFORM cron.unschedule('release-expired-reservations')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'release-expired-reservations'
      );

    PERFORM cron.schedule(
      'release-expired-reservations',
      '* * * * *',
      $cron$SELECT release_expired_reservations(100)$cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron is unavailable; release_expired_reservations() created but not scheduled.';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Not permitted to schedule pg_cron here; schedule release_expired_reservations() by hand.';
END;
$$;
