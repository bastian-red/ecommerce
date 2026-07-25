-- Hand-written migration. These are the guarantees Prisma cannot express in the
-- schema language, and they are the reason this project is not a toy store.

-- 1. Overselling is structurally impossible.
--
-- Available stock is stock_on_hand - stock_reserved. This CHECK makes any state
-- where a variant has more units reserved than it physically holds, or negative
-- stock of either kind, un-committable. The conditional UPDATEs in
-- apps/api/src/inventory/inventory.service.ts are the fast path that returns a
-- clean 409; this constraint is the guarantee that survives a bug in that code.
ALTER TABLE "product_variants"
  ADD CONSTRAINT "variant_stock_non_negative"
  CHECK (
    "stock_on_hand" >= 0
    AND "stock_reserved" >= 0
    AND "stock_reserved" <= "stock_on_hand"
  );

-- 2. Order lines are always positive and internally consistent.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_item_line_total_matches"
  CHECK ("line_total_cents" = "unit_price_cents" * "quantity");

-- 3. Money is never negative.
ALTER TABLE "orders"
  ADD CONSTRAINT "order_amounts_non_negative"
  CHECK (
    "subtotal_cents" >= 0
    AND "tax_cents" >= 0
    AND "shipping_cents" >= 0
    AND "total_cents" >= 0
  );

ALTER TABLE "product_variants"
  ADD CONSTRAINT "variant_price_non_negative" CHECK ("price_cents" >= 0);

-- 4. An order can be paid at most once.
--
-- A customer who abandons checkout and retries gets a second payment row for a
-- second provider session, which is correct. This partial unique index makes it
-- impossible for two of them to reach SUCCEEDED — so a duplicated, replayed or
-- out-of-order webhook cannot double-charge the order in our books.
CREATE UNIQUE INDEX "payments_one_succeeded_per_order"
  ON "payments" ("order_id")
  WHERE "status" = 'SUCCEEDED';

-- 5. Full-text catalogue search.
--
-- A GIN expression index rather than a generated tsvector column: it needs no
-- schema change, so Prisma never sees drift. CatalogService.search issues the
-- byte-identical expression, which is what lets the planner use this index.
CREATE INDEX "products_search_idx" ON "products" USING GIN (
  (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
  )
);

-- 6. The reservation sweeper's access path.
--
-- Partial: the sweeper only ever looks at PENDING orders, so the index stays
-- small no matter how many completed orders accumulate.
CREATE INDEX "orders_pending_expiry_idx"
  ON "orders" ("reservation_expires_at")
  WHERE "status" = 'PENDING';
