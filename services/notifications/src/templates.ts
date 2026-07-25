/**
 * Order email templates. Pure functions of order data: no clock, no database, no
 * transport, so every one is asserted character by character in the gate tests.
 *
 * Everything interpolated into the HTML is escaped. Product titles and customer
 * names are user-supplied, and an unescaped `<img onerror=...>` in a product
 * title becomes an injection in every confirmation email the store ever sends.
 * The subject line is stripped of CR/LF for the same reason at the header level:
 * a newline in a subject is header injection, which is how a mail server is
 * turned into an open relay.
 */
import type { EmailMessage } from './channel';

export type OrderEmailKind = 'ORDER_CONFIRMED' | 'ORDER_FULFILLED' | 'ORDER_CANCELLED';

export interface OrderEmailItem {
  productTitle: string;
  variantName: string;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderEmailData {
  orderNumber: string;
  email: string;
  customerName: string;
  currency: string;
  items: OrderEmailItem[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  orderUrl: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escape a value for interpolation into a template. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Strip anything that could inject a mail header. */
export function sanitizeSubject(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

interface Copy {
  subject: (data: OrderEmailData) => string;
  heading: string;
  lead: (data: OrderEmailData) => string;
}

const COPY: Readonly<Record<OrderEmailKind, Copy>> = {
  ORDER_CONFIRMED: {
    subject: (data) => `Order ${data.orderNumber} confirmed`,
    heading: 'Order confirmed',
    lead: () => 'Thanks for your order. We have your payment and are getting it ready.',
  },
  ORDER_FULFILLED: {
    subject: (data) => `Order ${data.orderNumber} is on its way`,
    heading: 'Order shipped',
    lead: () => 'Your order has left the warehouse.',
  },
  ORDER_CANCELLED: {
    subject: (data) => `Order ${data.orderNumber} cancelled`,
    heading: 'Order cancelled',
    lead: () =>
      'Your order was cancelled and the items have been returned to stock. ' +
      'Any authorised payment has been released.',
  },
};

export function renderOrderEmail(kind: OrderEmailKind, data: OrderEmailData): EmailMessage {
  const copy = COPY[kind];
  const subject = sanitizeSubject(copy.subject(data));
  const greeting = data.customerName.trim() || 'there';

  const textLines = [
    `Hi ${greeting},`,
    '',
    copy.lead(data),
    '',
    `Order ${data.orderNumber}`,
    '',
    ...data.items.map(
      (item) =>
        `  ${item.quantity} x ${item.productTitle} (${item.variantName})  ` +
        `${money(item.lineTotalCents, data.currency)}`,
    ),
    '',
    `Subtotal: ${money(data.subtotalCents, data.currency)}`,
    `Shipping: ${money(data.shippingCents, data.currency)}`,
    `Tax:      ${money(data.taxCents, data.currency)}`,
    `Total:    ${money(data.totalCents, data.currency)}`,
    '',
    `View your order: ${data.orderUrl}`,
  ];

  const rows = data.items
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.productTitle)} <span>${escapeHtml(item.variantName)}</span></td>
        <td align="right">${item.quantity}</td>
        <td align="right">${escapeHtml(money(item.lineTotalCents, data.currency))}</td>
      </tr>`,
    )
    .join('');

  const html = `
<h1>${escapeHtml(copy.heading)}</h1>
<p>Hi ${escapeHtml(greeting)},</p>
<p>${escapeHtml(copy.lead(data))}</p>
<p><strong>Order ${escapeHtml(data.orderNumber)}</strong></p>
<table role="presentation" width="100%">
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td colspan="2">Subtotal</td><td align="right">${escapeHtml(money(data.subtotalCents, data.currency))}</td></tr>
    <tr><td colspan="2">Shipping</td><td align="right">${escapeHtml(money(data.shippingCents, data.currency))}</td></tr>
    <tr><td colspan="2">Tax</td><td align="right">${escapeHtml(money(data.taxCents, data.currency))}</td></tr>
    <tr><td colspan="2"><strong>Total</strong></td><td align="right"><strong>${escapeHtml(money(data.totalCents, data.currency))}</strong></td></tr>
  </tfoot>
</table>
<p><a href="${escapeHtml(data.orderUrl)}">View your order</a></p>
`.trim();

  return { to: data.email, subject, html, text: textLines.join('\n') };
}
