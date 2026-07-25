/**
 * The contract between apps/web, apps/api and apps/worker. One Zod schema per
 * payload, one inferred type beside it, imported by both sides of every call.
 *
 * A schema here is the only place a shape is written down. The API validates
 * request bodies with it through ZodValidationPipe; the web app validates the
 * same forms before it ever hits the network; the worker parses queue jobs with
 * it. Changing a shape in one place is therefore impossible.
 */
import { z } from 'zod';
import { passwordSchema } from '../auth/password-strength';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '../cart/pricing';

export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case');

/** cuid v1, which is what Prisma's `@default(cuid())` emits. */
export const idSchema = z.string().min(1).max(64);

export const currencySchema = z.string().length(3).toLowerCase();

/** Money crossing the wire is always an integer number of minor units. */
export const centsSchema = z.number().int().min(0).max(100_000_000);

export const roleSchema = z.enum(['CUSTOMER', 'ADMIN']);
export type Role = z.infer<typeof roleSchema>;

export const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const orderStatusSchema = z.enum([
  'PENDING',
  'PAID',
  'FULFILLED',
  'CANCELLED',
  'EXPIRED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const stockMovementKindSchema = z.enum([
  'RESERVE',
  'RELEASE',
  'FULFILL',
  'RESTOCK',
  'ADJUST',
]);
export type StockMovementKind = z.infer<typeof stockMovementKindSchema>;

export const paymentStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * Order status is a one-way street. The API consults this table before every
 * transition, so a late or replayed webhook cannot walk an order backwards from
 * FULFILLED to PAID.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['PAID', 'CANCELLED', 'EXPIRED'],
  PAID: ['FULFILLED', 'CANCELLED'],
  FULFILLED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** True once an order can no longer change. Late webhooks against these are ignored. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[status].length === 0;
}

// ---- Auth ----

export const signupSchema = z.object({
  email: z.string().email().max(254),
  password: passwordSchema,
  name: z.string().min(1).max(120),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const sessionUserSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  role: roleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

// ---- Catalog ----

export const categorySchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string(),
});
export type Category = z.infer<typeof categorySchema>;

export const productImageSchema = z.object({
  id: idSchema,
  url: z.string(),
  alt: z.string(),
  position: z.number().int().min(0),
});
export type ProductImage = z.infer<typeof productImageSchema>;

export const productVariantSchema = z.object({
  id: idSchema,
  sku: z.string(),
  name: z.string(),
  priceCents: centsSchema,
  /**
   * `stockOnHand - stockReserved`. The raw counters stay server-side: exposing
   * how much is merely reserved leaks pending-order volume, and the storefront
   * only ever needs to know what it can still sell.
   */
  availableStock: z.number().int().min(0),
  position: z.number().int().min(0),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  title: z.string(),
  description: z.string(),
  status: productStatusSchema,
  category: categorySchema.nullable(),
  images: z.array(productImageSchema),
  variants: z.array(productVariantSchema),
  /** Lowest variant price, so a listing card can render "from $X". */
  fromPriceCents: centsSchema,
});
export type Product = z.infer<typeof productSchema>;

export const productSortSchema = z.enum(['newest', 'price_asc', 'price_desc', 'relevance']);
export type ProductSort = z.infer<typeof productSortSchema>;

export const productQuerySchema = z
  .object({
    /** Free text. Served by the GIN index via websearch_to_tsquery. */
    q: z.string().trim().max(120).optional(),
    category: slugSchema.optional(),
    minPriceCents: centsSchema.optional(),
    maxPriceCents: centsSchema.optional(),
    inStock: z.coerce.boolean().optional(),
    sort: productSortSchema.default('newest'),
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    perPage: z.coerce.number().int().min(1).max(48).default(12),
  })
  .refine(
    (query) =>
      query.minPriceCents === undefined ||
      query.maxPriceCents === undefined ||
      query.minPriceCents <= query.maxPriceCents,
    { message: 'minPriceCents must not exceed maxPriceCents', path: ['minPriceCents'] },
  );
export type ProductQuery = z.infer<typeof productQuerySchema>;

export const productListSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});
export type ProductList = z.infer<typeof productListSchema>;

// ---- Cart ----

export const cartLineInputSchema = z.object({
  variantId: idSchema,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
export type CartLineInput = z.infer<typeof cartLineInputSchema>;

/**
 * PUT sets an exact quantity, and zero is the idiomatic way to say "remove this
 * line". POST (add) has no such meaning, so the two schemas differ by exactly
 * that one bound rather than sharing a loose one.
 */
export const cartLineSetSchema = z.object({
  variantId: idSchema,
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
});
export type CartLineSet = z.infer<typeof cartLineSetSchema>;

export const cartMergeSchema = z.object({
  /** The guest cart id to fold into the caller's cart. */
  from: z.string().min(16).max(64),
});
export type CartMerge = z.infer<typeof cartMergeSchema>;

export const cartLineSchema = z.object({
  variantId: idSchema,
  quantity: z.number().int().min(1),
  productSlug: slugSchema,
  productTitle: z.string(),
  variantName: z.string(),
  sku: z.string(),
  unitPriceCents: centsSchema,
  lineTotalCents: centsSchema,
  imageUrl: z.string().nullable(),
  /** Available stock at read time. The storefront greys out what it cannot sell. */
  availableStock: z.number().int().min(0),
  /**
   * True when the line's quantity now exceeds availability, because someone else
   * bought the stock while this cart sat idle. The cart still renders; checkout
   * refuses until the customer resolves it.
   */
  exceedsStock: z.boolean(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSchema = z.object({
  lines: z.array(cartLineSchema).max(MAX_CART_LINES),
  currency: currencySchema,
  subtotalCents: centsSchema,
  shippingCents: centsSchema,
  taxCents: centsSchema,
  totalCents: centsSchema,
  /** True when any line exceeds stock. Checkout is blocked while this is true. */
  hasStockProblem: z.boolean(),
});
export type Cart = z.infer<typeof cartSchema>;

// ---- Checkout ----

export const addressSchema = z.object({
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(24),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2).toUpperCase(),
});
export type Address = z.infer<typeof addressSchema>;

export const checkoutInputSchema = z.object({
  email: z.string().email().max(254),
  shippingAddress: addressSchema,
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export const checkoutResultSchema = z.object({
  orderId: idSchema,
  orderNumber: z.string(),
  /** Where the browser is sent to pay. Stripe Checkout, or the mock page. */
  checkoutUrl: z.string(),
  sessionId: z.string(),
  totalCents: centsSchema,
  currency: currencySchema,
  /** When the reservation lapses if payment does not land. ISO 8601. */
  reservationExpiresAt: z.string().datetime(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

/**
 * Why a checkout was refused. The storefront maps these to a specific message,
 * so a customer is told "only 2 left of Ear One / Black" rather than "error".
 */
export const checkoutErrorCodeSchema = z.enum([
  'CART_EMPTY',
  'INSUFFICIENT_STOCK',
  'VARIANT_UNAVAILABLE',
  'PRICE_CHANGED',
]);
export type CheckoutErrorCode = z.infer<typeof checkoutErrorCodeSchema>;

export const insufficientStockDetailSchema = z.object({
  variantId: idSchema,
  sku: z.string(),
  productTitle: z.string(),
  variantName: z.string(),
  requested: z.number().int().min(1),
  available: z.number().int().min(0),
});
export type InsufficientStockDetail = z.infer<typeof insufficientStockDetailSchema>;

export const checkoutErrorSchema = z.object({
  code: checkoutErrorCodeSchema,
  message: z.string(),
  details: z.array(insufficientStockDetailSchema).default([]),
});
export type CheckoutError = z.infer<typeof checkoutErrorSchema>;

// ---- Orders ----

export const orderItemSchema = z.object({
  id: idSchema,
  variantId: idSchema,
  productTitle: z.string(),
  variantName: z.string(),
  sku: z.string(),
  unitPriceCents: centsSchema,
  quantity: z.number().int().min(1),
  lineTotalCents: centsSchema,
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: idSchema,
  number: z.string(),
  email: z.string().email(),
  status: orderStatusSchema,
  currency: currencySchema,
  subtotalCents: centsSchema,
  shippingCents: centsSchema,
  taxCents: centsSchema,
  totalCents: centsSchema,
  items: z.array(orderItemSchema),
  shippingAddress: addressSchema,
  reservationExpiresAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  fulfilledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Order = z.infer<typeof orderSchema>;

export const orderListQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  email: z.string().email().max(254).optional(),
  page: z.coerce.number().int().min(1).max(1_000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderListSchema = z.object({
  items: z.array(orderSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});
export type OrderList = z.infer<typeof orderListSchema>;

// ---- Admin ----

export const adminVariantInputSchema = z.object({
  sku: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'SKU must be uppercase alphanumeric with dashes'),
  name: z.string().min(1).max(120),
  priceCents: centsSchema,
  /** Initial physical stock. Later changes go through the stock endpoints. */
  stockOnHand: z.number().int().min(0).max(1_000_000).default(0),
  position: z.number().int().min(0).max(999).default(0),
});
export type AdminVariantInput = z.infer<typeof adminVariantInputSchema>;

export const adminProductInputSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(5_000).default(''),
  status: productStatusSchema.default('DRAFT'),
  categoryId: idSchema.nullable().default(null),
});
export type AdminProductInput = z.infer<typeof adminProductInputSchema>;

export const adminProductUpdateSchema = adminProductInputSchema.partial();
export type AdminProductUpdate = z.infer<typeof adminProductUpdateSchema>;

/**
 * Stock is never set to an absolute number by the admin UI. A restock or an
 * adjustment is a delta, because two admins editing the same variant with
 * absolute values silently lose one of the two edits; deltas commute.
 */
export const stockChangeSchema = z.object({
  kind: z.enum(['RESTOCK', 'ADJUST']),
  /** Positive for RESTOCK. Signed and non-zero for ADJUST. */
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().max(200).default(''),
});
export type StockChange = z.infer<typeof stockChangeSchema>;

export const stockLedgerEntrySchema = z.object({
  id: idSchema,
  variantId: idSchema,
  sku: z.string(),
  orderId: idSchema.nullable(),
  orderNumber: z.string().nullable(),
  kind: stockMovementKindSchema,
  onHandDelta: z.number().int(),
  reservedDelta: z.number().int(),
  reason: z.string(),
  createdAt: z.string().datetime(),
});
export type StockLedgerEntry = z.infer<typeof stockLedgerEntrySchema>;

export const adminStockViewSchema = z.object({
  variantId: idSchema,
  sku: z.string(),
  productTitle: z.string(),
  variantName: z.string(),
  stockOnHand: z.number().int().min(0),
  stockReserved: z.number().int().min(0),
  availableStock: z.number().int().min(0),
});
export type AdminStockView = z.infer<typeof adminStockViewSchema>;

export const adminImageInputSchema = z.object({
  alt: z.string().max(200).default(''),
  position: z.number().int().min(0).max(99).default(0),
});
export type AdminImageInput = z.infer<typeof adminImageInputSchema>;

// ---- Health ----

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number().min(0),
  checks: z.object({
    database: z.boolean(),
    redis: z.boolean(),
  }),
  version: z.string(),
  timestamp: z.string().datetime(),
});
export type Health = z.infer<typeof healthSchema>;

// ---- Worker queue jobs ----

export const releaseExpiredJobSchema = z.object({
  orderId: idSchema,
});
export type ReleaseExpiredJob = z.infer<typeof releaseExpiredJobSchema>;

export const orderEmailJobSchema = z.object({
  orderId: idSchema,
  kind: z.enum(['ORDER_CONFIRMED', 'ORDER_FULFILLED', 'ORDER_CANCELLED']),
});
export type OrderEmailJob = z.infer<typeof orderEmailJobSchema>;

export const QUEUE_NAMES = {
  reservations: 'reservations',
  emails: 'emails',
} as const;
