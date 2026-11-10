import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';

/**
 * Deterministic stand-in for the API (`/api/v1/**`) so the exhibitor flows run without Docker data
 * or Mercado Pago. State lives in the returned object; tests tweak it before or during the run.
 */

export const PASSWORD = 'secreta-123';
export const EMAIL = 'feriante@example.test';
export const CHECKOUT_URL = 'https://www.mercadopago.test/checkout?pref=pref-1';
export const SUBSCRIBE_URL = 'https://www.mercadopago.test/subscriptions?id=sub-1';

const SESSION = {
  accessToken: 'access-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'u1', email: EMAIL },
  memberships: [
    { tenantId: 't1', tenantSlug: 'org', tenantName: 'Organización', role: 'EXHIBITOR' },
  ],
};

const square = (x: number): number[][][] => [
  [
    [x, 0],
    [x + 3, 0],
    [x + 3, 3],
    [x, 3],
    [x, 0],
  ],
];
const polygon = (x: number) => ({ type: 'Polygon', coordinates: square(x) });

const EVENT = {
  id: 'e1',
  slug: 'feria-demo',
  name: 'Feria Demo',
  layoutVersionId: 'lv1',
  startsAt: '2026-11-20T13:00:00Z',
  endsAt: '2026-11-22T23:00:00Z',
  salesOpenAt: '2026-01-01T00:00:00Z',
  salesCloseAt: '2099-01-01T00:00:00Z',
  status: 'PUBLISHED',
};
const LAYOUT = {
  id: 'lv1',
  version: 1,
  status: 'PUBLISHED',
  widthM: 20,
  heightM: 8,
  objects: [
    { id: 'o1', kind: 'STAND', code: 'S1', geometry: polygon(1), metadata: {} },
    { id: 'o2', kind: 'STAND', code: 'S2', geometry: polygon(5), metadata: {} },
    { id: 'o3', kind: 'STAND', code: 'S3', geometry: polygon(9), metadata: {} },
  ],
};
const stand = (n: number, status = 'AVAILABLE') => ({
  id: `es${n}`,
  layoutObjectId: `o${n}`,
  code: `S${n}`,
  sectorId: 'sec1',
  status,
  priceCents: 1_740_000,
  hasPrice: true,
  currency: 'ARS',
});

export interface Reservation {
  id: string;
  status: string;
  holdExpiresAt: string | null;
  amount: { currency: string; valueCents: number };
  stand: { id: string; code: string; areaM2: number };
  eventId: string;
}

export interface Subscription {
  status: 'NONE' | 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  currentPeriodEnd?: string;
  initPoint?: string;
}

export interface MockApi {
  signedIn: boolean;
  subscription: Subscription;
  /** Problem answered by `POST /reservations` instead of creating the hold. */
  holdProblem: { status: number; code?: string } | null;
  reservations: Reservation[];
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
}

export const future = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString();

export function reservation(patch: Partial<Reservation> = {}): Reservation {
  return {
    id: 'r1',
    status: 'HELD',
    holdExpiresAt: future(15),
    amount: { currency: 'ARS', valueCents: 1_740_000 },
    stand: { id: 'es2', code: 'S2', areaM2: 9 },
    eventId: 'e1',
    ...patch,
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(body),
  });
const problem = (route: Route, status: number, code?: string) =>
  json(route, { title: 'Error', status, detail: 'x', ...(code ? { code } : {}) }, status);

export async function mockApi(page: Page, initial: Partial<MockApi> = {}): Promise<MockApi> {
  const api: MockApi = {
    signedIn: true,
    subscription: { status: 'ACTIVE', currentPeriodEnd: future(60 * 24 * 20) },
    holdProblem: null,
    reservations: [],
    requests: [],
    ...initial,
  };

  await page.route(/\/api\/v1\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    const raw = request.postData();
    api.requests.push({
      method,
      path,
      headers: request.headers(),
      body: raw ? JSON.parse(raw) : null,
    });

    if (path === '/health/live') return json(route, { status: 'ok' });
    if (path === '/auth/refresh') return api.signedIn ? json(route, SESSION) : problem(route, 401);
    if (path === '/auth/login') {
      const body = JSON.parse(raw ?? '{}') as { password?: string };
      if (body.password !== PASSWORD) return problem(route, 401);
      api.signedIn = true;
      return json(route, SESSION);
    }
    if (path === '/auth/logout') {
      api.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (!api.signedIn) return problem(route, 401);

    if (path === '/events') return json(route, [EVENT]);
    if (path === '/layout-versions/lv1') return json(route, LAYOUT);
    if (path === '/events/e1/stands')
      return json(route, [stand(1, 'ASSIGNED'), stand(2), stand(3)]);
    if (path === '/events/e1/sectors') return json(route, [{ id: 'sec1', name: 'Diseño y moda' }]);

    if (path === '/me/subscription') {
      if (method === 'POST') {
        api.subscription = { status: 'PENDING', initPoint: SUBSCRIBE_URL };
        return json(route, api.subscription, 201);
      }
      if (method === 'DELETE') {
        api.subscription = { ...api.subscription, status: 'CANCELLED' };
        return json(route, api.subscription);
      }
      return json(route, api.subscription);
    }

    if (path === '/reservations' && method === 'POST') {
      if (api.holdProblem) return problem(route, api.holdProblem.status, api.holdProblem.code);
      const body = JSON.parse(raw!) as { eventStandId: string };
      const created = reservation({
        id: 'r-new',
        stand: { id: body.eventStandId, code: 'S2', areaM2: 9 },
      });
      api.reservations = [created, ...api.reservations];
      return json(route, created, 201);
    }
    if (path === '/reservations') return json(route, api.reservations);

    const match = /^\/reservations\/([^/]+)(\/checkout|\/cancel)?$/.exec(path);
    const found = match && api.reservations.find((r) => r.id === match[1]);
    if (!match || !found) return problem(route, 404);
    if (match[2] === '/checkout')
      return json(
        route,
        {
          paymentAttemptId: 'pa1',
          checkoutUrl: CHECKOUT_URL,
          preferenceId: 'pref-1',
          wallet: null,
          status: 'PENDING',
        },
        201,
      );
    if (match[2] === '/cancel') {
      found.status = 'CANCELLED';
      return json(route, found);
    }
    return json(route, found);
  });

  return api;
}

/** Same check as the other e2e suites: no serious or critical axe violations. */
export const seriousViolations = async (page: Page): Promise<string[]> =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
