import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { DEMO_LAYOUT } from '../../src/app/features/layout-editor/data/demo-layout';
import type { LayoutVersionDto } from '../../src/app/features/layout-editor/domain/layout.types';
import { validateLayout } from '../../src/app/features/layout-editor/domain/validation';

/**
 * Deterministic stand-in for the API (`/api/v1/**`) so the exhibitor flows run without Docker data
 * or Mercado Pago. State lives in the returned object; tests tweak it before or during the run.
 */

export const GOOGLE_CLIENT_ID = 'e2e-client.apps.googleusercontent.com';
export const EMAIL = 'feriante@example.test';
export const CHECKOUT_URL = 'https://www.mercadopago.test/checkout?pref=pref-1';
export const SUBSCRIBE_URL = 'https://www.mercadopago.test/subscriptions?id=sub-1';

export type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'EXHIBITOR';

const sessionFor = (role: Role) => ({
  accessToken: 'access-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'u1', email: EMAIL },
  memberships: [{ tenantId: 't1', tenantSlug: 'org', tenantName: 'Organización', role }],
});

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

export const EVENT = {
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
  templateId: 'tpl1',
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
export interface ApiEvent {
  id: string;
  slug: string;
  name: string;
  layoutVersionId: string;
  startsAt: string;
  endsAt: string;
  salesOpenAt: string;
  salesCloseAt: string;
  status: string;
}

/** `GET /events/:id/metrics` for the default event (EventMetricsDto plus the API extras). */
const METRICS = {
  eventId: 'e1',
  eventName: 'Feria Demo',
  venueName: 'Predio Demo',
  startsAt: '2026-11-20T13:00:00Z',
  endsAt: '2026-11-22T23:00:00Z',
  layoutVersionId: 'lv1',
  sellableStands: 3,
  blockedStands: 0,
  assignedStands: 1,
  approvedGmvCents: 1_740_000,
  currency: 'ARS',
  activeReservations: 1,
  reconciliationPending: 0,
  gmvByMonth: [{ month: '2026-10', cents: 1_740_000 }],
  pendingAmountCents: 0,
  latePaymentIncidents: 0,
};

export interface ApiExhibitor {
  id: string;
  tradeName: string;
  legalName: string;
  taxId: string | null;
  category: string;
  description: string;
  publicContactOptIn: boolean;
  documentsStatus: string;
}

const EXHIBITORS: ApiExhibitor[] = [
  {
    id: 'x1',
    tradeName: 'Lanas del Limay',
    legalName: 'Quiroga Florencia',
    taxId: '20-00000001-5',
    category: 'Textil de autor',
    description: 'Hilados y tejidos.',
    publicContactOptIn: true,
    documentsStatus: 'APPROVED',
  },
  {
    id: 'x2',
    tradeName: 'Jabonería Lafken',
    legalName: 'Lafken SRL',
    taxId: null,
    category: 'Cosmética natural',
    description: 'Jabones artesanales.',
    publicContactOptIn: false,
    documentsStatus: 'MISSING',
  },
];

export interface ApiInvitation {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export const INVITATION_URL = 'https://feria.test/invitacion/e2e-one-time-token';

const INVITATIONS: ApiInvitation[] = [
  {
    id: 'inv1',
    email: 'ana@example.test',
    phone: null,
    name: 'Ana',
    status: 'PENDING',
    expiresAt: '2026-11-20T12:00:00Z',
    acceptedAt: null,
    createdAt: '2026-11-10T12:00:00Z',
  },
  {
    id: 'inv2',
    email: null,
    phone: null,
    name: null,
    status: 'ACCEPTED',
    expiresAt: '2026-11-18T12:00:00Z',
    acceptedAt: '2026-11-11T12:00:00Z',
    createdAt: '2026-11-08T12:00:00Z',
  },
];

/** What `GET /events/:id/reservations/export` answers (BOM, CRLF), named by the API. */
export const CSV_FILENAME = 'reservas-feria-demo-2026-11-11.csv';
export const CSV_BODY = '\uFEFFStand,Expositor\r\nS1,Textiles Ana\r\n';

export interface PublicEvent {
  slug: string;
  name: string;
  organizerName: string;
  venueName: string;
  venueAddress: string | null;
  startsAt: string;
  endsAt: string;
  salesOpen: boolean;
  availableStands: number;
  totalStands: number;
}

const PUBLIC_EVENTS: PublicEvent[] = [
  {
    slug: 'feria-demo',
    name: 'Feria Demo',
    organizerName: 'Asociación Demo',
    venueName: 'Predio Demo',
    venueAddress: 'Av. Olascoaga 100, Neuquén',
    startsAt: '2026-11-20T13:00:00Z',
    endsAt: '2026-11-22T23:00:00Z',
    salesOpen: true,
    availableStands: 1,
    totalStands: 3,
  },
  {
    slug: 'feria-litoral',
    name: 'Feria del Litoral',
    organizerName: 'Litoral Artesanal',
    venueName: 'Galpón 13',
    venueAddress: null,
    startsAt: '2026-12-05T13:00:00Z',
    endsAt: '2026-12-07T23:00:00Z',
    salesOpen: false,
    availableStands: 0,
    totalStands: 0,
  },
];

export interface PublicExhibitor {
  name: string;
  category: string;
  description: string;
  standCode: string | null;
}

const PUBLIC_EXHIBITORS: PublicExhibitor[] = [
  {
    name: 'Lanas del Limay',
    category: 'Textil de autor',
    description: 'Hilados y tejidos.',
    standCode: 'S1',
  },
];

/** `GET /public/events/:slug/map`: S1 occupied by a public profile, S2 free, S3 blocked, one aisle. */
const publicMap = (slug: string) => {
  const standProps = (n: number, status: string, exhibitor: unknown = null) => ({
    kind: 'STAND',
    standId: `es${n}`,
    code: `S${n}`,
    areaM2: 9,
    status,
    sector: 'Diseño y moda',
    price: { currency: 'ARS', valueCents: 1_740_000 },
    exhibitor,
  });
  const feature = (x: number, properties: unknown) => ({
    type: 'Feature',
    geometry: polygon(x),
    properties,
  });
  return {
    slug,
    layoutVersion: 1,
    units: 'm',
    bounds: { width: 20, height: 8 },
    features: [
      feature(
        1,
        standProps(1, 'OCCUPIED', { name: 'Lanas del Limay', category: 'Textil de autor' }),
      ),
      feature(5, standProps(2, 'AVAILABLE')),
      feature(9, standProps(3, 'BLOCKED')),
      feature(13, { kind: 'AISLE', label: null }),
    ],
  };
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
  /** What staff also get from `GET /reservations` (organizer back office). */
  createdAt: string;
  exhibitor: { tradeName: string; email: string };
  payment: { status: string; paymentStatus: string | null; updatedAt: string } | null;
}

export interface PaymentIncident {
  id: string;
  code: string;
  reservationId: string | null;
  createdAt: string;
}

export interface SellerAccount {
  status: 'NOT_LINKED' | 'LINKED' | 'EXPIRED';
  environment: 'sandbox' | 'production';
  sellerId: string | null;
  liveMode: boolean | null;
  expiresAt: string | null;
  linkedAt: string | null;
}

export const UNLINKED_ACCOUNT: SellerAccount = {
  status: 'NOT_LINKED',
  environment: 'sandbox',
  sellerId: null,
  liveMode: null,
  expiresAt: null,
  linkedAt: null,
};

export interface Subscription {
  status: 'NONE' | 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  currentPeriodEnd?: string;
  initPoint?: string;
}

/** What the stubbed Google Identity Services hands back for each "account" (CORE-05). */
export const GOOGLE_CREDENTIALS = {
  registered: 'google-credential-registered',
  stranger: 'google-credential-stranger',
  wrongEmail: 'google-credential-wrong-email',
} as const;

/**
 * Stand-in for https://accounts.google.com/gsi/client: `renderButton` draws a plain button that,
 * when clicked, calls the registered callback with `window.__googleCredential`.
 */
export async function stubGoogle(page: Page, credential: string) {
  await page.addInitScript((value) => {
    (window as unknown as { __googleCredential: string }).__googleCredential = value;
  }, credential);
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        (() => {
          let callback;
          window.google = { accounts: { id: {
            initialize: (config) => { callback = config.callback; },
            renderButton: (container, options) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = options.text === 'continue_with' ? 'Continuar con Google' : 'Ingresar con Google';
              button.addEventListener('click', () => callback({ credential: window.__googleCredential }));
              container.append(button);
            },
          } } };
        })();`,
    }),
  );
}

export interface MockApi {
  /** Client id answered by `GET /auth/providers`; null hides "Ingresar con Google". */
  googleClientId: string | null;
  /** `GET /public/invitations/:token` answers this; null answers 404. */
  invitation: { organizationName: string; email: string | null; name: string | null } | null;
  signedIn: boolean;
  /** Role of the signed-in user in the organization; read on each page load (`/auth/refresh`). */
  role: Role;
  subscription: Subscription;
  /** Problem answered by `POST /reservations` instead of creating the hold. */
  holdProblem: { status: number; code?: string } | null;
  reservations: Reservation[];
  incidents: PaymentIncident[];
  /** Problem answered by `POST /reservations/:id/refunds` instead of refunding. */
  refundProblem: { status: number; code?: string } | null;
  /** The organization's Mercado Pago seller account (`/payment-account`). */
  account: SellerAccount;
  /** `GET /events` (staff and exhibitors); the dashboard and the plan entry take the current one. */
  events: ApiEvent[];
  /** Layout versions by id (`/layout-versions/:id`): the editor reads, saves, publishes and clones. */
  layouts: Record<string, LayoutVersionDto>;
  /** Organizer's exhibitors (`GET /exhibitors`). */
  exhibitors: ApiExhibitor[];
  /** Organizer's exhibitor invitations (`/exhibitor-invitations`). */
  invitations: ApiInvitation[];
  /** Anonymous portal (`/public/events...`). */
  publicEvents: PublicEvent[];
  publicExhibitors: PublicExhibitor[];
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
    createdAt: '2026-11-10T15:00:00Z',
    exhibitor: { tradeName: 'Textiles Ana', email: 'ana@example.test' },
    payment: null,
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
    googleClientId: null,
    invitation: null,
    signedIn: true,
    role: 'EXHIBITOR',
    subscription: { status: 'ACTIVE', currentPeriodEnd: future(60 * 24 * 20) },
    holdProblem: null,
    reservations: [],
    incidents: [],
    refundProblem: null,
    account: UNLINKED_ACCOUNT,
    events: [EVENT],
    layouts: {
      lv1: structuredClone(LAYOUT) as unknown as LayoutVersionDto,
      [DEMO_LAYOUT.id]: structuredClone(DEMO_LAYOUT),
    },
    exhibitors: structuredClone(EXHIBITORS),
    invitations: structuredClone(INVITATIONS),
    publicEvents: structuredClone(PUBLIC_EVENTS),
    publicExhibitors: structuredClone(PUBLIC_EXHIBITORS),
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
    if (path === '/auth/refresh')
      return api.signedIn ? json(route, sessionFor(api.role)) : problem(route, 401);
    if (path === '/auth/providers')
      return json(route, {
        google: api.googleClientId ? { clientId: api.googleClientId } : null,
      });
    if (path === '/auth/google') {
      const { credential } = JSON.parse(raw ?? '{}') as { credential?: string };
      if (credential === GOOGLE_CREDENTIALS.stranger)
        return problem(route, 403, 'GOOGLE_ACCOUNT_NOT_REGISTERED');
      if (credential !== GOOGLE_CREDENTIALS.registered)
        return problem(route, 401, 'GOOGLE_CREDENTIAL_INVALID');
      api.signedIn = true;
      return json(route, sessionFor(api.role));
    }
    if (/^\/public\/invitations\/[^/]+$/.test(path))
      return api.invitation ? json(route, api.invitation) : problem(route, 404);
    if (/^\/public\/invitations\/[^/]+\/accept$/.test(path)) {
      const body = JSON.parse(raw ?? '{}') as { googleCredential?: string };
      if (body.googleCredential === GOOGLE_CREDENTIALS.wrongEmail)
        return problem(route, 422, 'INVITATION_EMAIL_MISMATCH');
      return json(route, { user: { id: 'u1', email: EMAIL }, tenantId: 't1' }, 201);
    }
    // Anonymous portal: answered whether or not there is a session.
    if (path === '/public/events') return json(route, api.publicEvents);
    const publicEvent = /^\/public\/events\/([^/]+)\/(map|exhibitors)$/.exec(path);
    if (publicEvent) {
      if (!api.publicEvents.some((e) => e.slug === publicEvent[1])) return problem(route, 404);
      return json(
        route,
        publicEvent[2] === 'map' ? publicMap(publicEvent[1]) : api.publicExhibitors,
      );
    }
    if (path === '/auth/logout') {
      api.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (!api.signedIn) return problem(route, 401);

    if (path === '/events') return json(route, api.events);
    const metrics = /^\/events\/([^/]+)\/metrics$/.exec(path);
    if (metrics) {
      const event = api.events.find((e) => e.id === metrics[1]);
      if (!event) return problem(route, 404);
      return json(route, {
        ...METRICS,
        eventId: event.id,
        eventName: event.name,
        layoutVersionId: event.layoutVersionId,
      });
    }
    if (path === '/exhibitors') return json(route, api.exhibitors);

    if (path === '/exhibitor-invitations') {
      if (method === 'POST') {
        const body = JSON.parse(raw ?? '{}') as Partial<ApiInvitation>;
        const created: ApiInvitation = {
          id: `inv${api.invitations.length + 1}`,
          email: body.email ?? null,
          phone: body.phone ?? null,
          name: body.name ?? null,
          status: 'PENDING',
          expiresAt: future(60 * 24 * 7),
          acceptedAt: null,
          createdAt: new Date().toISOString(),
        };
        api.invitations = [created, ...api.invitations];
        return json(
          route,
          {
            ...created,
            url: INVITATION_URL,
            whatsappUrl: `https://wa.me/?text=${encodeURIComponent(INVITATION_URL)}`,
          },
          201,
        );
      }
      return json(route, api.invitations);
    }
    const invitation = /^\/exhibitor-invitations\/([^/]+)$/.exec(path);
    if (invitation && method === 'DELETE') {
      const found = api.invitations.find((i) => i.id === invitation[1]);
      if (!found) return problem(route, 404);
      if (found.status !== 'PENDING') return problem(route, 409);
      found.status = 'REVOKED';
      return route.fulfill({ status: 204 });
    }

    if (/^\/events\/[^/]+\/reservations\/export$/.test(path))
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': `attachment; filename="${CSV_FILENAME}"` },
        body: CSV_BODY,
      });

    const layoutVersion = /^\/layout-versions\/([^/]+)(\/objects|\/publish)?$/.exec(path);
    if (layoutVersion) {
      const layout = api.layouts[layoutVersion[1]];
      if (!layout) return problem(route, 404);
      if (!layoutVersion[2]) return json(route, layout);
      if (layout.status !== 'DRAFT') return problem(route, 409);
      if (layoutVersion[2] === '/objects') {
        const body = JSON.parse(raw ?? '{}') as { objects: LayoutVersionDto['objects'] };
        const saved = { ...layout, objects: body.objects };
        api.layouts[layout.id] = saved;
        return json(route, saved);
      }
      const issues = validateLayout(layout);
      if (issues.length > 0)
        return json(
          route,
          {
            title: 'Unprocessable',
            status: 422,
            detail: 'x',
            issues: issues.map(({ code, objectIds, message }) => ({ code, objectIds, message })),
          },
          422,
        );
      const published = { ...layout, status: 'PUBLISHED' as const };
      api.layouts[layout.id] = published;
      return json(route, published);
    }
    const cloneOf = /^\/layout-templates\/([^/]+)\/versions$/.exec(path);
    if (cloneOf && method === 'POST') {
      const { sourceVersionId } = JSON.parse(raw ?? '{}') as { sourceVersionId: string };
      const source = api.layouts[sourceVersionId];
      if (!source) return problem(route, 404);
      const siblings = Object.values(api.layouts).filter((v) => v.templateId === cloneOf[1]);
      const version = Math.max(...siblings.map((v) => v.version)) + 1;
      const draft: LayoutVersionDto = {
        ...source,
        id: `${cloneOf[1]}-v${version}`,
        version,
        status: 'DRAFT',
        objects: source.objects.map((o) => ({ ...o, id: `${o.id}-v${version}` })),
      };
      api.layouts[draft.id] = draft;
      return json(route, draft, 201);
    }
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
    if (path === '/reservations')
      return json(
        route,
        api.reservations.filter(
          (r) => !new URL(request.url()).searchParams.has('eventId') || r.eventId === 'e1',
        ),
      );

    if (path === '/payment-incidents') return json(route, api.incidents);

    if (path === '/payment-account') {
      if (method === 'DELETE') {
        api.account = UNLINKED_ACCOUNT;
        return route.fulfill({ status: 204 });
      }
      return json(route, api.account);
    }
    if (path === '/payment-account/authorization')
      // Same-origin, as if Mercado Pago sent the browser straight back after authorizing.
      return json(route, {
        authorizationUrl: '/organizador/mercado-pago/vincular?code=mp-code&state=mp-state',
      });
    if (path === '/payment-account/link') {
      const body = JSON.parse(raw ?? '{}') as { state?: string };
      if (body.state !== 'mp-state') return problem(route, 400, 'INVALID_OAUTH_STATE');
      api.account = {
        status: 'LINKED',
        environment: 'sandbox',
        sellerId: '123456789',
        liveMode: false,
        expiresAt: '2027-05-01T12:00:00Z',
        linkedAt: '2026-11-11T12:00:00Z',
      };
      return json(route, api.account);
    }

    const match = /^\/reservations\/([^/]+)(\/checkout|\/cancel|\/refunds)?$/.exec(path);
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
    if (match[2] === '/refunds') {
      if (api.refundProblem)
        return problem(route, api.refundProblem.status, api.refundProblem.code);
      const partial = !!(JSON.parse(raw ?? '{}') as { amountCents?: number }).amountCents;
      if (!partial && found.status === 'CONFIRMED') found.status = 'REFUNDED';
      if (!partial && found.status === 'PAYMENT_PENDING') found.status = 'CANCELLED';
      return json(route, { reservationStatus: found.status, refunds: [] }, 201);
    }
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
