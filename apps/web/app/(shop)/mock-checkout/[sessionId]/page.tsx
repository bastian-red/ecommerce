import { notFound } from 'next/navigation';
import { MockCheckoutForm } from './mock-checkout-form';

export const dynamic = 'force-dynamic';

/**
 * The mock gateway's hosted page.
 *
 * It 404s unless PAYMENTS_DRIVER=mock. That is the guard that keeps a fake
 * payment page from existing on a production deploy that runs Stripe, and an E2E
 * test asserts it. The check reads the environment directly rather than asking
 * the API, so it holds even if the API is unreachable.
 */
export default async function MockCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.PAYMENTS_DRIVER !== 'mock') notFound();

  const { sessionId } = await params;
  const query = await searchParams;

  const orderId = typeof query.order === 'string' ? query.order : '';
  const amountCents = Number(typeof query.amount === 'string' ? query.amount : '0');
  const currency = typeof query.currency === 'string' ? query.currency : 'usd';
  const successUrl = typeof query.success === 'string' ? query.success : '/';
  const cancelUrl = typeof query.cancel === 'string' ? query.cancel : '/cart';

  if (!orderId || !Number.isFinite(amountCents)) notFound();

  return (
    <main className="container" style={{ maxWidth: 560 }}>
      <h1>Payment</h1>
      <p className="product-meta" data-testid="mock-session">
        Session {sessionId}
      </p>
      <MockCheckoutForm
        sessionId={sessionId}
        orderId={orderId}
        amountCents={amountCents}
        currency={currency}
        successUrl={successUrl}
        cancelUrl={cancelUrl}
      />
    </main>
  );
}
