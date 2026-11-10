import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MercadoPagoOrdersProvider,
  toDuration,
  toPayments,
} from './mercadopago-orders.provider.js';
import type { CheckoutRequest } from './payment-provider.js';

/** Fictitious credential: nothing here reaches Mercado Pago. */
const TOKEN = 'TEST-fake-access-token';
const TENANT = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let sent: Sent[] = [];

/** HTTP double for the SDK: it calls the global `fetch`. */
function respond(...responses: { status: number; body?: unknown }[]): void {
  sent = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = queue.shift() ?? { status: 500, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(next.body ?? {}), {
        status: next.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

const checkout: CheckoutRequest = {
  tenantId: TENANT,
  externalReference: '9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a',
  title: 'Stand A01 — Feria de prueba',
  amountCents: 4_500_050,
  currency: 'ARS',
  expiresAt: new Date(Date.now() + 870_000),
  backUrls: {
    success: 'https://web.example.test/checkout/success',
    pending: 'https://web.example.test/checkout/pending',
    failure: 'https://web.example.test/checkout/failure',
  },
  payer: { email: 'ana@feriante.test', firstName: 'Ana', lastName: 'Pérez' },
};

const sandbox = () =>
  new MercadoPagoOrdersProvider({ environment: 'sandbox', accessToken: TOKEN });

const order = {
  id: 'ORDTST01ABC',
  status: 'created',
  checkout_url:
    'https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORDTST01ABC',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toDuration', () => {
  const from = new Date('2026-11-10T12:00:00.000Z');
  it.each([
    [870_000, 'PT14M30S'],
    [60_000, 'PT1M'],
    [3_600_000, 'PT1H'],
    [5_400_000, 'PT1H30M'],
    [45_000, 'PT45S'],
    [0, 'PT1S'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(toDuration(from, new Date(from.getTime() + ms))).toBe(expected);
  });
});

describe('MercadoPagoOrdersProvider (PAY-01, ADR 0007)', () => {
  it('creates a Checkout Pro order from the server amount, idempotent by attempt (PAY-02)', async () => {
    respond({ status: 201, body: order });

    const result = await sandbox().createCheckout(checkout);

    expect(result).toEqual({
      checkoutId: 'ORDTST01ABC',
      checkoutUrl: order.checkout_url,
    });
    const [request] = sent;
    expect(request.url).toMatch(
      /^https:\/\/api\.mercadopago\.com\/v1\/orders\/?$/,
    );
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(request.headers['X-Idempotency-Key']).toBe(
      checkout.externalReference,
    );
    expect(request.body).toMatchObject({
      type: 'online',
      processing_mode: 'manual',
      total_amount: '45000.50',
      currency: 'ARS',
      external_reference: checkout.externalReference,
      items: [{ title: checkout.title, unit_price: '45000.50', quantity: 1 }],
      payer: {
        email: 'ana@feriante.test',
        first_name: 'Ana',
        last_name: 'Pérez',
      },
      config: {
        online: {
          success_url: checkout.backUrls.success,
          pending_url: checkout.backUrls.pending,
          failure_url: checkout.backUrls.failure,
          auto_return: 'approved',
          retries: { allowed: true },
        },
      },
    });
    expect(request.body).not.toHaveProperty('marketplace_fee');
  });

  it('expires the order with the hold, as an ISO 8601 duration', async () => {
    respond({ status: 201, body: order });
    await sandbox().createCheckout({
      ...checkout,
      expiresAt: new Date(Date.now() + 870_000),
    });
    const { expiration_time: expiration } = sent[0].body as {
      expiration_time: string;
    };
    expect(expiration).toMatch(/^PT14M(29|30)S$/);
  });

  it('sends only the payer fields it has', async () => {
    respond({ status: 201, body: order });
    await sandbox().createCheckout({
      ...checkout,
      payer: { email: 'solo@feriante.test' },
    });
    expect((sent[0].body as { payer: unknown }).payer).toEqual({
      email: 'solo@feriante.test',
    });
  });

  it('retries a failed creation: the idempotency key makes it safe', async () => {
    respond({ status: 503 }, { status: 201, body: order });
    const result = await sandbox().createCheckout(checkout);
    expect(result.checkoutId).toBe('ORDTST01ABC');
    expect(sent).toHaveLength(2);
    expect(sent[1].headers['X-Idempotency-Key']).toBe(
      sent[0].headers['X-Idempotency-Key'],
    );
  });

  it('fails when the order has no checkout_url', async () => {
    respond({ status: 201, body: { id: 'ORDTST01ABC' } });
    await expect(sandbox().createCheckout(checkout)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('refuses the platform token in production until PAY-07 links the organizer account', async () => {
    respond();
    const provider = new MercadoPagoOrdersProvider({
      environment: 'production',
      accessToken: TOKEN,
    });
    await expect(provider.createCheckout(checkout)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(sent).toHaveLength(0);
  });

  it("uses the organizer's linked seller token, in production too (PAY-07)", async () => {
    respond({ status: 200, body: { id: 'ORD1', status: 'processed' } });
    const tenants: string[] = [];
    const provider = new MercadoPagoOrdersProvider(
      { environment: 'production', accessToken: undefined },
      (tenantId) => {
        tenants.push(tenantId);
        return Promise.resolve('APP_USR-seller-token');
      },
    );
    await provider.getPayments(TENANT, 'ORD1');
    expect(tenants).toEqual([TENANT]);
    expect(sent[0].headers.Authorization).toBe('Bearer APP_USR-seller-token');
  });

  it('prefers the linked seller token over the sandbox platform token', async () => {
    respond({ status: 200, body: { id: 'ORD1', status: 'processed' } });
    const provider = new MercadoPagoOrdersProvider(
      { environment: 'sandbox', accessToken: TOKEN },
      () => Promise.resolve('APP_USR-seller-token'),
    );
    await provider.getPayments(TENANT, 'ORD1');
    expect(sent[0].headers.Authorization).toBe('Bearer APP_USR-seller-token');
  });

  it('fails explicitly without credentials and never calls the provider (§13.1)', async () => {
    respond();
    const provider = new MercadoPagoOrdersProvider({
      environment: 'sandbox',
      accessToken: undefined,
    });
    await expect(provider.createCheckout(checkout)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(sent).toHaveLength(0);
  });

  it('hides the provider error body behind a 502', async () => {
    respond({
      status: 400,
      body: { message: `invalid token ${TOKEN}`, cause: [{ code: 'x' }] },
    });
    const error: unknown = await sandbox()
      .createCheckout(checkout)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(
      JSON.stringify((error as BadGatewayException).getResponse()),
    ).not.toContain(TOKEN);
  });

  it('reads the payments of an order server-to-server, in cents and one vocabulary (PAY-03)', async () => {
    respond({
      status: 200,
      body: {
        id: 'ORDTST01ABC',
        status: 'processed',
        status_detail: 'accredited',
        external_reference: checkout.externalReference,
        currency: 'ARS',
        user_id: 777,
        created_date: '2026-11-01T10:00:00.000Z',
        transactions: {
          payments: [
            {
              id: 'PAY01',
              status: 'failed',
              status_detail: 'rejected_by_issuer',
              amount: '45000.50',
            },
            {
              id: 'PAY02',
              status: 'processed',
              status_detail: 'accredited',
              amount: '45000.50',
            },
          ],
        },
      },
    });

    expect(await sandbox().getPayments(TENANT, 'ORDTST01ABC')).toEqual([
      {
        id: 'PAY01',
        status: 'rejected',
        statusDetail: 'rejected_by_issuer',
        externalReference: checkout.externalReference,
        amountCents: 4_500_050,
        currency: 'ARS',
        collectorId: '777',
        approvedAt: null,
      },
      {
        id: 'PAY02',
        status: 'approved',
        statusDetail: 'accredited',
        externalReference: checkout.externalReference,
        amountCents: 4_500_050,
        currency: 'ARS',
        collectorId: '777',
        approvedAt: new Date('2026-11-01T10:00:00.000Z'),
      },
    ]);
    expect(sent[0]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/orders/ORDTST01ABC',
      method: 'GET',
    });
  });

  it.each([
    ['created', 'pending'],
    ['action_required', 'pending'],
    ['processing', 'in_process'],
    ['canceled', 'cancelled'],
    ['expired', 'cancelled'],
    ['refunded', 'refunded'],
    ['something_new', 'pending'],
  ])(
    'maps the order payment status %s to %s, never to approved',
    (raw, expected) => {
      const [payment] = toPayments({
        external_reference: 'x',
        transactions: { payments: [{ id: 'P', status: raw, amount: '1.00' }] },
      });
      expect(payment.status).toBe(expected);
    },
  );

  it('has no payment while the order is unpaid', async () => {
    respond({ status: 200, body: { id: 'ORD1', status: 'created' } });
    expect(await sandbox().getPayments(TENANT, 'ORD1')).toEqual([]);
  });

  it('refunds the whole order with our own stable idempotency key (ADR 0006 §4, R-MP-5)', async () => {
    respond({
      status: 201,
      body: {
        id: 'ORD1',
        status: 'refunded',
        transactions: { refunds: [{ id: 'REF1', status: 'approved' }] },
      },
    });

    const refund = await sandbox().refund(
      TENANT,
      'ORD1',
      'PAY1',
      'key-refund-1',
    );

    expect(refund).toEqual({ id: 'REF1', status: 'approved' });
    expect(sent[0].url).toBe(
      'https://api.mercadopago.com/v1/orders/ORD1/refund',
    );
    expect(sent[0].method).toBe('POST');
    expect(sent[0].headers['X-Idempotency-Key']).toBe('key-refund-1');
    expect(sent[0].body ?? {}).toEqual({});
  });

  it('refunds part of a payment naming its transaction and amount', async () => {
    respond({
      status: 201,
      body: { id: 'ORD1', transactions: { refunds: [{ id: 'REF2' }] } },
    });
    await sandbox().refund(TENANT, 'ORD1', 'PAY1', 'key-refund-2', 1_000_00);
    expect(sent[0].body).toEqual({
      transactions: [{ id: 'PAY1', amount: '1000.00' }],
    });
  });

  it('cancels an unpaid order with our idempotency key (PAY-06)', async () => {
    respond({ status: 200, body: { id: 'ORD1', status: 'canceled' } });

    expect(await sandbox().cancel(TENANT, 'ORD1', 'key-cancel-1')).toEqual({
      status: 'cancelled',
    });
    expect(sent[0]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/orders/ORD1/cancel',
      method: 'POST',
    });
    expect(sent[0].headers['X-Idempotency-Key']).toBe('key-cancel-1');
  });

  it('treats an already canceled order (409) as cancelled, after reading it', async () => {
    respond(
      { status: 409, body: { errors: [{ code: 'order_already_canceled' }] } },
      { status: 200, body: { id: 'ORD1', status: 'canceled' } },
    );
    expect(await sandbox().cancel(TENANT, 'ORD1', 'k')).toEqual({
      status: 'cancelled',
    });
  });

  it('does not hide a 409 on an order that is not canceled', async () => {
    respond(
      { status: 409, body: { errors: [{ code: 'cannot_cancel_order' }] } },
      { status: 200, body: { id: 'ORD1', status: 'processed' } },
    );
    await expect(sandbox().cancel(TENANT, 'ORD1', 'k')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});

describe('MercadoPagoOrdersProvider auto_return', () => {
  it('sends auto_return approved only with https back_urls', async () => {
    respond({ status: 201, body: order });
    await sandbox().createCheckout(checkout);
    expect(sent[0].body).toMatchObject({
      config: { online: { auto_return: 'approved' } },
    });
  });

  it('omits auto_return for http://localhost back_urls', async () => {
    respond({ status: 201, body: order });
    await sandbox().createCheckout({
      ...checkout,
      backUrls: {
        success: 'http://localhost:4200/checkout/success',
        pending: 'http://localhost:4200/checkout/pending',
        failure: 'http://localhost:4200/checkout/failure',
      },
    });
    const online = (sent[0].body as { config: { online: object } }).config
      .online;
    expect(online).not.toHaveProperty('auto_return');
    expect(online).toMatchObject({
      success_url: 'http://localhost:4200/checkout/success',
    });
  });
});

describe('MercadoPagoOrdersProvider subscriptions (EXH-05)', () => {
  const USER = '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b';
  const KEY = '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';
  const request = {
    externalReference: USER,
    reason: 'Suscripción Juntta Feria',
    payerEmail: 'comprador@test.com',
    amountCents: 1_500_000,
    currency: 'ARS',
    backUrl: 'https://web.example.test/feriante/suscripcion',
    idempotencyKey: KEY,
  };

  it('creates a pending preapproval with the platform token and no plan', async () => {
    respond({
      status: 201,
      body: {
        id: 'pre-1',
        status: 'pending',
        external_reference: USER,
        init_point: 'https://mp.test/subscribe/pre-1',
        payer_email: 'comprador@test.com',
      },
    });

    const created = await sandbox().createSubscription(request);

    expect(created).toEqual({
      id: 'pre-1',
      status: 'pending',
      externalReference: USER,
      initPoint: 'https://mp.test/subscribe/pre-1',
      nextPaymentDate: null,
      payerEmail: 'comprador@test.com',
    });
    const [sentRequest] = sent;
    expect(sentRequest.url).toMatch(
      /^https:\/\/api\.mercadopago\.com\/preapproval\/?$/,
    );
    expect(sentRequest.method).toBe('POST');
    expect(sentRequest.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(sentRequest.headers['X-Idempotency-Key']).toBe(KEY);
    expect(sentRequest.body).toEqual({
      reason: request.reason,
      external_reference: USER,
      payer_email: 'comprador@test.com',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 15_000,
        currency_id: 'ARS',
      },
      back_url: request.backUrl,
      status: 'pending',
    });
  });

  it('uses the platform token in production too, and answers 503 without one', async () => {
    respond({
      status: 201,
      body: { id: 'pre-2', init_point: 'https://mp.test/x' },
    });
    const production = new MercadoPagoOrdersProvider({
      environment: 'production',
      accessToken: TOKEN,
    });
    await production.createSubscription(request);
    expect(sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);

    respond();
    const bare = new MercadoPagoOrdersProvider({
      environment: 'production',
      accessToken: undefined,
    });
    await expect(bare.createSubscription(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(bare.getSubscription('pre-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(bare.getAuthorizedPayment('ap-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(sent).toHaveLength(0);
  });

  it('maps a preapproval read: status, reference and next payment date', async () => {
    respond({
      status: 200,
      body: {
        id: 'pre-1',
        status: 'authorized',
        external_reference: USER,
        next_payment_date: '2026-12-10T12:00:00.000-03:00',
      },
    });

    const read = await sandbox().getSubscription('pre-1');

    expect(read).toMatchObject({
      id: 'pre-1',
      status: 'authorized',
      externalReference: USER,
      initPoint: null,
    });
    expect(read.nextPaymentDate?.toISOString()).toBe(
      '2026-12-10T15:00:00.000Z',
    );
    expect(new URL(sent[0].url).pathname).toBe('/preapproval/pre-1');
    expect(sent[0].method).toBe('GET');
  });

  it('cancels with PUT status cancelled', async () => {
    respond({ status: 200, body: { id: 'pre-1', status: 'cancelled' } });

    const result = await sandbox().cancelSubscription('pre-1');

    expect(result).toEqual({ status: 'cancelled' });
    expect(sent[0].method).toBe('PUT');
    expect(new URL(sent[0].url).pathname).toBe('/preapproval/pre-1');
    expect(sent[0].body).toEqual({ status: 'cancelled' });
  });

  it('reads an authorized payment and its preapproval', async () => {
    respond({
      status: 200,
      body: { id: 99, preapproval_id: 'pre-1', status: 'processed' },
    });

    const payment = await sandbox().getAuthorizedPayment('99');

    expect(payment).toEqual({
      id: '99',
      preapprovalId: 'pre-1',
      status: 'processed',
    });
    expect(sent[0].url).toBe(
      'https://api.mercadopago.com/authorized_payments/99',
    );
    expect(sent[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('maps provider failures to a 502 without its body', async () => {
    respond(
      { status: 400, body: { message: 'payer_email mismatch', secret: 'x' } },
      { status: 500, body: {} },
    );

    const failure = await sandbox()
      .createSubscription(request)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BadGatewayException);
    expect(
      JSON.stringify((failure as BadGatewayException).getResponse()),
    ).not.toContain('payer_email mismatch');
    await expect(sandbox().getAuthorizedPayment('99')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
