/**
 * Mock-only entry point.
 *
 * The web app's mock checkout page needs to sign a webhook, and nothing else. It
 * imports this rather than the package root so the Stripe SDK never enters the
 * web server's module graph: the storefront has no business carrying a payment
 * provider's client library.
 */
export { SIGNATURE_HEADER, signPayload, verifySignature } from './signature';
export {
  MOCK_EVENT_TYPES,
  buildMockWebhookRequest,
  isMockEventType,
  parseMockEvent,
  type MockEvent,
  type MockEventType,
} from './mock-driver';
export { WebhookSignatureError, type ParsedWebhook } from './types';
