# ADR 0006 — Integración con Mercado Pago Argentina

- **Estado:** aceptado
- **Fecha:** 2026-11-02
- **Tarea:** `PAY-00` (condiciona `PAY-01..07` y `SUB-01`)
- **Enmienda 2026-11-10:** el pago del stand ya no usa Preferences sino Orders API (`POST /v1/orders`); ver [ADR 0007](0007-checkout-pro-orders-api.md). Lo dicho aquí sobre Preferences, `notification_url` con `?tenant=`, el topic `payment` y el Wallet Brick queda reemplazado por el ADR 0007.
- **Resuelve:** las decisiones abiertas de §7 y R1 (§15) sobre track de integración, credenciales por organizador, firma de webhooks, idempotencia y pagos offline.

## Contexto

Cada organizador es un tenant y cobra en **su propia cuenta vendedora** (§7, R1). El pago es la pieza que más duele si se hace mal: dobles cobros, holds liberados con un pago en vuelo, webhooks falsificados. §6.5–6.8 ya fijan el comportamiento del hold; este ADR fija qué parte de la API de Mercado Pago lo sostiene. Se relevó la documentación oficial el 2026-11-02 (enlaces en "Fuentes"); lo que no quedó confirmado figura en "Riesgos", no como decisión.

## Decisión

### 1. Track: Checkout Pro vía **Preferences API**

- `POST /checkout/preferences`, redirección a `init_point` (flujo de §7, `PAY-02`). Es el producto documentado con `binary_mode`, `expires`/`expiration_date_to`, `back_urls`, `auto_return`, `external_reference` y `marketplace_fee`.
- **Checkout Pro vía Orders API existe** (`POST /v1/orders`, `type: online`, `processing_mode: manual`, `expiration_time` ISO 8601, `X-Idempotency-Key` documentado, notificaciones con topic `order`) y la documentación lo lista como producto hermano, no como reemplazo. Se lo descarta **para el MVP**, no para siempre (ver Alternativas).
- **Payments API** (`/v1/payments` directo, Checkout API) es **legacy**: Mercado Pago "no desactivó esta API, solo dejó de agregarle nuevas funcionalidades". No se usa para crear cobros. Sí se usa `GET /v1/payments/{id}` para verificar y `POST /v1/payments/{id}/refunds` para reembolsar, porque los pagos de Checkout Pro viven ahí.
- La afirmación de `PAY-00` de que Mercado Pago "recomienda Orders para integraciones nuevas" **no está confirmada** en las páginas de Checkout Pro: sólo la Payments API aparece rotulada como legacy. Se corrige en la especificación.

### 2. Credenciales por organizador: **OAuth de Mercado Pago**

- Cada organizador vincula su cuenta con el flujo `authorization_code` (`https://auth.mercadopago.com/authorization` → `POST https://api.mercadopago.com/oauth/token`). Parámetros: `client_id`, `response_type=code`, `platform_id=mp`, `redirect_uri` (exacta y estática), `state` único por intento; **PKCE activado** (S256).
- El `code` vale 10 minutos; el `access_token` **180 días**; la renovación (`grant_type=refresh_token`) requiere el scope `offline_access` y **devuelve un refresh token nuevo**: hay que guardar el nuevo y descartar el viejo.
- Consecuencias de diseño:
  - Renovación **serializada por organizador** (lock de fila / `SELECT … FOR UPDATE`) y persistencia atómica del par nuevo; una renovación concurrente invalidaría el refresh token.
  - Renovación **proactiva** (política propia: al quedar ≤ 30 días) con alerta si falla; si el organizador revoca el acceso, el estado pasa a "vinculación caída" y los checkouts nuevos fallan explícitamente (§13.1), sin tocar holds en curso.
  - Los tokens se guardan **cifrados a nivel aplicación** (AES-256-GCM con clave de datos envuelta por KMS/vault; sólo texto cifrado + `key_id` en base), nunca en logs ni respuestas (`PAY-01`, `PAY-07`). Rotación de la clave = re-cifrado por lote con `key_id`.
  - El Access Token y la Public Key del vendedor se obtienen **sólo por OAuth** ("utilizando necesariamente el token de acceso para cada vendedor que fue obtenido a través de OAuth").
  - Las credenciales de la aplicación de FeriaOS (`client_id`/`client_secret`) son de plataforma, van en entorno/secret manager y requieren definir variables nuevas en el esquema de ADR 0004 cuando `PAY-01` las consuma. `MP_ACCESS_TOKEN` queda como credencial de plataforma/sandbox, no de organizador.
- **`marketplace_fee`:** existe en Preferences (monto por preferencia, se descuenta después de la comisión de Mercado Pago). **No se usa en el MVP** (coherente con §7: no asumir split ni comisiones). Cobrar comisión por reserva queda condicionado a validar condiciones comerciales de Mercado Pago (R-MP-3).

### 3. Firma de webhooks: **`WebhookSignatureValidator` del SDK oficial**

- El SDK `mercadopago` (npm, relevado 3.6.1) expone `WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret, toleranceSeconds? })`, que lanza `InvalidWebhookSignatureError` con un motivo tipado. Se usa éste en lugar de reimplementar el manifest.
- Algoritmo (según el código del SDK): HMAC-**SHA256** en hex, clave = firma secreta de la aplicación, mensaje = manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (los pares sin valor se omiten), comparación en tiempo constante. `x-signature` llega como `ts=<epoch segundos>,v1=<hash>`; `data.id` sale de la **query**.
- Frescura: la documentación **no da** ventana para `ts`. El SDK acepta `toleranceSeconds` opcional. Política: se **registra** la deriva de `ts` siempre y se **exige** `toleranceSeconds = 300` sólo después de comprobar en sandbox que los reintentos (cada 15 min, luego 6/48/96 h) llegan re-firmados; si reusan el `ts` original, una ventana corta rechazaría reintentos legítimos. Mientras tanto la defensa contra replay es el **inbox deduplicado** + la consulta server-to-server (§6.7).
- Secreto: se guarda cifrado como los tokens; la documentación recomienda renovarlo periódicamente (botón *Reset* en "Tus integraciones") y no indica si el anterior deja de valer al instante, así que la rotación se planifica con una ventana en que se aceptan ambos secretos.
- Firma inválida → 401 sin procesar. Respuesta 200/201 dentro de los 22 s; el procesamiento es asíncrono (`PAY-03`).

### 4. Idempotencia

- **Preferences:** la referencia de `POST /checkout/preferences` **no documenta** `X-Idempotency-Key`. La idempotencia es **nuestra**: un `payment_attempt` por (reserva, intento) con id UUID; `external_reference` = id del attempt; `preference_id` e `init_point` se persisten una sola vez y reintentar el endpoint devuelve lo persistido. Si la creación expira sin respuesta, puede quedar una preferencia huérfana sin pagar (inofensiva: expira y el attempt no la referencia); la conciliación cruza por `external_reference`.
- **Reembolsos y cualquier escritura:** se envía **siempre** un `X-Idempotency-Key` propio y estable (UUID derivado del id de la solicitud de reembolso, persistido antes de llamar). El SDK ya agrega el header en cada escritura pero **genera un UUID nuevo si no se lo pasa**, lo que anula la idempotencia ante un reintento: el adaptador de `PAY-01` debe pasar la clave explícitamente. La documentación sí exige el header en Orders ("incluye siempre `X-Idempotency-Key` con un UUID único por intento"); para refunds no se pudo confirmar la regla (R-MP-5).
- Reintentos acotados sólo en operaciones con clave idempotente; los `GET` se reintentan libremente.

### 5. `binary_mode` y pagos offline

- **`binary_mode: false`** (se acepta `pending`/`in_process`). Con `true`, los pagos pendientes o en revisión se **rechazan automáticamente** y baja la tasa de aprobación; para ferias, donde el medio offline es parte de la demanda, es una pérdida concreta.
- Consecuencias sobre el hold (§6.5–6.6):
  - `expires: true` y `expiration_date_to` ≤ vencimiento del hold, como en `PAY-02`.
  - Un attempt en `pending`/`in_process` **no libera el hold a ciegas**: el job de expiración consulta el pago por `external_reference` y respeta una ventana de conciliación (`PAY-05`).
  - Si un pago offline se aprueba **después** de adjudicado el stand: `LATE_PAYMENT_CONFLICT` y devolución (§6.8). La UI de retorno explica el estado pendiente (`PAY-04`).
  - Restringir medios offline por evento (`payment_methods`) queda como palanca de producto, no del MVP.

## Alternativas consideradas

| Opción | Por qué no (ahora) |
|---|---|
| Checkout Pro vía **Orders API** | Es un producto vigente y con `X-Idempotency-Key`, pero la guía de marketplace sólo documenta `marketplace_fee`/Preferences y la guía de migración dice que `application_fee` en Orders **no está documentado todavía** ("mantén el flujo en Payments API hasta que exista soporte"). Cambia el topic (`order`) y el modelo de estados. Revaluar cuando se confirme el soporte de split y OAuth en Orders para Argentina; el puerto `PaymentProvider` aísla el cambio. |
| Payments API / Checkout API directo | Legacy sin funcionalidades nuevas; exige capturar datos de pago o tokenizar en el frontend (más alcance PCI). |
| **Cuenta única** de la plataforma | FeriaOS pasaría a ser el cobrador de terceros: implicancias fiscales y de custodia de fondos que §7/R1 y §1.6 evitan. Es el camino rápido, y por eso mismo hay que decidir conscientemente no tomarlo. |
| Credenciales pegadas a mano por el organizador (token de producción) | Sin consentimiento acotado ni revocación desde Mercado Pago; manipulación de secretos en la UI. |
| Reimplementar el manifest HMAC | El SDK ya lo hace con comparación en tiempo constante y soporta nuevas versiones de firma (`vN`). |
| `binary_mode: true` | Rechaza pagos offline y en revisión; ver punto 5. |

## Consecuencias

- `PAY-01` define el puerto `PaymentProvider` con una cuenta vendedora **resuelta por tenant** (no un token global) y un adaptador falso; `PAY-07` implementa el flujo OAuth y el estado de vinculación.
- Hace falta una tabla de vinculaciones cifrada por tenant (tokens, `expires_at`, `key_id`, id del vendedor), sin exponer secretos a la API; el cotejo del webhook (§6.7) valida que el cobrador del pago sea el del tenant.
- Se agregan variables de plataforma (credenciales de la aplicación, redirect URI) siguiendo la regla de ADR 0004: schema + `.env.example` + §13.1 en el mismo cambio.
- `SUB-01` (suscripciones SaaS) **no** reutiliza las credenciales de organizador: cobra la plataforma en su propia cuenta; se decide aparte.

## Riesgos (no confirmados en la documentación oficial vigente)

| # | Riesgo | Mitigación |
|---|---|---|
| R-MP-1 | Las páginas `.com.ar` de webhooks de Checkout Pro **no muestran** el manifest ni el algoritmo; sólo dicen "verificación basada en HMAC". Lo usado sale del código del SDK 3.6.1. | Usar el validador del SDK; test con el simulador del panel y webhooks reales en sandbox (`PAY-03`); fijar versión del SDK. |
| R-MP-2 | Regla de `data.id` en minúsculas para ids alfanuméricos y **ventana de frescura de `ts`** no documentadas (el SDK no normaliza mayúsculas). Se desconoce si los reintentos se re-firman. | Ver punto 3: registrar deriva, enforzar tras prueba en sandbox. |
| R-MP-3 | Disponibilidad y condiciones comerciales de `marketplace_fee`/split para Argentina: la guía no declara restricciones pero tampoco afirma disponibilidad (§7: no asumirla). | No usar en el MVP; validar con Mercado Pago antes de comercializar. |
| R-MP-4 | Vigencia del refresh token no documentada (sólo rotación en cada uso y 180 días para el access token); scopes disponibles no listados. | Alerta de renovación fallida; flujo de re-vinculación; verificar en sandbox con cuentas de prueba. |
| R-MP-5 | `X-Idempotency-Key` en reembolsos y nombre del campo de **monto parcial** no confirmados (la página de reembolsos no lo nombra y la referencia no cargó). La referencia de Preferences tampoco lista el header. | Enviar siempre clave propia; confirmar el campo en la referencia antes de `PAY-06`. |
| R-MP-6 | No está documentado si un pago offline emitido sigue siendo pagable luego de vencida la preferencia, ni por cuánto. | Cubierto por conciliación y `LATE_PAYMENT_CONFLICT`; medir en sandbox. |
| R-MP-7 | Soporte de `application_fee`/split y OAuth en Orders API para Argentina sin confirmar; Mercado Pago podría mover el producto hacia Orders. | Puerto `PaymentProvider`; revaluar en cada revisión. |
| R-MP-8 | El manifest se apoya en código del SDK y no en prosa de la documentación `.com.ar`. | Pin de versión + test de contrato con firmas de ejemplo. |

## Fuentes (consultadas el 2026-11-02)

- Checkout Pro (Preferences), visión general: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/overview
- Checkout Pro vía Orders, visión general: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/overview
- Crear order (Checkout Pro vía Orders): https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order
- Notificaciones (Checkout Pro vía Orders): https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications
- Webhooks (firma, 22 s, reintentos, validadores por SDK): https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
- Migración Payments API a Orders API (estado legacy): https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/resources/migrate-payments-to-orders
- Integrar marketplace (OAuth, `marketplace_fee`): https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/additional-settings/integrate-marketplace
- OAuth, creación de credenciales: https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation
- OAuth, renovación del Access Token: https://www.mercadopago.com.ar/developers/es/docs/security/oauth/renewal
- Modo binario (Preferences): https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/binary-mode
- Reembolsos y cancelaciones: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/refunds-and-cancellations
- Referencia crear preferencia: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post
- SDK oficial `mercadopago` 3.6.1 (código de `utils/webhook`): https://www.npmjs.com/package/mercadopago
