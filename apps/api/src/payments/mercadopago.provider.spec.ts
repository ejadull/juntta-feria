import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MercadoPagoProvider } from './mercadopago.provider.js';
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
  expiresAt: new Date('2026-11-07T15:15:00.000Z'),
  backUrls: {
    success: 'https://web.example.test/checkout/success',
    pending: 'https://web.example.test/checkout/pending',
    failure: 'https://web.example.test/checkout/failure',
  },
  notificationUrl: 'https://api.example.test/api/v1/webhooks/mercadopago',
};

const sandbox = () =>
  new MercadoPagoProvider({ environment: 'sandbox', accessToken: TOKEN });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MercadoPagoProvider (PAY-01)', () => {
  it('creates a Checkout Pro preference from the server amount (PAY-02, ADR 0006)', async () => {
    respond({
      status: 201,
      body: {
        id: 'pref-1',
        init_point: 'https://mp.test/live',
        sandbox_init_point: 'https://mp.test/sandbox',
      },
    });

    const result = await sandbox().createCheckout(checkout);

    expect(result).toEqual({
      preferenceId: 'pref-1',
      checkoutUrl: 'https://mp.test/sandbox',
    });
    const [request] = sent;
    expect(request.url).toMatch(
      /^https:\/\/api\.mercadopago\.com\/checkout\/preferences\/?$/,
    );
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(request.body).toMatchObject({
      items: [
        {
          title: checkout.title,
          quantity: 1,
          unit_price: 45_000.5,
          currency_id: 'ARS',
        },
      ],
      external_reference: checkout.externalReference,
      notification_url: checkout.notificationUrl,
      back_urls: checkout.backUrls,
      auto_return: 'approved',
      binary_mode: false,
      expires: true,
      expiration_date_to: '2026-11-07T15:15:00.000+00:00',
    });
  });

  it('never retries a preference creation: Preferences has no idempotency key (ADR 0006 §4)', async () => {
    respond(
      { status: 503 },
      { status: 201, body: { id: 'pref-2', sandbox_init_point: 'x' } },
    );
    await expect(sandbox().createCheckout(checkout)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(sent).toHaveLength(1);
  });

  it('refuses the platform token in production until PAY-07 links the organizer account', async () => {
    respond();
    const provider = new MercadoPagoProvider({
      environment: 'production',
      accessToken: TOKEN,
    });
    await expect(provider.createCheckout(checkout)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(sent).toHaveLength(0);
  });

  it("uses the organizer's linked seller token, in production too (PAY-07)", async () => {
    respond({ status: 200, body: { id: 1, status: 'approved' } });
    const tenants: string[] = [];
    const provider = new MercadoPagoProvider(
      { environment: 'production', accessToken: undefined },
      (tenantId) => {
        tenants.push(tenantId);
        return Promise.resolve('APP_USR-seller-token');
      },
    );
    await provider.getPayment(TENANT, '1');
    expect(tenants).toEqual([TENANT]);
    expect(sent[0].headers.Authorization).toBe('Bearer APP_USR-seller-token');
  });

  it('prefers the linked seller token over the sandbox platform token', async () => {
    respond({ status: 200, body: { id: 1, status: 'approved' } });
    const provider = new MercadoPagoProvider(
      { environment: 'sandbox', accessToken: TOKEN },
      () => Promise.resolve('APP_USR-seller-token'),
    );
    await provider.getPayment(TENANT, '1');
    expect(sent[0].headers.Authorization).toBe('Bearer APP_USR-seller-token');
  });

  it('fails explicitly without credentials and never calls the provider (§13.1)', async () => {
    respond();
    const provider = new MercadoPagoProvider({
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

  it('reads a payment server-to-server in cents (PAY-03)', async () => {
    respond({
      status: 200,
      body: {
        id: 123,
        status: 'approved',
        status_detail: 'accredited',
        external_reference: checkout.externalReference,
        transaction_amount: 45_000.5,
        currency_id: 'ARS',
        collector_id: 777,
        date_approved: '2026-11-01T10:00:00.000-03:00',
      },
    });

    expect(await sandbox().getPayment(TENANT, '123')).toEqual({
      id: '123',
      status: 'approved',
      statusDetail: 'accredited',
      externalReference: checkout.externalReference,
      amountCents: 4_500_050,
      currency: 'ARS',
      collectorId: '777',
      approvedAt: new Date('2026-11-01T13:00:00.000Z'),
    });
    expect(sent[0]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/payments/123',
      method: 'GET',
    });
  });

  it('refunds with our own stable idempotency key (ADR 0006 §4, R-MP-5)', async () => {
    respond({ status: 201, body: { id: 55, status: 'approved' } });

    const refund = await sandbox().refund(
      TENANT,
      '123',
      'key-refund-1',
      1_000_00,
    );

    expect(refund).toEqual({ id: '55', status: 'approved' });
    expect(sent[0].url).toBe(
      'https://api.mercadopago.com/v1/payments/123/refunds',
    );
    expect(sent[0].headers['X-Idempotency-Key']).toBe('key-refund-1');
    expect(sent[0].body).toEqual({ amount: 1000 });
  });

  it('refunds the whole payment when no amount is given', async () => {
    respond({ status: 201, body: { id: 56, status: 'approved' } });
    await sandbox().refund(TENANT, '123', 'key-refund-2');
    expect(sent[0].body ?? {}).toEqual({});
  });

  it('cancels a pending payment with our idempotency key (PAY-06)', async () => {
    respond({ status: 200, body: { id: 123, status: 'cancelled' } });

    expect(await sandbox().cancel(TENANT, '123', 'key-cancel-1')).toEqual({
      status: 'cancelled',
    });
    expect(sent[0]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/payments/123',
      method: 'PUT',
      body: { status: 'cancelled' },
    });
    expect(sent[0].headers['X-Idempotency-Key']).toBe('key-cancel-1');
  });

  it('finds the payments of an attempt by external_reference (PAY-05)', async () => {
    respond({
      status: 200,
      body: {
        results: [
          {
            id: 7,
            status: 'rejected',
            external_reference: checkout.externalReference,
            transaction_amount: 45_000.5,
            currency_id: 'ARS',
            collector_id: '777',
          },
        ],
      },
    });

    const found = await sandbox().findPayments(
      TENANT,
      checkout.externalReference,
    );

    expect(found).toEqual([
      {
        id: '7',
        status: 'rejected',
        statusDetail: null,
        externalReference: checkout.externalReference,
        amountCents: 4_500_050,
        currency: 'ARS',
        collectorId: '777',
        approvedAt: null,
      },
    ]);
    const url = new URL(sent[0].url);
    expect(url.pathname).toBe('/v1/payments/search');
    expect(url.searchParams.get('external_reference')).toBe(
      checkout.externalReference,
    );
  });
});

describe('MercadoPagoProvider auto_return', () => {
  const preference = { id: 'pref-1', sandbox_init_point: 'https://mp.test/s' };

  it('sends auto_return approved only with https back_urls', async () => {
    respond({ status: 201, body: preference });
    await sandbox().createCheckout(checkout);
    expect(sent[0].body).toMatchObject({ auto_return: 'approved' });
  });

  it('omits auto_return for http://localhost back_urls (invalid_auto_return)', async () => {
    respond({ status: 201, body: preference });
    await sandbox().createCheckout({
      ...checkout,
      backUrls: {
        success: 'http://localhost:4200/checkout/success',
        pending: 'http://localhost:4200/checkout/pending',
        failure: 'http://localhost:4200/checkout/failure',
      },
    });
    expect(sent[0].body).not.toHaveProperty('auto_return');
    expect(sent[0].body).toMatchObject({
      back_urls: { success: 'http://localhost:4200/checkout/success' },
    });
  });
});

describe('MercadoPagoProvider subscriptions (EXH-05)', () => {
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
    const production = new MercadoPagoProvider({
      environment: 'production',
      accessToken: TOKEN,
    });
    await production.createSubscription(request);
    expect(sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);

    respond();
    const bare = new MercadoPagoProvider({
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
