#!/usr/bin/env node
// DEV ONLY. Drives a real Mercado Pago sandbox checkout through the public HTTP API.
// Run inside the api container (after bootstrap-sandbox.mjs):
//   docker compose exec api node apps/api/scripts/sandbox-checkout.mjs <setup|notify [payment_id|order_id]|status|
//     subscribe [payerEmail]|notify-subscription <preapproval_id>>
// State lives in .sandbox-state.json next to this file (gitignored). Never prints secrets.
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '.sandbox-state.json',
);
const API_URL = (
  process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/api/v1`
).replace(/\/$/, '');
const DAY_MS = 86_400_000;
const PRICE_CENTS = 100_000; // ARS 1.000,00
const TERMS_VERSION = '2026-10-01';
const STAND_CODES = ['S1', 'S2', 'S3'];

function die(message) {
  console.error(message);
  process.exit(1);
}

// ---- state ----
function loadState() {
  if (!existsSync(STATE_FILE))
    die(
      'No hay estado. Primero corre bootstrap-sandbox.mjs (ver README del script).',
    );
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}
const saveState = (state) =>
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ---- http ----
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Returns the parsed body; on non-2xx prints method, path, status and the problem+json, exits 1. */
async function http(method, pathname, opts = {}) {
  const { token, tenantId, body, headers = {} } = opts;
  const response = await fetch(`${API_URL}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (response.ok) return text ? safeJson(text) : null;
  return die(`${method} ${pathname} -> ${response.status}\n${text}`);
}

const LOGIN_ATTEMPTS = 3;

/**
 * Retries a 503: the API's lazy Redis rate-limit store fails the first login after a cold
 * start (concurrent connect), see the gaps reported with this script.
 */
async function login({ email, password }) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const text = await response.text();
    if (response.ok) return safeJson(text).accessToken;
    if (response.status === 503 && attempt < LOGIN_ATTEMPTS) continue;
    die(`POST /auth/login -> ${response.status}\n${text}`);
  }
}

// ---- setup ----
const rect = (x) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 0],
      [x + 3, 0],
      [x + 3, 3],
      [x, 3],
      [x, 0],
    ],
  ],
});

async function createPublishedLayout(auth, venueId) {
  const template = await http('POST', '/layout-templates', {
    ...auth,
    body: { name: 'Plano sandbox', venueId },
  });
  const versionId = template.id;
  await http('PUT', `/layout-versions/${versionId}/objects`, {
    ...auth,
    body: {
      objects: STAND_CODES.map((code, i) => ({
        id: randomUUID(),
        kind: 'STAND',
        code,
        geometry: rect(i * 3),
        metadata: {},
      })),
    },
  });
  await http('POST', `/layout-versions/${versionId}/publish`, auth);
  return versionId;
}

async function createPublishedEvent(auth, state, layoutVersionId) {
  const now = Date.now();
  const event = await http('POST', '/events', {
    ...auth,
    body: {
      venueId: state.venueId,
      layoutVersionId,
      name: 'Feria sandbox',
      slug: `feria-${state.slug}`,
      salesOpenAt: new Date(now - DAY_MS).toISOString(),
      salesCloseAt: new Date(now + 5 * DAY_MS).toISOString(),
      startsAt: new Date(now + 6 * DAY_MS).toISOString(),
      endsAt: new Date(now + 7 * DAY_MS).toISOString(),
    },
  });
  const stands = await http('GET', `/events/${event.id}/stands`, auth);
  await http('PATCH', `/events/${event.id}/stands`, {
    ...auth,
    body: { standIds: stands.map((s) => s.id), priceCents: PRICE_CENTS },
  });
  await http('POST', `/events/${event.id}/publish`, auth);
  return { eventId: event.id, stands };
}

/** Opens (or replays) the checkout of an existing hold; safe to rerun after a provider failure. */
async function openCheckout(state) {
  const auth = {
    token: await login(state.exhibitor),
    tenantId: state.tenantId,
  };
  const reservation = await http(
    'GET',
    `/reservations/${state.reservationId}`,
    auth,
  );
  const checkout = await http(
    'POST',
    `/reservations/${state.reservationId}/checkout`,
    {
      ...auth,
      headers: { 'idempotency-key': randomUUID() },
    },
  );
  saveState({
    ...state,
    paymentAttemptId: checkout.paymentAttemptId,
    checkoutId: checkout.preferenceId, // preference id (preferences) or order id (orders)
    checkoutUrl: checkout.checkoutUrl,
  });
  printSetup(reservation, checkout, state.standCode, state.eventId);
}

async function setup() {
  const state = loadState();
  // Rerun after a failed checkout (e.g. bad MP token): reuse the hold instead of rebuilding.
  if (state.reservationId) return openCheckout(state);
  const ownerAuth = {
    token: await login(state.owner),
    tenantId: state.tenantId,
  };
  const layoutVersionId = await createPublishedLayout(ownerAuth, state.venueId);
  const { eventId, stands } = await createPublishedEvent(
    ownerAuth,
    state,
    layoutVersionId,
  );
  const stand = stands[0];

  const exhibitorAuth = {
    token: await login(state.exhibitor),
    tenantId: state.tenantId,
  };
  const reservation = await http('POST', '/reservations', {
    ...exhibitorAuth,
    body: { eventStandId: stand.id, termsVersion: TERMS_VERSION },
    headers: { 'idempotency-key': randomUUID() },
  });
  // Persist before the checkout: a provider failure keeps the hold and setup can resume.
  const held = {
    ...state,
    eventId,
    standId: stand.id,
    standCode: stand.code,
    reservationId: reservation.id,
  };
  saveState(held);
  await openCheckout(held);
}

function printSetup(reservation, checkout, standCode, eventId) {
  console.log('\n=== Checkout listo ===');
  console.log(`Abri en el navegador (sandbox):\n  ${checkout.checkoutUrl}\n`);
  console.log(`Evento:        ${eventId}`);
  console.log(`Stand:         ${standCode}`);
  console.log(`Reserva:       ${reservation.id}`);
  console.log(`Intento pago:  ${checkout.paymentAttemptId}`);
  console.log(`Hold vence:    ${reservation.holdExpiresAt}`);
  console.log(`\nProximos pasos:
  1. Paga con un usuario COMPRADOR de prueba de Mercado Pago (no el vendedor).
  2. Tarjeta de prueba: Mastercard 5031 7557 3453 0604, CVV 123, vto 11/30,
     titular "APRO" (aprobado).
  3. Al volver, copia payment_id de la URL de retorno (modo preferences) o vuelve a la web (modo orders).
  4. docker compose exec api node apps/api/scripts/sandbox-checkout.mjs notify <payment_id>   (preferences)
     docker compose exec api node apps/api/scripts/sandbox-checkout.mjs notify               (orders: usa la order de setup)
  5. docker compose exec api node apps/api/scripts/sandbox-checkout.mjs status`);
}

// ---- notify ----
function signedHeaders(dataId, secret) {
  const requestId = randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` };
}

/** MP_CHECKOUT_API of the api container: `preferences` (default) or `orders`. */
const checkoutApi =
  process.env.MP_CHECKOUT_API === 'orders' ? 'orders' : 'preferences';

/**
 * Simulates the notification of the active Checkout Pro API.
 * preferences: topic `payment` naming the payment, with the `?tenant=` hint of the preference's notification_url.
 * orders: topic `order` naming the order, never the tenant.
 */
async function notify(idArg) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) die('MP_WEBHOOK_SECRET no esta definido en el contenedor.');
  const state = loadState();
  const orders = checkoutApi === 'orders';
  const id =
    idArg ?? (orders ? (state.checkoutId ?? state.orderId) : undefined);
  if (!id)
    die(
      orders
        ? 'Uso: notify [order_id] (sin argumento usa la order de setup)'
        : 'Uso: notify <payment_id> (modo preferences)',
    );
  const type = orders ? 'order' : 'payment';
  const query = new URLSearchParams({
    'data.id': id,
    type,
    ...(orders ? {} : { tenant: state.tenantId }),
  });
  // Mercado Pago signs the lowercased id for alphanumeric ids; the API accepts both.
  const headers = signedHeaders(id.toLowerCase(), secret);
  const result = await http('POST', `/webhooks/mercadopago?${query}`, {
    headers,
    body: {
      type,
      action: orders ? 'order.processed' : 'payment.updated',
      data: { id },
    },
  });
  console.log(
    `Webhook ${type} aceptado (request-id ${headers['x-request-id']}): ${JSON.stringify(result)}`,
  );
  console.log(
    'La API lo procesa en segundo plano; espera unos segundos y corre status.',
  );
}

// ---- platform subscription (EXH-05) ----
/** Starts the exhibitor's subscription to the platform and prints where to authorize it. */
async function subscribe(payerEmail) {
  const state = loadState();
  const auth = { token: await login(state.exhibitor) };
  const subscription = await http('POST', '/me/subscription', {
    ...auth,
    ...(payerEmail ? { body: { payerEmail } } : {}),
    headers: { 'idempotency-key': randomUUID() },
  });
  console.log('\n=== Suscripcion ===');
  console.log(`status: ${subscription.status}`);
  console.log(`Abri en el navegador:\n  ${subscription.initPoint}\n`);
  console.log(`Proximos pasos:
  1. Autoriza con el usuario COMPRADOR de prueba cuyo email es el payerEmail
     (Mercado Pago rechaza el cobro si la cuenta no coincide; el email de la cuenta Juntta
     casi nunca es el del comprador de prueba).
  2. Copia preapproval_id de la URL de retorno.
  3. docker compose exec api node apps/api/scripts/sandbox-checkout.mjs notify-subscription <preapproval_id>
  4. Despues corre setup para reservar.`);
}

async function notifySubscription(preapprovalId) {
  if (!preapprovalId) die('Uso: notify-subscription <preapproval_id>');
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) die('MP_WEBHOOK_SECRET no esta definido en el contenedor.');
  // Platform-level topic: no `tenant` parameter, like the URL configured in the MP panel.
  const query = new URLSearchParams({
    'data.id': preapprovalId,
    type: 'subscription_preapproval',
  });
  const headers = signedHeaders(preapprovalId, secret);
  const result = await http('POST', `/webhooks/mercadopago?${query}`, {
    headers,
    body: {
      type: 'subscription_preapproval',
      action: 'updated',
      data: { id: preapprovalId },
    },
  });
  console.log(
    `Webhook aceptado (request-id ${headers['x-request-id']}): ${JSON.stringify(result)}`,
  );
  console.log(
    'La API lo procesa en segundo plano; consulta GET /me/subscription o corre subscribe.',
  );
}

// ---- status ----
async function status() {
  const state = loadState();
  if (!state.reservationId) die('Corre setup antes de status.');
  const auth = { token: await login(state.owner), tenantId: state.tenantId };
  const reservation = await http(
    'GET',
    `/reservations/${state.reservationId}`,
    auth,
  );
  const stands = await http('GET', `/events/${state.eventId}/stands`, auth);
  const incidents = await http('GET', '/payment-incidents', auth);

  console.log('\n=== Reserva ===');
  console.log(
    `status: ${reservation.status}  holdExpiresAt: ${reservation.holdExpiresAt}`,
  );
  console.log(JSON.stringify(reservation, null, 2));
  const stand = stands.find((s) => s.id === state.standId);
  console.log(
    `\n=== Stand ${state.standCode} ===\n${JSON.stringify(stand, null, 2)}`,
  );
  console.log(`\n=== Incidentes de pago (${incidents.length}) ===`);
  console.log(JSON.stringify(incidents, null, 2));
  console.log(
    '\nNota: la API no expone un endpoint de intentos de pago; la reserva y el stand reflejan el resultado.',
  );
}

// ---- main ----
const [command, arg] = process.argv.slice(2);
const commands = {
  setup,
  notify: () => notify(arg),
  status,
  subscribe: () => subscribe(arg),
  'notify-subscription': () => notifySubscription(arg),
};
if (!commands[command])
  die(
    'Uso: sandbox-checkout.mjs <setup | notify [payment_id|order_id] | status | subscribe [payerEmail] | notify-subscription <preapproval_id>>',
  );
await commands[command]();
