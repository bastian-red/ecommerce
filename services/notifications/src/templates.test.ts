import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderOrderEmail,
  sanitizeSubject,
  type OrderEmailData,
} from './templates';

const data: OrderEmailData = {
  orderNumber: 'SHOP-1001',
  email: 'buyer@example.com',
  customerName: 'Ada',
  currency: 'usd',
  items: [
    { productTitle: 'Ear One', variantName: 'White', quantity: 2, lineTotalCents: 29_800 },
    { productTitle: 'USB-C Cable', variantName: '1.5m', quantity: 1, lineTotalCents: 2_900 },
  ],
  subtotalCents: 32_700,
  shippingCents: 0,
  taxCents: 2_861,
  totalCents: 35_561,
  orderUrl: 'http://localhost:3000/orders/order_1',
};

describe('escapeHtml', () => {
  it('escapes every dangerous character', () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Ear One 1.5m')).toBe('Ear One 1.5m');
  });
});

describe('sanitizeSubject', () => {
  it('strips CR and LF, which would be mail header injection', () => {
    expect(sanitizeSubject('Order 1\r\nBcc: attacker@evil.test')).toBe(
      'Order 1 Bcc: attacker@evil.test',
    );
  });
});

describe('renderOrderEmail', () => {
  it('addresses the message to the order email', () => {
    expect(renderOrderEmail('ORDER_CONFIRMED', data).to).toBe('buyer@example.com');
  });

  it('uses the right subject per kind', () => {
    expect(renderOrderEmail('ORDER_CONFIRMED', data).subject).toBe('Order SHOP-1001 confirmed');
    expect(renderOrderEmail('ORDER_FULFILLED', data).subject).toBe('Order SHOP-1001 is on its way');
    expect(renderOrderEmail('ORDER_CANCELLED', data).subject).toBe('Order SHOP-1001 cancelled');
  });

  it('lists every line item in both parts', () => {
    const message = renderOrderEmail('ORDER_CONFIRMED', data);
    for (const part of [message.text, message.html]) {
      expect(part).toContain('Ear One');
      expect(part).toContain('USB-C Cable');
    }
  });

  it('formats money from cents, never from floats', () => {
    const message = renderOrderEmail('ORDER_CONFIRMED', data);
    expect(message.text).toContain('$355.61');
    expect(message.html).toContain('$355.61');
    expect(message.text).not.toContain('35561');
  });

  it('shows the full breakdown so the total is explainable', () => {
    const message = renderOrderEmail('ORDER_CONFIRMED', data);
    expect(message.text).toContain('Subtotal: $327.00');
    expect(message.text).toContain('Shipping: $0.00');
    expect(message.text).toContain('Tax:      $28.61');
    expect(message.text).toContain('Total:    $355.61');
  });

  it('escapes a product title carrying markup, closing the stored-XSS path', () => {
    const message = renderOrderEmail('ORDER_CONFIRMED', {
      ...data,
      items: [
        {
          productTitle: '<img src=x onerror="alert(1)">',
          variantName: 'X',
          quantity: 1,
          lineTotalCents: 100,
        },
      ],
    });
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('escapes a customer name carrying markup', () => {
    const message = renderOrderEmail('ORDER_CONFIRMED', {
      ...data,
      customerName: '</p><script>steal()</script>',
    });
    expect(message.html).not.toContain('<script>');
  });

  it('escapes the order URL, so a crafted one cannot break out of the href', () => {
    const message = renderOrderEmail('ORDER_CONFIRMED', {
      ...data,
      orderUrl: 'http://x/"><script>alert(1)</script>',
    });
    expect(message.html).not.toContain('<script>');
  });

  it('falls back to a neutral greeting when there is no name', () => {
    expect(renderOrderEmail('ORDER_CONFIRMED', { ...data, customerName: '  ' }).text).toContain(
      'Hi there,',
    );
  });

  it('links to the order', () => {
    expect(renderOrderEmail('ORDER_CONFIRMED', data).html).toContain(
      'href="http://localhost:3000/orders/order_1"',
    );
  });

  it('is pure: the same data renders identically', () => {
    expect(renderOrderEmail('ORDER_CONFIRMED', data)).toEqual(
      renderOrderEmail('ORDER_CONFIRMED', data),
    );
  });

  it('renders a single-item order without a stray separator', () => {
    const message = renderOrderEmail('ORDER_FULFILLED', { ...data, items: [data.items[0]!] });
    expect(message.text).toContain('2 x Ear One (White)');
    expect(message.text).not.toContain('USB-C');
  });

  it('formats a non-USD currency', () => {
    const message = renderOrderEmail('ORDER_CONFIRMED', { ...data, currency: 'eur' });
    expect(message.text).toContain('€355.61');
  });
});
