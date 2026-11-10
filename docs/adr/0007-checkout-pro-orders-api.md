# ADR 0007: Checkout Pro vía Orders API

- Estado: aceptada (2026-11-10). Enmienda el ADR 0006 en lo que toca a Preferences; el resto (OAuth del vendedor, `preapproval` de la plataforma, firma de webhooks) sigue vigente.

## Contexto

El ADR 0006 creaba el pago de un stand con `POST /checkout/preferences`. Esa API no documenta `X-Idempotency-Key`, así que un timeout al crear dejaba una preferencia huérfana y no se podía reintentar la llamada. Mercado Pago ofrece Checkout Pro también vía Orders API (`POST /v1/orders`), con idempotencia, vigencia de la order y reembolsos/cancelaciones por order.

## Decisión

- `PaymentProvider.createCheckout` crea una order `type: online`, `processing_mode: manual`, un ítem, montos como string, `external_reference` = id del `payment_attempt`, `payer` = el feriante logueado (email y, si hay, nombre), `expiration_time` = ISO 8601 hasta el vencimiento del hold (`PT14M30S`), `config.online.{success,pending,failure}_url` y `retries.allowed: true` (P19 reintenta sobre la misma order). `auto_return` solo con `success_url` https (se mantiene la guarda de Preferences hasta verificarlo en sandbox).
- La idempotencia es de Mercado Pago: `X-Idempotency-Key` = id del intento. El provider reintenta la creación sin riesgo de duplicar.
- La columna `payment_attempts.preference_id` pasa a `provider_checkout_id` (migración `0016`, renombre sin pérdida) y guarda el `order id`. `CheckoutView.preferenceId` conserva su nombre por compatibilidad y contiene ese `order id`; `wallet` es siempre `null` (el checkout es una redirección a `checkout_url`, no hay Wallet Brick).
- Puerto: `getPayment`/`findPayments` se reemplazan por `getPayments(tenantId, checkoutId)` (`GET /v1/orders/{id}` → `transactions.payments[]`); como siempre conocemos el `order id`, ya no hace falta buscar por `external_reference`. `refund` y `cancel` reciben el `checkoutId` (`POST /v1/orders/{id}/refund` total sin body o parcial con `transactions:[{id, amount}]`; `POST /v1/orders/{id}/cancel`, solo en `created`/`action_required`). El estado de cada pago se normaliza al vocabulario de siempre (`approved|pending|in_process|rejected|cancelled|refunded|charged_back`); un estado desconocido nunca es `approved`.
- Webhooks: topic `order`/`orders` ("Order (Mercado Pago)"), misma firma `x-signature`, mismo inbox/dedupe/reintento. La URL se fija en el panel y no admite `?tenant=`: el tenant se obtiene de nuestro `order id` con la función `payment_attempt_tenant` (`SECURITY DEFINER`, migración `0016`; mismo patrón que `exhibitor_invitation_lookup`). Un `order id` desconocido se ignora (`UNKNOWN_ORDER`). La firma se valida con el `data.id` recibido y, si falla, en minúsculas (convención de Mercado Pago para ids alfanuméricos). El topic `payment` deja de procesarse; las suscripciones no cambian.

## Enmienda 2026-11-10: Orders queda opcional

Orders queda opcional; por defecto Preferences porque Orders devuelve 403 (`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`) con las credenciales de prueba. Ambos adaptadores conviven detrás del puerto `PaymentProvider` (`MercadoPagoPreferencesProvider` y `MercadoPagoOrdersProvider`) y se elige con `MP_CHECKOUT_API=preferences|orders` (por defecto `preferences`). En modo `preferences`, `checkoutId` es el id de la preferencia, `getPayments` lee la preferencia y busca los pagos por su `external_reference`, `refund`/`cancel` actúan sobre sus pagos, `CheckoutView.wallet` vuelve a traer `MP_PUBLIC_KEY` para el Wallet Brick y el webhook procesa el topic `payment` con `?tenant=`. En modo `orders` todo sigue como se describe arriba. La firma es la misma en ambos.

## Consecuencias

- Se puede reintentar la creación y reintentar el pago rechazado sobre la misma order.
- La Public Key y `MP_NOTIFICATION_URL` ya no intervienen en el checkout.
- Un pago tardío tras la expiración de la order ya no es posible por el lado de Mercado Pago; `LATE_PAYMENT_CONFLICT` queda como defensa.
- Marketplace (`marketplace_fee`) queda fuera del MVP.
- Pendiente de verificar contra el sandbox real: nombres exactos de `status` por pago, `auto_return` con URLs no https, tope de `expiration_time`, y si el webhook firma `data.id` en minúsculas. La cuenta de prueba usada en desarrollo respondía `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` en `/v1/orders` (la aplicación no tenía Orders habilitada), por lo que esos puntos se cubrieron solo con pruebas contra un doble HTTP.
