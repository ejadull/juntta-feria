# FeriaOS — OpenSpec técnico y funcional v1.0
Fecha: 2026-10-27 · Mercado inicial: Argentina · Estado: propuesta para implementación

## 0. Convenciones y decisiones
- RFC 2119: MUST obligatorio, SHOULD recomendado, MAY opcional.
- Moneda: ARS; importes almacenados en centavos enteros (`BIGINT`). Fechas UTC en backend, `America/Argentina/Buenos_Aires` configurable por evento para visualización.
- UUID para identificadores; `tenant_id` obligatorio en datos privados; idempotencia para comandos de pago y reservas.
- Estado de este documento: especificación de ingeniería, no certificación de cumplimiento legal/fiscal ni integración probada.
- Modalidad: predios permanentes e itinerantes; plantillas reutilizables, versiones inmutables asociadas al evento.

## 1. PRD
### 1.1 Problema
Los organizadores comercializan stands con planillas, imágenes estáticas y transferencias difíciles de conciliar. Los feriantes no conocen disponibilidad/precios confiables y los visitantes carecen de un directorio espacial.
### 1.2 Objetivos
1. Publicar un evento con plano y tarifas en menos de 30 minutos una vez cargada la plantilla.
2. Permitir elegir stand, reservar y pagar online sin intervención manual.
3. Garantizar no doble adjudicación incluso bajo concurrencia y reintentos.
4. Publicar directorio de expositores sobre el mismo plano.
5. Segregar organizaciones estrictamente.
### 1.3 Personas
- SaaS superadministrador: opera tenants, planes y soporte auditado.
- Owner/administrador de organizador: configura predios, eventos, equipo y cobros.
- Operador: administra plano, revisa feriantes y reservas.
- Expositor/feriante: gestiona ficha, selecciona y paga un espacio.
- Visitante anónimo: descubre expositores en el plano público.
### 1.4 KPIs
Tasa de ocupación = stands asignados / stands comercializables; GMV bruto aprobado, tasa checkout completado, tiempo mediano hasta reservar, cancelaciones, conciliación pendiente y errores de webhook; distinguir GMV de ingreso SaaS.
### 1.5 MVP incluido
Tenants y roles; predios fijos/itinerantes; editor de layout a escala; versionado/publicación; tarifas por stand; un stand por checkout inicialmente; reserva/hold; Mercado Pago Checkout Pro; perfil expositor; plano público responsive; dashboard e informes CSV; auditoría.
### 1.6 No objetivos MVP
Marketplace de productos, mensajería/chat, venta de entradas, entrega de dinero en split marketplace, facturación ARCA automática, apps nativas, reservas offline, navegación indoor por GPS, facturación múltiple por empresa.
### 1.7 Reglas de aceptación producto
AC-PRD-01: se crean dos eventos desde un mismo plano sin compartir reservas ni tarifas.
AC-PRD-02: una plantilla modificada no altera eventos publicados.
AC-PRD-03: un visitante ve solo fichas públicas consentidas.
AC-PRD-04: antes de pagar se muestra precio final, condiciones, política de cancelación y proveedor cobrador.

## 2. Arquitectura y tecnología
- Angular PWA: shell de app, admin lazy loaded, portal feriante y portal público; SSR/prerender para páginas públicas si se requiere SEO.
- SVG nativo: vista y edición del layout ([ADR 0001](../adr/0001-svg-para-editor-y-mapa.md)). Coordenadas persistidas en metros, nunca píxeles.
- NestJS: monolito modular, controladores REST `/api/v1`, DTOs validados, Swagger/OpenAPI; SSE para actualizaciones de disponibilidad.
- PostgreSQL + PostGIS: persistencia relacional, geometría planar local (`geometry(Polygon,0)`), RLS como defensa adicional, constraints e índices espaciales.
- Redis + BullMQ: jobs de reconciliación, notificaciones y vencimientos; el lock/constraint DB sigue siendo fuente de verdad.
- S3 compatible: imágenes de eventos, marcas, planos importados y documentos; LocalStack emula S3 en desarrollo; URLs firmadas y validación de uploads.
- Mercado Pago: backend preferences Checkout Pro, webhook con validación y consulta de estado remota.
- Observabilidad: health endpoints, métricas, logs JSON con correlation IDs, tracing; Sentry u OpenTelemetry opcionales.
- Despliegue: reverse proxy HTTPS, CI/CD con migraciones, backups y restauración probada.

### 2.1 Límites de módulos NestJS
AuthModule; TenantsModule; OrganizationsModule; VenuesModule; LayoutsModule; EventsModule; EventStandsModule; PricingModule; ExhibitorsModule; ReservationsModule; PaymentsModule; NotificationsModule; FilesModule; AnalyticsModule; AuditModule; PublicCatalogModule.

### 2.2 Multi-tenancy
Pool PostgreSQL compartido y tablas compartidas con `tenant_id`; RLS habilitado en tablas privadas, `SET LOCAL app.tenant_id = ...` únicamente dentro de transacciones de tenant; prohibir acceso de la aplicación con rol BYPASSRLS; el rol de migración queda separado. Índices únicos incluyen tenant cuando aplique. El request host/subdominio solo sirve para resolver tenant permitido, nunca como evidencia de autorización. Las rutas públicas consultan vistas/campos expresamente publicados.

## 3. Modelo de dominio
### 3.1 Entidades
- tenants(id, slug, name, status, plan_id)
- users(id, email, password_hash, status)
- memberships(id, tenant_id, user_id, role, status)
- venues(id, tenant_id, type FIXED|TEMPORARY, name, address, timezone, width_m, height_m)
- layout_templates(id, tenant_id, venue_id nullable, name)
- layout_versions(id, tenant_id, template_id, version, width_m, height_m, status DRAFT|PUBLISHED|ARCHIVED, published_at)
- layout_objects(id, tenant_id, layout_version_id, kind STAND|AISLE|ENTRY|EXIT|UTILITY|OBSTACLE|EMERGENCY, code, geometry, metadata)
- events(id, tenant_id, venue_id, layout_version_id, name, slug, starts_at, ends_at, sales_open_at, sales_close_at, status DRAFT|PUBLISHED|ACTIVE|CLOSED|CANCELLED)
- event_sectors(id, tenant_id, event_id, name, category_id nullable, sort_order) — agrupación temática por evento ([ADR 0002](../adr/0002-sectores-por-evento.md))
- event_stands(id, tenant_id, event_id, layout_object_id, sector_id nullable, code, status AVAILABLE|BLOCKED|ASSIGNED|DISABLED, price_cents, currency, services)
- exhibitors(id, tenant_id, legal_name, trade_name, tax_id nullable, category_id, description, logo_key, public_contact_opt_in)
- reservations(id, tenant_id, event_stand_id, exhibitor_id, user_id, status, hold_expires_at, price_cents, currency, terms_version, idempotency_key, created_at)
- payment_attempts(id, tenant_id, reservation_id, provider, provider_checkout_id [order id, ADR 0007], provider_payment_id, status, amount_cents, currency, external_reference, checkout_url, created_at)
- payment_webhook_inbox(id, provider, provider_event_id, signature_verified, payload_hash, processed_at, status)
- event_pricing_rules(id, tenant_id, event_id, rule_type, category, priority, config)
- documents(id, tenant_id, exhibitor_id, type, object_key, review_status)
- audit_logs(id, tenant_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at)

### 3.2 Invariantes
INV-01: Reserva activa única por event_stand. `HELD`, `PAYMENT_PENDING`, `CONFIRMED`, `REFUND_PENDING` requieren exclusividad; adaptar cancelación/expiración transaccional.
INV-02: Reserva tiene mismo tenant que stand, expositor y usuario autorizado; validar con FK compuestas o triggers, además de guards/RLS.
INV-03: Event referencia un layout publicado e inmutable. EventStand referencia un objeto STAND de ese layout.
INV-04: Layout objeto geométrico es válido, superficie >0; dentro de límites del predio; dos stands no se superponen con área > epsilon m²; compartir borde es válido.
INV-05: El backend fija amount/currency desde event_stand/pricing snapshot. Nunca aceptar importes desde cliente.
INV-06: Cambios postpublicación requieren nueva versión y proceso de migración consciente de reservas existentes.
INV-07: pagos aprobados nunca se pierden: ante una aprobación tardía se crea incidencia de conciliación/reembolso sin adjudicar por error.
INV-08: la información fiscal y privada de expositores no aparece en el directorio público sin autorización.
INV-09: un event_stand pertenece como máximo a un sector, y solo a un sector de su mismo evento y tenant (FK compuesta). El layout no tiene sectores: son del evento ([ADR 0002](../adr/0002-sectores-por-evento.md)).

### 3.3 DDL núcleo ilustrativo
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE event_sectors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 event_id uuid NOT NULL,
 name text NOT NULL CHECK (btrim(name) <> ''),
 category_id uuid,
 sort_order int NOT NULL DEFAULT 0,
 UNIQUE (tenant_id, event_id, id)
);
-- "Diseño" and "diseño " are the same sector
CREATE UNIQUE INDEX uq_event_sector_name ON event_sectors (tenant_id, event_id, lower(btrim(name)));
CREATE TABLE event_stands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 event_id uuid NOT NULL,
 layout_object_id uuid NOT NULL,
 sector_id uuid,
 code text NOT NULL,
 status text NOT NULL CHECK (status IN ('AVAILABLE','BLOCKED','ASSIGNED','DISABLED')),
 price_cents bigint NOT NULL CHECK (price_cents >= 0),
 currency char(3) NOT NULL DEFAULT 'ARS',
 UNIQUE (tenant_id, event_id, code),
 UNIQUE (tenant_id, id),
 -- INV-09; SET NULL with a column list requires PostgreSQL >= 15
 FOREIGN KEY (tenant_id, event_id, sector_id) REFERENCES event_sectors(tenant_id, event_id, id) ON DELETE SET NULL (sector_id)
);
CREATE TABLE reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 event_stand_id uuid NOT NULL,
 exhibitor_id uuid NOT NULL,
 user_id uuid NOT NULL,
 status text NOT NULL CHECK (status IN ('HELD','PAYMENT_PENDING','CONFIRMED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED')),
 hold_expires_at timestamptz,
 price_cents bigint NOT NULL CHECK (price_cents >= 0),
 currency char(3) NOT NULL,
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,event_stand_id) REFERENCES event_stands(tenant_id,id),
 UNIQUE (tenant_id, idempotency_key)
);
CREATE UNIQUE INDEX uq_one_active_reservation_per_event_stand
 ON reservations(event_stand_id)
 WHERE status IN ('HELD','PAYMENT_PENDING','CONFIRMED','REFUND_PENDING');
CREATE TABLE layout_objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 layout_version_id uuid NOT NULL,
 kind text NOT NULL,
 code text,
 geometry geometry(Polygon,0) NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 CHECK (ST_IsValid(geometry) AND ST_Area(geometry) > 0)
);
CREATE INDEX ix_layout_geom ON layout_objects USING gist (geometry);
```
Este DDL es un fragmento ilustrativo: las migraciones completas añadirán FKs compuestas faltantes, RLS, restricciones de no-solapamiento, índices de consultas, timestamps y auditoría. `geometry(...,0)` usa plano local adimensional interpretado contractualmente en metros; no usar SRID 4326 con ST_Area para este caso.

### 3.4 Solapamiento de stands
```sql
SELECT a.id, b.id
FROM layout_objects a
JOIN layout_objects b
  ON a.layout_version_id=b.layout_version_id AND a.id<b.id
WHERE a.kind='STAND' AND b.kind='STAND'
  AND ST_Intersects(a.geometry,b.geometry)
  AND ST_Area(ST_Intersection(a.geometry,b.geometry)) > 0.0001;
```
Validar también límites (`ST_CoveredBy`) y espacios reservados para circulación. El editor debe ofrecer snap/grid (0.25m/0.5m), zoom, pan, undo/redo, alineación, códigos, rotación, polígonos, accesos, pasillos, áreas no vendibles y exportación PNG/PDF (exportación como evolución si excede MVP).

## 4. Historias y reglas funcionales
### 4.1 Organizador
Como organizador puedo crear una organización, registrar predio, diseñar plantilla, publicar una versión del plano, generar un evento, cargar precios y activar venta. No puedo publicar geometrías inválidas o espacios sin tarifa/estado.
### 4.2 Expositor
Como feriante puedo filtrar stands por metros, superficie, precio, servicios, sector y disponibilidad; abrir ficha y reservar; gestionar perfil comercial; pagar con Mercado Pago y recibir constancia.
### 4.3 Visitante
Como visitante puedo abrir la página del evento, ver el mapa navegable y conocer marcas, categorías y catálogo básico sin acceder a información privada.
### 4.4 Tarifas
Precio fijo por stand para MVP; snapshot del precio al reservar. Preparar esquema para tarifas por m², por sector (regla `SECTOR` con `config.sectorId`, [ADR 0002](../adr/0002-sectores-por-evento.md)), ubicación/cercanía a accesos, servicios extras, descuentos promocionales, señas y tramos de preventa en iteraciones posteriores.
### 4.5 Estados y transición
Evento DRAFT→PUBLISHED→ACTIVE→CLOSED, CANCELLED desde estados permitidos. Layout DRAFT→PUBLISHED→ARCHIVED; no editar publicado. Reserva HELD→PAYMENT_PENDING→CONFIRMED, o EXPIRED/CANCELLED; confirmado→REFUND_PENDING→REFUNDED según política. Pago siempre se reconcilia separadamente.

## 5. Contratos API REST v1
Autenticación de panel `Authorization: Bearer <token>` (access token JWT, [ADR 0004](../adr/0004-contrato-de-entorno-y-autenticacion.md)). Las rutas de tenant reciben la organización elegida en el header `X-Tenant-Id` (P02), y la API verifica en cada request la membresía activa y el rol (`CORE-03`): sin header o con un UUID inválido → 400; tenant ajeno, inexistente o suspendido, o membresía deshabilitada → 404 uniforme; rol insuficiente → 403. Recursos públicos explícitos sin credenciales. Errores `application/problem+json` con `type,title,status,detail,code,traceId`.

| Método | Ruta | Rol | Propósito |
|---|---|---|---|
| POST | /api/v1/auth/login | público | Login |
| GET | /api/v1/me | usuario | Perfil y memberships |
| POST | /api/v1/tenants | superadmin | Crear organización y su `OWNER` `{ name, slug, owner: { email, fullName, password } }`; reutiliza al usuario si el email existe; 409 `TENANT_SLUG_TAKEN` (`CORE-04`). `GET` lista las organizaciones. Sin `X-Tenant-Id` |
| GET/POST | /api/v1/venues | owner/admin/operator | Listar/crear predios |
| GET/PATCH | /api/v1/venues/:id | owner/admin/operator | Ver/editar predio |
| DELETE | /api/v1/venues/:id | owner/admin | Eliminar predio |
| GET/POST | /api/v1/layout-templates | owner/admin/operator | Listar plantillas con sus versiones / plantilla nueva (devuelve su versión 1 en borrador) |
| POST | /api/v1/layout-templates/:id/versions | owner/admin/operator | Clonar una versión (`sourceVersionId`) como nuevo borrador |
| GET | /api/v1/layout-versions/:id | owner/admin/operator | Versión con sus objetos |
| PUT | /api/v1/layout-versions/:id/objects | owner/admin/operator | Guardar el borrador completo (el editor guarda todo junto, LUI-05 D6) |
| POST | /api/v1/layout-versions/:id/publish | owner/admin | Validar con PostGIS y publicar; 422 con `issues` si falla |
| POST/GET | /api/v1/events | owner/admin/operator | Crear (genera un stand por cada STAND del plano) / listar eventos |
| GET/PATCH | /api/v1/events/:id | owner/admin/operator | Ver / editar evento en borrador |
| POST | /api/v1/events/:id/publish | owner/admin | Publicar evento; 422 con `issues` si hay stands vendibles sin precio |
| GET/PATCH | /api/v1/events/:id/stands | owner/admin/operator | Inventario; edición masiva de precio (centavos), sector y estado (`standIds`) |
| GET/POST | /api/v1/events/:id/sectors | owner/admin/operator | Sectores del evento ([ADR 0002](../adr/0002-sectores-por-evento.md)) |
| PATCH/DELETE | /api/v1/events/:id/sectors/:sectorId | owner/admin/operator | Editar / borrar sector (sus stands quedan sin sector) |
| GET | /api/v1/public/events | público | Eventos en venta de todas las organizaciones (`PUB-01`) |
| GET | /api/v1/public/events/:slug | público | Evento público |
| GET | /api/v1/public/events/:slug/map | público | GeoJSON y disponibilidad |
| GET | /api/v1/public/events/:slug/exhibitors | público | Directorio público |
| POST | /api/v1/reservations | expositor | Crear hold idempotente (`Idempotency-Key`); 201 nuevo, 200 si se repite la clave |
| GET | /api/v1/reservations | expositor/admin | Reservas propias (expositor) o de la organización; filtro `?eventId=` |
| POST | /api/v1/reservations/:id/checkout | propietario de reserva | Crear checkout |
| GET | /api/v1/reservations/:id | propietario/admin | Estado de reserva |
| POST | /api/v1/reservations/:id/cancel | propietario/admin | Cancelar según política |
| POST | /api/v1/webhooks/mercadopago | proveedor | Recibir eventos firmados (`PAY-03`; `EXH-05` suma los topics de suscripción, sin `tenant`); 401 si la firma no verifica |
| GET/POST/DELETE | /api/v1/me/subscription | usuario (sin tenant) | Suscripción del feriante a la plataforma (`EXH-05`): `POST` (con `Idempotency-Key`, `{ payerEmail? }`) crea el `preapproval` y devuelve `{ status, initPoint, currentPeriodEnd }`; `GET` el estado o `NONE`; `DELETE` cancela |
| GET | /api/v1/payment-incidents | owner/admin | Incidencias de cobro para P10: `LATE_PAYMENT_CONFLICT`, `AMOUNT_MISMATCH` (`PAY-05`), `CHARGEBACK` (`PAY-06`); `COLLECTOR_MISMATCH` (`PAY-07`); cada una trae el `reservationId` a devolver |
| GET/DELETE | /api/v1/payment-account | owner/admin | Estado de la cuenta vendedora de Mercado Pago (`NOT_LINKED`/`LINKED`/`EXPIRED`, entorno, `sellerId`), nunca tokens; `DELETE` desvincula (`PAY-07`) |
| POST | /api/v1/payment-account/authorization · /link | owner/admin | Inicia el OAuth con PKCE (devuelve `authorizationUrl`) y canjea `{ code, state }` del retorno (`PAY-07`) |
| POST | /api/v1/reservations/{id}/refunds | owner/admin | Con `Idempotency-Key`. Reembolsa los pagos aprobados y cancela los pendientes; `{ "amountCents" }` opcional para un reembolso parcial (`PAY-06`). 201 nuevo, 200 replay |
| GET | /api/v1/events/:id/metrics | operator | KPIs, incluido `occupancyBySector` ([ADR 0002](../adr/0002-sectores-por-evento.md)) (modelo de lectura: D2 de [`org-ui-shell`](changes/archive/2026-10-30-org-ui-shell/design.md)) |
| GET | /api/v1/exhibitors | owner/admin/operator | Expositores del tenant con datos privados y estado de documentación (D4 de [`org-ui-shell`](changes/archive/2026-10-30-org-ui-shell/design.md)); nunca para vistas públicas |
| GET | /api/v1/exhibitors/:id | owner/admin/operator | Ficha privada de un expositor |
| GET/PUT | /api/v1/me/exhibitor-profile | expositor | Perfil propio en la organización de `X-Tenant-Id`; `PUT` crea (201) o reemplaza (200), recibe `categoryId` y registra el consentimiento público |
| GET/POST/PATCH/DELETE | /api/v1/exhibitor-categories[/:id] | owner/admin/operator (`GET` también expositor) | Rubros de la organización (`EXH-02`); borrar uno en uso → 409 `CATEGORY_IN_USE` |
| GET/POST/DELETE | /api/v1/exhibitors/me/documents[/:id/complete · /:id/download] | expositor | Documentos propios (`EXH-03`): firma de subida, confirmación, descarga firmada y baja |
| GET/POST/PATCH/DELETE | /api/v1/exhibitors/me/photos[/:id · /:id/complete] | expositor | Fotos del perfil y publicaciones de una feria (`EXH-09`): firma de subida, confirmación, texto y baja. Una publicación exige un stand confirmado en el evento y que el evento siga vigente; cupo de 10 por feriante y evento |
| GET | /api/v1/public/share/:mediaId | público | Página para compartir una publicación (`EXH-09`): HTML con metadatos Open Graph y redirección a la feria. Una publicación oculta, sin consentimiento o de un evento terminado responde el mismo 404 que una inexistente |
| GET/POST | /api/v1/exhibitors/:id/documents[/:docId/download · /:docId/review] | owner/admin/operator | Documentos de un expositor: lista, descarga firmada y revisión |
| GET | /api/v1/events/:id/reservations/export | operator | Exportación CSV |
| GET | /api/v1/events/:id/stand-events | público | SSE disponibilidad saneada |

### 5.1 Ejemplo POST /reservations
```json
{
  "eventStandId": "8a530d14-5c9a-45ab-91af-7d8ab2c3e940",
  "exhibitorId": "ba983768-74f0-4f48-9d60-51696a9d22a7",
  "termsVersion": "2026-10-01"
}
```
Header requerido `Idempotency-Key: <uuid>`. Respuesta 201:
```json
{
  "id": "5a4a51b9-f0a6-49f4-9c59-7219abf1b6f0",
  "status": "HELD",
  "holdExpiresAt": "2026-10-27T16:15:00Z",
  "amount": {"currency":"ARS","valueCents":4500000},
  "stand": {"code":"A01","areaM2":9}
}
```
409 `STAND_UNAVAILABLE`; 422 `EVENT_SALES_CLOSED`; 403 `EXHIBITOR_NOT_AUTHORIZED`; 401 autenticación requerida; 429 rate limit.

### 5.2 Ejemplo checkout
`POST /api/v1/reservations/{id}/checkout` con `Idempotency-Key` devuelve `{ "paymentAttemptId":"...", "checkoutUrl":"https://...", "status":"PENDING" }`. No guardar URL del ejemplo ni hardcodear links. Backend envía preference con `external_reference=reservationId/paymentAttemptId` y monto snapshoteado. Retorno del navegador jamás confirma reserva.

### 5.3 Ejemplo GeoJSON mapa
`GET /api/v1/public/events/{slug}/map`:
```json
{
 "layoutVersion":3,
 "units":"m",
 "bounds":{"width":100,"height":60},
 "features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[10,10],[13,10],[13,13],[10,13],[10,10]]]},"properties":{"code":"A01","standId":"...","areaM2":9,"status":"AVAILABLE","price":{"currency":"ARS","valueCents":4500000}}}]
}
```
Usar `Cache-Control: no-store` o TTL muy corto para disponibilidad; refetch antes de checkout. No publicar geometría de seguridad sensible ni contactos no autorizados.

## 6. Algoritmo de reservas y concurrencia
1. Validar tenant, derechos sobre expositor, ventas abiertas y consistencia de versión.
2. Dentro de transacción: obtener `event_stands` por tenant/id con `SELECT ... FOR UPDATE`.
3. Expirar atómicamente el hold vencido cuando no haya cobro en estado incierto; detectar reserva activa según índice parcial.
4. Guardar snapshot de precio/reglas, términos y expiración usando reloj servidor; insertar reserva; commit.
5. En otra operación idempotente, crear payment attempt, preference Mercado Pago y registrar external reference. Si provider falla, mantener hold y permitir reintento dentro del plazo.
6. Job de expiración: verificar intento de pago pendiente con ventana de reconciliación; no liberar a ciegas cuando el proveedor no responde.
7. Webhook: autenticar firma, deduplicar inbox, consultar pago por API de Mercado Pago; cotejar referencia, merchant, monto y moneda. Confirmar en transacción bloqueando stand/reserva; registrar cambios y emitir evento.
8. Si pago llega tarde y stand fue adjudicado, registrar incidencia `LATE_PAYMENT_CONFLICT`, alertar y gestionar devolución sin doble adjudicación.
9. Auditoría de todas las transiciones; idempotencia con clave de request + identificadores provider + estados monotónicos.

## 7. Mercado Pago Argentina
- MVP: cuenta vendedora del organizador (configurada e identificada) y Checkout Pro; definir integración por organizador mediante mecanismo autorizado, sin almacenar secretos en claro.
- Nunca usar credenciales del usuario en el navegador ni aceptar precio enviado por frontend.
- Webhooks HTTPS: verificar `x-signature` según especificación oficial vigente (incluyendo request id/timestamp según producto), validar integridad/frescura, persistir inbox y responder rápidamente; procesamiento idempotente asíncrono.
- Verificar payload con consulta server-to-server antes de aprobar reserva.
- Incluir casos de pending, reject, chargeback, partial/full refunds, pago posterior a vencimiento.
- Facturación ARCA no incluida en MVP: exportar información y dejar interfaz `InvoicingProvider` para futuro con asesoramiento contable/fiscal.
- No asumir que checkout marketplace/split o comisiones están disponibles; validar programa y condiciones comerciales antes de comercializarlo.
- Fuentes: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/overview ; https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications

## 8. UX y pantallas
P01 Login/recuperación; P02 Selección de organización; P03 Dashboard; P04 Predios; P05 Crear/editar plantilla; P06 Editor canvas con propiedades, regla, grid, snapping, zoom, versión, validaciones; P07 Eventos wizard; P08 Configuración tarifas; P09 Inventario de stands en mapa/lista; P10 Reservas/conciliación; P11 Feriantes/verificación; P12 Configuración Mercado Pago; P13 Reportes; P14 Catálogo público; P15 Mapa público responsive; P16 Detalle stand y expositor; P17 Datos feriante; P18 Resumen reserva/condiciones; P19 Retorno de checkout pendiente/confirmado/rechazado; P20 Mis reservas y comprobantes; P21 Administración de miembros; P22 Auditoría.

### UX criterios
- Colores no son único medio de indicar disponibilidad: iconos, etiquetas y leyenda textual.
- Mapa navegable con teclado; lista alternativa accesible y sincronizada con selección; tooltips no esenciales para operar.
- En móvil: bottom sheet para ficha de stand, gestos pan/pinch, mínimo tamaño de toque apropiado, selector de lista.
- Precios en ARS con IVA/impuestos/servicios explicitados según política comercial; costo total antes de redirección.
- El portal puede mostrar ocupante y rubro sin compartir email/teléfono privado salvo consentimiento.

## 9. Seguridad, privacidad y operación
- OWASP ASVS nivel 2 como objetivo; rate limits, validación inputs, protección de cabeceras y SSRF, CORS limitado, CSRF si cookies.
- Argon2id para contraseñas locales o proveedor OIDC; MFA para admins recomendado.
- Política de rotación, almacenamiento cifrado KMS/vault para tokens Mercado Pago; nunca secretos en logs, imágenes, Compose ni Git.
- Aislamiento tenant: RBAC en servicios y políticas RLS; 403/404 uniforme para otros tenants.
- Uploads: allowlist MIME/tamaño, comprobación de contenido y almacenamiento privado.
- Ley argentina 25.326 y obligaciones aplicables: evaluar con asesoría jurídica; política de privacidad, consentimiento, retención, eliminación y derechos del titular.
- Backups cifrados diarios, PITR según infraestructura, ejercicio restauración mensual; RPO meta <=24h (objetivo inicial), RTO meta <=4h (a validar).
- Disponibilidad objetivo piloto >=99.5%; métricas de error, latencia p95 GET mapa <=500ms con dataset objetivo de 500 stands, 10 req/s, bajo entorno de prueba definido.
- Pruebas de seguridad y carga antes de salida.

## 10. Backlog por épicas (estimación SP)
| Épica | Historias esenciales | SP aproximados |
|---|---|---:|
| EP01 Core SaaS | Tenant, membresías, roles, auth, auditoría | 21 |
| EP02 Predios | CRUD, ubicación, medidas | 13 |
| EP03 Editor planos | Canvas, geometría, grid, validación, versionado | 40 |
| EP04 Eventos y tarifas | Wizard, calendario, vincular plano, sectores, precios | 21 |
| EP05 Feriantes | Registro, perfil, rubro, documentos | 13 |
| EP06 Inventario/reservas | Estados, hold, locking, expiración, idempotencia | 34 |
| EP07 Mercado Pago | Preferencias, Webhooks, conciliación, refund | 34 |
| EP08 Portal público | Directorio, mapa, ficha, responsive, accesibilidad | 21 |
| EP09 Reportes | Ocupación, GMV, exportaciones | 13 |
| EP10 Plataforma | Docker, CI/CD, migraciones, observabilidad, backups, QA | 34 |
| **Total** | **Estimación inicial sujeta a refinamiento** | **244** |

### 10.1 Plan de ejecución y subtareas

El desarrollo se ejecuta por incrementos verticales. Cada tarea conserva un identificador estable, estado, dependencias, criterios de aceptación y evidencia. Estados permitidos: `PENDING`, `IN_PROGRESS`, `BLOCKED` y `VERIFIED`. Una tarea solo puede pasar a `VERIFIED` cuando sus criterios estén comprobados y la evidencia quede registrada sin secretos.

#### Sprint 0A — tareas independientes

Estas tareas pueden desarrollarse sin depender de una funcionalidad de dominio terminada. Los contratos exactos entre ellas están definidos en el plan de implementación de Sprint 0A.

##### FND-01 — Decisiones arquitectónicas y trazabilidad

- **Estado:** `VERIFIED`
- **Dependencias:** ninguna
- **Entrega:** ADRs para monorepo/ejecución, configuración/autenticación y persistencia/PostGIS; este tablero permanece alineado con el diseño aprobado.
- **Aceptación:** las decisiones no contradicen el stack existente ni presentan como implementadas capacidades aún pendientes.
- **Evidencia requerida:** revisión documental, enlaces internos válidos y `git diff --check`.
  - 2026-10-30: ADRs en `docs/adr/` (una sola carpeta y numeración, en lugar de `docs/architecture/adr/0001-0003` del plan): [0003](../adr/0003-monolito-modular-npm-workspaces.md), [0004](../adr/0004-contrato-de-entorno-y-autenticacion.md), [0005](../adr/0005-drizzle-y-sql-explicito-postgis.md).
- [x] Crear ADR del monolito modular con npm workspaces.
- [x] Crear ADR del contrato de configuración y JWT con refresh token HttpOnly.
- [x] Crear ADR de Drizzle ORM con SQL explícito para PostGIS, RLS y constraints críticos.
- [x] Corregir referencias de infraestructura que no coincidan con las rutas reales.
  - 2026-10-30: README reescrito con el stack y las rutas reales (npm workspaces, LocalStack en lugar de MinIO, editor SVG en lugar de Konva/Fabric, Compose ejecutable, sin `MINIO_*`); el borrador previo (Nx/pnpm, NGINX, Konva) se movió sin cambios a [`docs/vision/stack-propuesto-original.md`](../vision/stack-propuesto-original.md) con aviso de que los ADR mandan.

##### FND-02 — Contrato de entorno y validación

- **Estado:** `VERIFIED`
- **Dependencias:** ninguna
- **Entrega:** `.env.example` completo y seguro, `.env` local coherente y validación tipada al iniciar la API.
- **Aceptación:** variables requeridas inválidas detienen el arranque con mensajes saneados; variables futuras opcionales no bloquean flujos ajenos; ningún secreto se versiona ni aparece en salidas.
- **Evidencia requerida:** pruebas unitarias de configuración, comprobación de claves sin valores y revisión de archivos rastreados.
  - 2026-10-30: `npm run test --workspace api` → 28/28 (27 de `env.schema.spec.ts`); `node --test scripts/init-local-env.test.mjs` → 5/5; `docker compose config --quiet` OK.
  - Ajustes aprobados: sin variables `MINIO_*` (el stack usa LocalStack); `CORS_ORIGINS` reemplaza a `CORS_ORIGIN` en Compose; el puerto publicado de PostgreSQL usa `POSTGRES_PORT`, el nombre de la plantilla.
  - Bloqueo: `Read/Edit(.env.*)` está denegado en la configuración global de Claude Code; la plantilla y el `.env` real los aplica una persona.
- [x] Clasificar variables requeridas, opcionales, predeterminadas y reservadas (ADR 0004).
- [x] Actualizar `.env.example` con documentación y marcadores inequívocos (aplicado por la persona, commit `8213fd9`).
- [x] Completar `.env` local preservando valores existentes y generando solo los secretos faltantes (actualizado por la persona el 2026-10-30).
  - 2026-10-30: validación sin leer `.env`: `docker compose up -d --force-recreate api` arranca sin `EnvironmentError` (el esquema valida todas las variables requeridas) y `GET /api/v1/health/ready` → 200 con `postgres`/`redis`/`storage` `up`.
- [x] Implementar parser, tipado y validación de configuración (`apps/api/src/config/env.schema.ts`, `configuration.ts`, `ConfigModule` global).
- [x] Probar valores válidos, ausentes, malformados e incompatibles con producción (los errores nombran la variable, nunca el valor).

##### FND-03 — Contenedores y Compose reproducibles

- **Estado:** `VERIFIED`
- **Dependencias:** ninguna
- **Entrega:** Dockerfiles de desarrollo, contexto raíz compatible con el lockfile único, servicios persistentes e inicialización idempotente del bucket en LocalStack (S3).
- **Aceptación:** Compose renderiza y levanta PostgreSQL/PostGIS, Redis, LocalStack S3 con inicializador de bucket, API y Web; puertos host ligados a `127.0.0.1`; servicios sin reinicios inesperados.
- **Evidencia requerida:** `docker compose config --quiet`, build, estado/health de contenedores e inspección de bindings sin imprimir secretos.
  - 2026-10-30: `docker compose config --quiet` OK; los 5 servicios `Up`, `postgres`/`redis`/`s3` `healthy`, `RestartCount=0`; todos los `PortBindings` con `HostIp=127.0.0.1`; bucket creado por `infra/localstack/init-s3.sh` (head-bucket || create-bucket).
  - Fix: defaults de `S3_BUCKET` divergían entre `s3` y `api`; ambos quedan en `juntta-feria-local`.
  - Hallazgo de entorno: un PostgreSQL del host ocupa `5432` y el puerto del contenedor no se publica (la API no se afecta: usa la red Docker). El puerto publicado usa `POSTGRES_PORT` (default `5432`, mismo nombre que la plantilla); definir `5433` en `.env` (y en `DATABASE_URL`) para acceder desde el host.
- [x] Crear `.dockerignore` y Dockerfiles de desarrollo para API y Web.
- [x] Ajustar los contextos de build al lockfile raíz del workspace.
- [x] Agregar inicialización idempotente del bucket local.
- [x] Configurar healthchecks, dependencias y volúmenes persistentes.
- [x] Verificar bindings loopback y reinicios.

#### Sprint 0A — tareas dependientes

##### FND-04 — Base operativa de la API

- **Estado:** `VERIFIED`
- **Dependencias:** `FND-02`, `FND-03`
- **Entrega:** prefijo `/api/v1`, CORS validado, correlation ID, errores `application/problem+json`, OpenAPI de desarrollo y health/readiness reales.
- **Aceptación:** liveness no depende de servicios externos; readiness comprueba PostgreSQL, Redis y acceso al bucket S3; los errores no filtran secretos.
- **Evidencia requerida:** pruebas unitarias/E2E y requests HTTP contra el stack local.
  - 2026-10-30: `vitest run` → 47/47 (correlation ID 9, problem+json 7, readiness 4, entorno 27); `test:e2e` → 7/7 con el bootstrap real y chequeos falsos; `oxlint` 0 hallazgos; `tsc --noEmit` OK.
  - 2026-10-30: contra el stack Compose: `GET /api/v1/health/live` 200; `GET /api/v1/health/ready` 200 con `postgres`/`redis`/`storage` `up`; con `redis` detenido, ready 503 en 0,2 s marcando sólo `redis: down` (detalle únicamente en el log), live sigue en 200 y ready vuelve a 200 al reiniciarlo; ruta inexistente → 404 `application/problem+json` con `correlationId` y sin la query string; preflight CORS desde `http://localhost:4200` permitido con credenciales y desde otro origen sin `Access-Control-Allow-Origin`; `x-correlation-id` válido se devuelve tal cual y uno inválido se reemplaza por un UUID.
  - Hallazgo: el 404 nativo del router incluye la URL con query string en el mensaje; el filtro la recorta (podría llevar tokens).
  - Hallazgo: el watch de `nest start` en el contenedor no detecta cambios del bind mount en Windows; hay que reiniciar `api` (pendiente para FND-06: polling o documentarlo).
- [x] Configurar bootstrap, prefijo versionado y allowlist CORS (`src/bootstrap.ts`, compartido por `main.ts` y el e2e).
- [x] Implementar propagación/generación de correlation ID (`x-correlation-id`, charset y largo acotados; si no, UUID v4).
- [x] Implementar filtro global de problemas HTTP (RFC 9457; 5xx con detalle genérico y stack sólo en el log).
- [x] Implementar liveness y readiness con chequeos diferenciados (paralelos, timeout de 2 s por dependencia; S3 vía `HeadBucket`).
- [x] Habilitar OpenAPI únicamente mediante configuración explícita de desarrollo (`SWAGGER_ENABLED`, en `/api/v1/docs`; el esquema lo rechaza en producción).

##### FND-05 — Conectividad Web–API

- **Estado:** `VERIFIED`
- **Dependencias:** `FND-03`, `FND-04`
- **Entrega:** el frontend consume la API por una ruta relativa estable y usa proxy configurable en desarrollo, sin URLs dependientes del entorno hardcodeadas en componentes.
- **Aceptación:** Web alcanza liveness a través de su origen local tanto con npm como con Compose.
- **Evidencia requerida:** prueba del cliente, build Angular y request HTTP atravesando el proxy.
  - 2026-10-30: `ng test --watch=false` → 273/273 (`ApiStatusService` 5: base relativa, éxito, error HTTP, API inalcanzable y cuerpo que no es liveness; shell 2: "conectada" y "sin conexión" sin bloquear la demo); `node --test apps/web/proxy.conf.test.mjs` → 4/4.
  - 2026-10-30: request a través del proxy: con npm (`ng serve --port 4300`, default `http://localhost:3000`) y con Compose (`:4200`, `API_PROXY_TARGET=http://api:3000`), `GET /api/v1/health/live` → 200 `{"status":"ok"}` y `x-correlation-id` propagado; ruta inexistente → 404 `application/problem+json`.
  - 2026-10-30: `fnd05.mjs` en Chromium, 6/6: indicador "API: conectada" (`role="status"`) por npm y por Compose; con `api` detenido, "API: sin conexión" y la pantalla sigue usable. Sin regresiones: `org07` 50/50, `pub06` 60/60, `LUI-06` 25/25, `LUI-07` 16/16, `LUI-08` 22/22, `UX-01` 5/5, Playwright `e2e/` 6/6.
  - Hallazgo: una corrida de `org07`/`pub06` falló de forma intermitente justo después de reformatear archivos del shell: el dev server recargó la página en medio del flujo. Las dos corridas siguientes pasaron completas.
  - 2026-10-30: `ng build` (autorizado) OK en 4,6 s; avisos de presupuesto de estilos por componente (4 kB): `floor-plan-canvas.css` 6,29 kB (previo) y `stand-map.css` 5,05 kB, a resolver en FND-06 (ajustar presupuesto o recortar).
- [x] Definir cliente HTTP y base relativa `/api/v1` (`provideHttpClient(withFetch())`, `shared/api/api-base.ts`).
- [x] Configurar proxy de desarrollo mediante variable de entorno con default local seguro (`apps/web/proxy.conf.cjs`, `API_PROXY_TARGET`, default `http://localhost:3000`, falla si no es http(s) sin mostrar el valor).
- [x] Agregar una comprobación visible mínima del estado API sin diseñar todavía el producto final (indicador junto a "Ver como").
- [x] Probar éxito y fallo de conectividad.

##### FND-06 — Verificación y documentación de Sprint 0A

- **Estado:** `VERIFIED`
- **Dependencias:** `FND-01`, `FND-02`, `FND-03`, `FND-04`, `FND-05`
- **Entrega:** instrucciones locales consistentes, verificaciones completas y evidencia asentada en este documento.
- **Aceptación:** lint, tests, builds y validación Compose pasan; README refleja npm workspaces y rutas reales; no hay secretos ni cambios ajenos.
- **Evidencia requerida:** comandos, resultados y fecha registrados al cerrar la tarea.
  - 2026-10-30: `npm run lint` (oxlint en API y web; la web suma script `lint` y `oxlint` en devDependencies) sin hallazgos; `npm test --workspace api` 47/47; `npm run test:e2e --workspace api` 7/7; `ng test --watch=false` 273/273; `npm run test:proxy --workspace web` 4/4; `node --test scripts/init-local-env.test.mjs` 5/5; Playwright `e2e/` 6/6; `ng build` sin avisos (presupuesto de estilos por componente 8 kB/12 kB: los lienzos SVG del editor y del mapa pesan 6,3 kB y 5,1 kB).
  - 2026-10-30: `docker compose config --quiet` OK; stack en ejecución con `health/ready` 200 (PostgreSQL, Redis, S3) y la web alcanzando la API por el proxy. `npm ci --dry-run` en `node:22-alpine` valida el lockfile.
  - 2026-10-30: el watch de la API en Compose ahora detecta cambios por polling (`watchOptions` en `apps/api/tsconfig.json`; las variables `TSC_WATCHFILE` no alcanzan porque Nest arma su propio host de watch). Verificado editando un archivo: recompila y reinicia sin `restart`.
  - 2026-10-30: auditoría: `.env` sin versionar; `dist`, `coverage` y `test-results` ignorados; sin patrones de secretos (tokens de Mercado Pago, claves AWS, claves privadas, contraseñas literales) en archivos rastreados; `git diff --check` OK.
  - 2026-10-30: `npm run build --workspace api` (autorizado) OK; `dist/` sin restos del scaffold.
- [x] Actualizar README y eliminar contradicciones operativas con Nx/pnpm.
- [x] Ejecutar lint, pruebas unitarias, E2E relevantes y builds.
- [x] Validar Compose y el stack en ejecución.
- [x] Auditar diff, archivos rastreados y posibles secretos.
- [x] Registrar evidencia y cambiar estados solo para tareas realmente verificadas.

#### Fundamentos UX

##### UX-01 — Juntta Design System v1.0: paleta de colores

- **Estado:** `VERIFIED`
- **Dependencias:** ninguna.
- **Decisiones (2026-10-30):** Inter desde Google Fonts. El rojo queda solo para errores (`danger`); "Bloqueado" se ve deshabilitado en gris claro con contorno punteado, rayado y candado (detalle y contrastes en el documento de la paleta).
- **Entrega:** paleta de [`docs/design/juntta-design-system-v1.md`](../design/juntta-design-system-v1.md) como tokens únicos del frontend Angular, aplicada a shell, Panel, Expositores, Reservas y editor de plano; colores de estado de stands listos para P09/P15.
- **Aceptación:** ningún color de marca o de estado queda hardcodeado fuera de los tokens; todo texto cumple 4.5:1 (AA) y todo contorno/control informativo 3:1; los estados de stand se distinguen además por etiqueta, ícono o patrón; axe sin violaciones serias/críticas en todas las pantallas; suites E2E existentes sin regresiones.
- **Evidencia requerida:** verificación automatizada del contraste de los pares de tokens usados para texto y controles; reporte axe por pantalla; capturas en desktop y móvil.
  - 2026-10-30: `ng test --watch=false` → 228/228. 98 clases de paleta cruda (`gray/stone/emerald/amber/red/green`) reemplazadas por tokens y 0 restantes; 0 hex en estilos de componentes (salvo la sombra neutra de los controles de zoom).
  - 2026-10-30: `ux01.mjs` en Chromium sobre la app en ejecución: los 22 tokens en vivo coinciden con el documento; 22 pares texto/control cumplen 4.5:1 / 3:1 con los valores reales; Inter cargada desde Google Fonts; `lang="es"` y título "Juntta Feria"; marca "juntta." con lema.
  - 2026-10-30: `org07.mjs` 50/50 (axe-core 4.10.3 en las 5 pantallas, desktop y móvil, sin violaciones serias/críticas, incluida `color-contrast`); editor sin regresiones: `LUI-06` 25/25, `LUI-07` 16/16, `LUI-08` 22/22 (foco esperado actualizado a `selected`).
- [x] Tokens en `styles.css` con `@theme static` de Tailwind v4 (utilidades `bg-primary`, `text-text-muted`, `border-border`…). `static` hace falta: sin él Tailwind solo emite las variables usadas y los estados de stand (aún sin uso) desaparecían.
- [x] Variantes accesibles (`secondary-strong`, `accent-strong`, `reserved-stroke`, `occupied-strong`, `border-strong`) más `danger` y `blocked-stroke`.
- [x] Verificación de contraste de tokens. Desvío: en lugar de un test unitario con valores duplicados en TypeScript, `ux01.mjs` lee las variables CSS reales del navegador, así no hay dos fuentes que puedan divergir.
- [x] Shell: navegación activa en `primary`, fondo `background`, superficies `surface`/`surface-soft`, marca "juntta." (punto en `secondary`) con el lema "Ferias y encuentros".
- [x] Botones (`.btn`, `.btn-primary`, `.btn-danger`), campos (`.field` con `border-strong`), badges, `.card` compartida y foco visible en `selected`.
- [x] Panel (KPIs, gráfico GMV en `primary` y tinte), Expositores (estados de documentación con texto `text` sobre tinte) y Reservas.
- [x] Editor de plano: colores por `kind` armonizados (stand en `primary`, entradas en `accent`, emergencia en `reserved`, servicios en `secondary`); selección y foco en `selected`; errores en `danger`.
- [x] Estados de stand definidos como tokens (incluido `blocked` deshabilitado). El ícono/patrón (rayado y candado de "Bloqueado") se implementa con P09/P15; el editor no los usa (INV-03).
- [x] Inter desde Google Fonts; `index.html` pasa a `lang="es"` (estaba en `en`) y `theme-color` `primary`.
- [x] El documento de la paleta queda como fuente para el mockup de Lovable (fuera de este repo).
- Regla aplicada: el texto sobre un tinte de color va en `text`, nunca en el color del tinte (p. ej. `danger` sobre `danger/10` daría ~4.3:1).

#### Dependencias posteriores al Sprint 0A

| Tarea | Dependencias | Entrega principal | Estado |
|---|---|---|---|
| `CORE-01` Base de datos y migraciones | `FND-06` | Drizzle, migraciones PostgreSQL/PostGIS y roles separados — [detalle](#core-01--base-de-datos-y-migraciones) | `VERIFIED` |
| `CORE-02` Usuarios, sesiones y membresías | `CORE-01` | login, refresh rotativo HttpOnly, logout y membresías — [detalle](#core-02--usuarios-sesiones-y-membresías) | `VERIFIED` |
| `CORE-03` Aislamiento y auditoría | `CORE-02` | autorización tenant, RLS y auditoría — [detalle](#core-03--aislamiento-y-auditoría) | `VERIFIED` |
| `CORE-04` Superadministrador y alta de organizaciones | `CORE-03` | `POST /tenants` y CLI del primer superadministrador — [detalle](#core-04--superadministrador-y-alta-de-organizaciones) | `VERIFIED` |
| `CORE-05` Ingreso con Google | `CORE-02`, `EXH-04` | Ingreso y alta sólo con Google (`POST /auth/google`, usuarios pendientes por email, `AUTH_PASSWORD_ENABLED` apagado por defecto) y alta de feriante con Google en la invitación — [detalle](#core-05--ingreso-con-google) | `VERIFIED` |
| `VEN-01` Predios | `CORE-03` | CRUD de predios fijos/temporales — [detalle](#ven-01--predios) | `VERIFIED` |
| `LUI-01..10` Editor de plano frontend | ninguna (ver change) | editor P06 con repositorio en memoria; fija contrato de geometría para `LAY-01` — [change archivado](changes/archive/2026-10-30-lay-ui-floor-plan-editor/proposal.md) · spec [`layout-editor`](specs/layout-editor/spec.md) | `VERIFIED` |
| `ORG-01..07` Shell del organizador, Panel y Expositores | ninguna (ver change) | navegación, P03 y P11 en consulta con adaptadores en memoria; fija contratos de lectura para `REP-01`/`EXH-01` — [change archivado](changes/archive/2026-10-30-org-ui-shell/proposal.md) · spec [`organizer-shell`](specs/organizer-shell/spec.md) | `VERIFIED` |
| `PUB-UI-01..06` Vistas Feriante y Visitante | ninguna (ver change) | "Ver como", P07 Elegí tu stand y catálogo/mapa público en consulta con adaptador en memoria; fija contrato de lectura para `PUB-01`; reserva y pago como marcadores de `RES-01`/`PAY-01` (desde 2026-11-10 el área Feriante usa la API real y reserva de verdad, ver `PAY-04`; el visitante sigue en demo hasta `PUB-01`) — [change archivado](changes/archive/2026-10-30-pub-ui-catalog/proposal.md) · spec [`public-catalog`](specs/public-catalog/spec.md) | `VERIFIED` |
| `LAY-01` Layouts versionados | `VEN-01`, contrato de `LUI-05` | geometría, publicación e inmutabilidad — [detalle](#lay-01--layouts-versionados) | `VERIFIED` |
| `EVT-01` Eventos, stands y tarifas | `LAY-01` | evento sobre versión publicada, sectores por evento ([ADR 0002](../adr/0002-sectores-por-evento.md)) e inventario valorizado — [detalle](#evt-01--eventos-stands-y-tarifas) | `VERIFIED` |
| `EXH-01` Expositores | `CORE-03` | perfil privado/público y consentimiento — [detalle](#exh-01--expositores) | `VERIFIED` |
| `EXH-02` Rubros | `EXH-01` | tabla de rubros por organización y migración de `exhibitors.category` (texto) a `category_id` — [detalle](#exh-02--rubros) | `VERIFIED` |
| `EXH-03` Documentos del expositor | `EXH-01`, subida de archivos (S3) | `exhibitor_documents` con revisión del organizador; `documentsStatus` se deriva de los documentos — [detalle](#exh-03--documentos-del-expositor) | `VERIFIED` |
| `EXH-04` Invitación y alta de feriantes | `EXH-01` | link de invitación de un solo uso (también compartible por WhatsApp) que pide los datos básicos y crea la cuenta y la membresía `EXHIBITOR`; registro de altas visible para el administrador (pedido 2026-11-05) — [detalle](#exh-04--invitación-y-alta-de-feriantes) | `VERIFIED` |
| `EXH-05` Suscripción del feriante | `EXH-04`, `PAY-01` | suscripción **a la plataforma** (decisión 2026-11-06): el feriante le paga a Juntta en la cuenta de Mercado Pago de la plataforma (`preapproval`, no OAuth del organizador) y queda habilitado a reservar en cualquier organización; estado global por usuario. Riesgo: implicancias fiscales de que la plataforma cobre (validar con asesoría, §1.6/R1). **Hecho:** tabla `platform_subscriptions` (RES-01), cobro con `preapproval` sin plan (`GET/POST/DELETE /me/subscription`) y webhooks `subscription_preapproval` / `subscription_authorized_payment` — [detalle](#exh-05--suscripción-del-feriante-a-la-plataforma). **Hecho (web, 2026-11-10):** pantalla del feriante `/feriante/suscripcion` (estado, alta con el email del pagador, espera del webhook al volver de Mercado Pago y cancelación con confirmación); P18 enlaza ahí ante `SUBSCRIPTION_REQUIRED`. **Pendiente:** prueba con el comprador de prueba en el sandbox | `IN_PROGRESS` |
| `RES-01` Reservas concurrentes | `EVT-01`, `EXH-01`, `EXH-04`, `EXH-05` | holds, locking e idempotencia; sólo reserva un feriante con cuenta activa y confirmada, perfil completo y suscripción paga — [detalle](#res-01--reservas-concurrentes) | `VERIFIED` |
| `PAY-00` Decisiones de integración Mercado Pago | ninguna | ADR: track Checkout Pro, credenciales por organizador y validación de firma — [ADR 0006](../adr/0006-integracion-mercado-pago.md) | `VERIFIED` |
| `PAY-01` Proveedor de pagos y credenciales | `FND-04`, `PAY-00` | puerto `PaymentProvider` (2026-11-10: `getPayments(checkoutId)`, `refund`/`cancel` por order), adaptador SDK `mercadopago` (`Order`), sandbox — [detalle](#pay-01--proveedor-de-pagos-y-credenciales); falta la prueba en sandbox | `IN_PROGRESS` |
| `PAY-02` Preferencia Checkout Pro | `RES-01`, `PAY-01` | payment attempt idempotente y **order** (Orders API, 2026-11-10, [ADR 0007](../adr/0007-checkout-pro-orders-api.md)) desde snapshot de precio, con `payer` del feriante logueado, `expiration_time` = hold e `X-Idempotency-Key` = intento — [detalle](#pay-02--preferencia-checkout-pro); falta la prueba en sandbox: la cuenta de prueba actual responde 403 en `/v1/orders` | `IN_PROGRESS` |
| `PAY-03` Webhooks de pago | `PAY-02` | (2026-11-10, enmienda: `MP_CHECKOUT_API=preferences` por defecto, también se procesa el topic `payment` con `?tenant=`; Orders es opcional porque devuelve 403 con las credenciales de prueba, ver ADR 0007) topic **Order (Mercado Pago)**; el tenant sale del `order id` guardado (función `payment_attempt_tenant`), ya no de `?tenant=`; el topic `payment` no se procesa. Firma, inbox deduplicado, consulta server-to-server y confirmación — [detalle](#pay-03--webhooks-de-pago); falta la prueba con el simulador | `IN_PROGRESS` |
| `PAY-04` Retorno de checkout (P19) | `PAY-02`, `PUB-UI-01..06` | pantallas aprobado/pendiente/rechazado sin confiar en query params | `IN_PROGRESS` |
| `PAY-05` Conciliación y pago tardío | `PAY-03` | (2026-11-10) lee `GET /v1/orders/{id}` del intento, sin búsqueda por `external_reference`. Job de reconciliación, `LATE_PAYMENT_CONFLICT`, P10 — [detalle](#pay-05--conciliación-y-pago-tardío); P10 listo en la web (incidencias en "Reservas y cobros"); falta la prueba en sandbox | `IN_PROGRESS` |
| `PAY-06` Reembolsos, cancelaciones y contracargos | `PAY-05` | (2026-11-10) vía order: `POST /v1/orders/{id}/refund` (total sin body, parcial con `transactions`) y `/cancel` (solo `created`/`action_required`). Refund total/parcial, cancelación de pendientes, chargebacks | `IN_PROGRESS` |
| `PAY-07` Configuración Mercado Pago (P12) | `PAY-01`, `CORE-03` | (2026-11-10) el `collector` se compara con `order.user_id`. Vincular cuenta vendedora del organizador sin secretos en claro | `IN_PROGRESS` |
| `SUB-01` Suscripción SaaS del organizador | `CORE-03`, `PAY-00` | planes (`preapproval_plan`) y suscripciones (`preapproval`); **fuera del MVP** | `PENDING` |
| `PUB-01` Portal público | `EVT-01`, `EXH-01`, `RES-01` | catálogo, mapa, disponibilidad y accesibilidad — [detalle](#pub-01--portal-público) | `IN_PROGRESS` |
| `REP-01` Reportes | `PAY-05` | ocupación, GMV y exportaciones CSV — [detalle](#rep-01--métricas-del-evento) | `IN_PROGRESS` |
| `SEC-01` Límite de tasa de las rutas anónimas | `FND-04` | límite por IP (ventana fija en Redis) en `/public/events*`, `/public/invitations/:token(/accept)`, `GET /auth/providers` y, con un cupo propio y más generoso, `POST /webhooks/mercadopago`; 429 `RATE_LIMITED` (`application/problem+json`, RFC 9457) con `Retry-After` y los campos `RateLimit-Policy`/`RateLimit` del borrador `draft-ietf-httpapi-ratelimit-headers-11`; `TRUST_PROXY` para leer la IP real detrás de Firebase Hosting y Cloud Run — [detalle](#sec-01--límite-de-tasa-de-las-rutas-anónimas); falta medir `TRUST_PROXY` detrás de Firebase Hosting y Cloud Run | `IN_PROGRESS` |
| `LAY-02` Clonar plano | `LAY-01`, `EVT-01` | copiar una versión (cualquier estado) en un plano nuevo; el evento conserva su versión — [detalle](#lay-01--layouts-versionados) | `VERIFIED` |
| `EXH-09` Publicaciones del feriante y compartir | `EXH-03`, `PUB-01`, `RES-01` | fotos y videos de producto por feria donde el feriante tiene stand confirmado (MP4 H.264 o WebM sin conversión, 50 MB, 60 s; cupo de 10 por feriante y evento); el organizador puede ocultarlas; se borran al terminar el evento; compartir en WhatsApp, Facebook e Instagram (menú nativo en celular) con página de vista previa — [detalle](#exh-09--publicaciones-del-feriante-y-compartir) · change [`exh-media-share`](changes/2026-11-16-exh-media-share/proposal.md) | `IN_PROGRESS` |
| `EXH-06` Antivirus de documentos | `EXH-03` | **PENDIENTE.** Escanear cada documento subido (p. ej. ClamAV o el escaneo de un servicio gestionado) antes de que el organizador pueda descargarlo: estado de escaneo en la fila, descarga bloqueada hasta `CLEAN`, objeto infectado en cuarentena y borrado. Hoy sólo se limita tipo y tamaño | `PENDING` |
| `EXH-07` Retención y eliminación de documentos (Ley 25.326) | `EXH-03` | **PENDIENTE.** Los documentos son datos personales (Ley 25.326, Argentina): definir con asesoría jurídica plazos de retención, baja a pedido del titular (acceso, rectificación y supresión), eliminación al cerrar la relación y registro de la base ante la AAIP. Hoy sólo se puede borrar un documento no aprobado | `PENDING` |
| `EXH-08` Logo del expositor | `EXH-01`, `EXH-03` | **PENDIENTE.** Subida de logo (`logo_key`, imagen PNG/JPG/WebP con límite de tamaño) por el mismo mecanismo de URL firmada, mostrado en el directorio y el mapa públicos sólo con `public_contact_opt_in`; el logo sí es público, así que va a un prefijo distinto del de los documentos privados | `PENDING` |

Las tareas originales de Sprint 0 para CI, fundamentos UX y diseño detallado de RLS permanecen pendientes y deberán incorporarse como subtareas verificables antes de declarar completo el Sprint 0 general. Sprint 0A no las reemplaza.

#### Core de plataforma

##### CORE-01 — Base de datos y migraciones

- **Estado:** `VERIFIED`
- **Dependencias:** `FND-06`
- **Entrega:** Drizzle ORM con migraciones versionadas ([ADR 0005](../adr/0005-drizzle-y-sql-explicito-postgis.md)), roles separados (§2.2) y acceso a datos con transacciones por tenant.
- **Aceptación:** la API nunca se conecta con un rol superusuario ni `BYPASSRLS`; las migraciones corren con el rol dueño, que la API no recibe; `withTenant` fija `app.tenant_id` sólo dentro de la transacción; migraciones idempotentes y probadas contra PostgreSQL real.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL/PostGIS y verificación del stack.
  - 2026-10-30: `npm run test:int --workspace api` (en el contenedor `db-migrate`, base `<db>_test` recreada) → 9/9: `juntta_app` con `LOGIN` y sin `SUPERUSER`/`BYPASSRLS`/`CREATEROLE`/`CREATEDB`; `postgis`, `pgcrypto` y `tenants` aplicados; la salida de `db:setup` no incluye credenciales; segunda corrida idempotente (2 migraciones registradas); variable faltante → error que la nombra sin mostrar valores; `juntta_app` lee/escribe pero no ejecuta DDL (`42501`); **no puede saltear RLS** (sin tenant ve 0 filas, con `withTenant` sólo las de su tenant); `app.tenant_id` no se filtra a la siguiente consulta en la misma conexión del pool; `withTenant` rechaza ids que no son UUID antes de tocar la base.
  - 2026-10-30: Compose: `db-migrate` → `role juntta_app created; 2 migrations applied` y termina con 0; la API arranca después y `health/ready` → 200; en `pg_stat_activity` la API conecta como `juntta_app`; dentro del contenedor `api`, `POSTGRES_PASSWORD` y `DATABASE_MIGRATION_URL` vacías y `DATABASE_URL` con `juntta_app`; `juntta_app` puede `INSERT` en `tenants` y no `CREATE` en `public`.
  - 2026-10-30: `npm test --workspace api` 47/47, `test:e2e` 7/7, `tsc --noEmit` y `oxlint` OK, `node --test scripts/init-local-env.test.mjs` 6/6, `docker compose config --quiet` OK.
  - Hallazgo: los contenedores de infraestructura quedaron en estado `created` tras reiniciar Docker Desktop (conflicto de nombres al recrear); `docker compose down` (sin `-v`) y `up -d` lo resolvieron sin perder volúmenes.
- [x] `drizzle-orm@^0.45.4` y `drizzle-kit@^0.31.11`; `apps/api/drizzle.config.ts`, esquema en `src/db/schema.ts`.
- [x] Migración `0000` (SQL manual): `postgis`, `pgcrypto`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC` y privilegios por defecto DML para `juntta_app`; `0001`: `tenants` (slug único con formato, estado `ACTIVE`/`SUSPENDED`, nombre no vacío).
- [x] `npm run db:setup` (`apps/api/scripts/db-setup.mjs`): crea o realinea `juntta_app` (contraseña escapada por el driver) y aplica migraciones; sólo informa rol y cantidad de migraciones.
- [x] `DatabaseModule` global: un pool (`DB_POOL_MAX`), `DatabaseService.withTenant`; readiness usa ese pool.
- [x] Compose: servicio `db-migrate` previo a la API (`service_completed_successfully`); la API usa `juntta_app` y no recibe credenciales del dueño.
- [x] `scripts/init-local-env.mjs`: genera `APP_DB_PASSWORD` y arma `DATABASE_URL` (`juntta_app`) y `DATABASE_MIGRATION_URL` (dueño) para localhost.
- Pendiente para la persona: agregar `DATABASE_MIGRATION_URL` al `.env` (vía `.env.example` + script) para correr `test:int` y `db:setup` desde el host; en Compose no hace falta.

##### CORE-02 — Usuarios, sesiones y membresías

- **Estado:** `VERIFIED`
- **Dependencias:** `CORE-01`
- **Entrega:** módulo `auth` con `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` y `GET /auth/me`, según [ADR 0004](../adr/0004-contrato-de-entorno-y-autenticacion.md); tablas `users`, `memberships` y `refresh_tokens` (migración `0002_auth`).
- **Aceptación:** contraseñas sólo como hash Argon2id; access token JWT HS256 corto (algoritmo fijado, `iss`/`aud`/`typ`); refresh opaco de 256 bits en cookie `HttpOnly`/`Secure`/`SameSite=Strict` con `Path=/api/v1/auth`, nunca en el body, guardado sólo como HMAC-SHA256; rotación con bloqueo de fila y detección de reutilización que revoca la familia; refresh/logout validan `Origin` contra `CORS_ORIGINS`; respuesta única para credencial inválida, usuario inexistente o deshabilitado (con verificación contra hash ficticio para igualar tiempos); límite de login de 5 intentos por email y 20 por IP cada 15 min (Redis, falla cerrado); las membresías listadas excluyen las deshabilitadas y los tenants suspendidos.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real del flujo HTTP completo.
  - 2026-11-02: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 18/18 (9 de `CORE-01` + 9 de `test/auth.int-spec.ts`): login con email normalizado, cookie con flags y path esperados, sin refresh en el body y sólo membresías de tenants activos; 401 idéntico para contraseña errónea, usuario inexistente y deshabilitado; 400 con body inválido; `/auth/me` con Bearer válido, y 401 con `WWW-Authenticate: Bearer` sin token o con token alterado; rotación y reutilización del refresh viejo → 401 y revocación del nuevo; dos refresh concurrentes con el mismo token → exactamente un 200 y un 401; `Origin` ajeno o ausente → 403 sin consumir el token; logout → 204, cookie borrada y refresh posterior 401; 5 fallos → 429 con `Retry-After` aun con la contraseña correcta.
  - 2026-11-02: `npm test --workspace api` 76/76 (incluye `tokens`, `password`, `login-rate-limiter`, `env.schema`), `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
  - Hallazgo: desde el host Windows, `localhost:5432` responde un PostgreSQL nativo (no el del contenedor), así que `test:int` falla con `28P01`; usar la variante en Compose del README.
- [x] Esquema y migración `0002_auth` (email único sin distinguir mayúsculas, checks de estado y rol, FK con `ON DELETE CASCADE`).
- [x] `AuthService`, `AuthController`, `AccessTokenGuard`, `LoginRateLimiter` + `RedisCounterStore`; `@fastify/cookie` registrado en `configureApp`.
- [x] Variables `AUTH_*` validadas en el esquema de entorno (§13.1).
- Fuera de alcance (tareas siguientes): alta de usuarios, invitaciones y gestión de membresías (sin endpoints todavía; los usuarios se crean por SQL); uso de la membresía para autorizar por tenant (`CORE-03`); limpieza periódica de `refresh_tokens` vencidos; reemplazo del selector "Ver como" del frontend por la sesión.

##### CORE-03 — Aislamiento y auditoría

- **Estado:** `VERIFIED`
- **Dependencias:** `CORE-02`
- **Entrega:** módulo global `tenancy` con `@TenantScoped(...roles)` (Bearer + `TenantGuard`), `AuditService.record(tx, entry)` y la tabla `audit_logs` (migración `0003_audit_logs`).
- **Decisión:** el tenant viaja en `X-Tenant-Id` y la membresía se verifica en la base en cada request, de modo que revocar un rol vale al instante (§5). Se descartaron el tenant y el rol dentro del JWT (un rol revocado sigue vigente hasta 15 min) y el tenant en la ruta (obligaba a reescribir §5).
- **Aceptación:** ninguna ruta de tenant responde sin membresía activa en un tenant activo; la respuesta no revela si el tenant existe; los handlers consultan con `withTenant(request.tenant.id, …)`; `audit_logs` tiene RLS habilitado y forzado, toma su `tenant_id` de `app.tenant_id` y es sólo de agregado para `juntta_app`.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-03: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 28/28 (incluye 10 de `test/tenancy.int-spec.ts`). Sin token → 401; sin header o con UUID inválido → 400; tenant ajeno, inexistente o suspendido y membresía deshabilitada → el mismo 404 (`status`/`title`/`detail` idénticos); rol no permitido → 403; el handler recibe `{ id, role }`; la acción permitida queda auditada bajo su tenant. En `audit_logs`: otro tenant y una consulta sin tenant ven 0 filas; insertar sin tenant falla; insertar con el `tenant_id` de otro tenant → `42501` (WITH CHECK); `UPDATE`/`DELETE` → `42501`.
  - 2026-11-03: `npm test --workspace api` 76/76, `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK. El test de idempotencia de CORE-01 ahora toma la cantidad de migraciones del journal.
- [x] `TenantGuard` + `@TenantScoped` y `TenancyModule` global (reexporta `AuthModule` para que cualquier módulo resuelva los guards).
- [x] `audit_logs` según §3.1: RLS `ENABLE` + `FORCE`, política `USING`/`WITH CHECK` por `app.tenant_id` y `REVOKE UPDATE, DELETE, TRUNCATE` a `juntta_app`.
- Patrón para las tablas de tenant siguientes (`VEN-01` en adelante): misma política RLS por `app.tenant_id` con `ENABLE` + `FORCE` en la migración que crea la tabla, más un test de aislamiento.
- Tablas de identidad sin RLS, por diseño: `users`, `memberships` y `refresh_tokens` se leen antes de elegir tenant (login, guard) y sólo las toca el módulo `auth`/`tenancy`; `tenants` también, porque es el ancla. Si en el futuro hiciera falta RLS en `memberships`, la política necesitaría además `app.user_id`.
- Fuera de alcance: endpoints de auditoría (consulta/exportación), superadministrador de plataforma (resuelto en `CORE-04`) y auditoría de login.

##### CORE-04 — Superadministrador y alta de organizaciones

- **Estado:** `VERIFIED`
- **Dependencias:** `CORE-03`
- **Entrega:** columna `users.is_platform_admin` (migración `0014_platform_admin`); `PlatformAdminOnly()` (`AccessTokenGuard` + `PlatformAdminGuard`, sin `X-Tenant-Id`; la bandera se lee de la base en cada request); `POST /api/v1/tenants` y `GET /api/v1/tenants` (módulo `platform`); `GET /auth/me` suma `platformAdmin`; CLI `apps/api/scripts/create-platform-admin.mjs` para el primer superadministrador.
- **Decisión:** `POST /tenants` crea la organización y su membresía `OWNER` en una sola transacción. Si el email ya existe se reutiliza la cuenta **sin tocar su contraseña** (`owner.created=false`); si no, se crea confirmada con Argon2id y la política de contraseña de invitaciones (10 a 256 caracteres). Las tablas `tenants`/`users`/`memberships` no tienen RLS (ver `CORE-03`), así que sólo la auditoría es de tenant: la transacción corre con `withTenant(<id nuevo>)` (el UUID se genera antes del `INSERT`) y `tenant.created` queda en el trail de la organización recién creada, con el superadministrador como `actor_id`. Slug repetido → 409 `TENANT_SLUG_TAKEN`; body inválido → 400. El CLI usa la conexión del dueño (`DATABASE_MIGRATION_URL`), es idempotente (si la cuenta existe sólo la promueve y no cambia su contraseña), se niega a correr con `NODE_ENV=production` sin `--allow-production` y nunca imprime la contraseña.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-10: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 184/184 en dos corridas consecutivas (13 de `test/tenants.int-spec.ts`): el superadministrador crea una organización con dueño nuevo que inicia sesión y accede a rutas del tenant como `OWNER`; `tenant.created` auditado en la organización nueva; email existente reutilizado con su contraseña intacta; slug duplicado → 409 `TENANT_SLUG_TAKEN` sin crear la cuenta; usuario común → 403; sin credenciales → 401; 5 bodies inválidos → 400; `/auth/me` expone `platformAdmin`; listado para superadministradores. `npx vitest run` 124/124, `test:e2e` 7/7, `tsc --noEmit` OK.
- [x] Migración `0014_platform_admin`, guard, controlador, servicio, validación zod y CLI de arranque.
- Fuera de alcance: UI de superadministrador, suspensión/baja de organizaciones, planes (`SUB-01`) y revocación de la bandera por API (hoy sólo por SQL).

#### Dominio

##### CORE-05 — Ingreso con Google

- **Estado:** `VERIFIED`
- **Dependencias:** `CORE-02`, `EXH-04`
- **Entrega (2026-11-10):** `POST /auth/google { credential }`, `GET /auth/providers`, `POST /public/invitations/:token/accept` con `{ googleCredential }`, migración `0017_google_sign_in` (`users.google_sub` único y nullable, `users.password_hash` nullable, `CHECK` de que toda cuenta tiene contraseña o `google_sub`), `GOOGLE_CLIENT_ID` opcional, y en la web el botón de Google en `/ingresar`, la página `/invitacion/:token` (nueva: el link de `EXH-04` no tenía pantalla) con "Continuar con Google". Decisión y consecuencias en el [ADR 0008](../adr/0008-google-sign-in.md).
- **Aceptación:** el ID token se verifica en la API con `jose` (firma RS256 contra el JWKS de Google cacheado por `Cache-Control`, `aud`, `iss`, `exp`/`iat` con 60 s de tolerancia, `email_verified === true`); se emite la misma sesión que el login con contraseña y pasa por el mismo limitador. Sólo cuentas existentes: se busca por `google_sub` y si no, por email verificado (sin distinguir mayúsculas), y se vincula el `sub` en el primer éxito; otro `sub` → 401 `GOOGLE_ACCOUNT_MISMATCH`; sin cuenta → 403 `GOOGLE_ACCOUNT_NOT_REGISTERED` (nunca se crea un usuario); cuenta deshabilitada → como un login fallido. El alta de feriante con Google exige el email invitado (422 `INVITATION_EMAIL_MISMATCH`) y crea el usuario confirmado, con `google_sub` y sin contraseña; una cuenta sin contraseña no entra por `/auth/login`. Sin `GOOGLE_CLIENT_ID` → 503 `GOOGLE_SIGN_IN_UNAVAILABLE` y la web oculta el botón.
- **Evidencia requerida:**
  - 2026-11-10: `npx vitest run` (apps/api) 191/191, con `google-id-token.verifier.spec.ts` (claves RSA generadas y JWKS simulado: firma ajena, payload alterado, `aud` e `iss` incorrectos, vencido y tolerancia, `iat` futuro, email no verificado, sin email, `alg: none`, `kid` desconocido, claves inaccesibles, caché por `max-age`, refresco por `kid` con enfriamiento y un solo request concurrente), `hitIp` del limitador, `GOOGLE_CLIENT_ID` en el esquema de entorno y el `code` de un 503 en el filtro de errores.
  - 2026-11-10: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 231/231 dos veces seguidas (19 de `test/google-sign-in.int-spec.ts`: `sub` vinculado, vinculación por email sin distinguir mayúsculas, `sub` ajeno → 401, sin cuenta → 403 sin crear usuarios, deshabilitada, credenciales inválidas, cuenta sólo-Google que no entra con contraseña, limitador por email y por IP con `Retry-After`, 503 sin configuración y con claves caídas, `/auth/providers`, alta con Google con email distinto → 422 y la invitación sigue vigente, sin email invitado, credencial inválida, cuerpo mezclado → 400, email ya registrado → 409). Corrido en una base aparte (`DATABASE_MIGRATION_URL` apuntando a otra base) porque otra sesión usaba la `_test` compartida.
  - 2026-11-10: `npm run test:e2e` (apps/api) 7/7; `npx ng test --watch=false` (apps/web) 373/373 con las specs de `LoginPage` (botón oculto sin client id, etiquetado, redirección `volver`, mensajes por código) e `InvitationPage` (con contraseña y con Google); `npx playwright test` 29/29 (6 nuevos en `e2e/google-sign-in.e2e.ts`, con `/auth/providers` simulado, GIS simulado que llama al callback y axe sin violaciones serias); `tsc` de API y de web (app y spec) y `oxlint` sin errores.
- **Enmienda (2026-11-10, decisión del producto: alta e ingreso sólo con Google):**
  - `AUTH_PASSWORD_ENABLED` (por defecto `false`). Apagado: `POST /auth/login`, el alta de feriante con `password` y `owner.password` de `POST /tenants` → 403 `PASSWORD_SIGN_IN_DISABLED`; refresh, logout y Google no cambian. Encendido: comportamiento previo. `GET /auth/providers` suma `password`.
  - Migración `0018_pending_users`: se elimina el `CHECK` de credencial; un usuario sólo con email ("pendiente") se vincula a Google en su primer ingreso por email verificado (`email_verified === true`).
  - Scripts: `create-platform-admin.mjs --email <cuenta de Google>` (sin contraseña) y `bootstrap-sandbox.mjs --organizer/--exhibitor <emails de Google>`; `sandbox-checkout.mjs` firma el access token en lugar de iniciar sesión.
  - Web: `/ingresar` e `/invitacion/:token` sólo tienen el botón de Google; se eliminó `SessionStore.login` y los formularios de contraseña.
  - Evidencia (2026-11-10): `npx vitest run` (apps/api) 192/192; `test:int` 239/239 (nuevos: usuario pendiente vinculado por email, email no verificado → 401, login / alta con contraseña / owner con contraseña → 403 con el flag apagado, Google sigue funcionando, `/auth/providers` con `password`); `test:e2e` (api) 7/7; `ng test` (web) 365/365; `playwright test` 28/28; `tsc` (api, web app y spec) y `oxlint` sin errores.
- Fuera de alcance: crear cuentas desde un ingreso con Google, desvincular Google desde el perfil, "olvidé mi contraseña" y una prueba con una cuenta real de Google (las pruebas usan un JWKS generado localmente).

##### VEN-01 — Predios

- **Estado:** `VERIFIED`
- **Dependencias:** `CORE-03`
- **Entrega:** `VenuesModule` con `GET/POST /venues` y `GET/PATCH/DELETE /venues/:id` (§5); tabla `venues` (migración `0004_venues`) según §3.1.
- **Aceptación:** sólo miembros OWNER/ADMIN/OPERATOR leen y editan, y sólo OWNER/ADMIN eliminan; el tenant sale de la sesión (un `tenantId` en el body → 400); tipo `FIXED`/`TEMPORARY`, nombre no vacío y único por tenant sin distinguir mayúsculas ni espacios (índice único → 409, sin carrera de chequear y después insertar), zona horaria IANA válida y medidas en metros > 0 con 2 decimales; un predio de otro tenant, un id inexistente o mal formado → 404; altas, ediciones y bajas auditadas en la misma transacción, con estado anterior y nuevo; RLS `ENABLE` + `FORCE` por `app.tenant_id`.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-03: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 44/44 (16 de `test/venues.int-spec.ts`): alta 201 auditada; 400 por tipo desconocido, nombre vacío, ancho 0, alto negativo, 3 decimales, zona horaria inexistente y campo extra; nombre duplicado → 409 en el mismo tenant y 201 en otro; listado sólo del tenant y ordenado; 404 para el predio de otro tenant (GET y PATCH), un id inexistente y uno mal formado; PATCH parcial con `before`/`after` auditados; PATCH vacío o inválido → 400; EXHIBITOR → 403 al leer y OPERATOR → 403 al eliminar; baja de OWNER 204 auditada; fuera de un tenant, `venues` devuelve 0 filas.
  - 2026-11-03: `npm test --workspace api` 76/76, `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
- [x] `tenantId()` en el schema: el `tenant_id` de las tablas de tenant toma por defecto el `app.tenant_id` de la transacción, así que el cliente nunca lo provee (lo usan `audit_logs` y `venues`).
- [x] `UNIQUE (tenant_id, id)` en `venues`, como destino de las FK compuestas de layouts y eventos (INV-02).
- Web: `/organizador/predios` (listado, alta, edición y baja con confirmación en la página; la baja sólo para OWNER/ADMIN, como la API; 409 si el predio está en uso).
- Fuera de alcance: ubicación geográfica (§3.1 no la define; EP02 menciona "ubicación", alcanza con `address`), paginación del listado. La baja de un predio en uso responde 409 desde `LAY-01` (FK `RESTRICT`).

##### LAY-01 — Layouts versionados

- **Estado:** `VERIFIED`
- **Dependencias:** `VEN-01`, contrato de `LUI-05` ([D2/D4/D6](changes/archive/2026-10-30-lay-ui-floor-plan-editor/design.md))
- **Entrega:** `LayoutsModule` con las rutas de §5; tablas `layout_templates`, `layout_versions` y `layout_objects` (migración `0005_layouts`), con `geometry(Polygon,0)` en metros e índice GiST.
- **Decisiones:**
  - El borrador se guarda completo (`PUT /layout-versions/:id/objects`) en lugar de objeto por objeto, porque así lo hace el puerto `saveDraft` del editor. Las reglas de INV-04 se validan recién al publicar, así que un borrador a medio hacer se puede guardar.
  - El id del objeto lo genera el editor (UUID) y la clave es `(layout_version_id, id)`: al clonar, un stand conserva su id entre versiones, lo que sirve para migrar reservas (INV-06).
  - Publicar archiva la versión publicada anterior de la misma plantilla. Cada plantilla tiene como máximo un borrador y una publicada (índices únicos parciales).
  - La validación de publicación devuelve los códigos del editor más `INVALID_GEOMETRY` (polígonos autointersectados o degenerados, que el editor de rectángulos no dibuja pero un cliente de la API sí puede mandar). El problem+json suma la extensión `issues` (`code`, `objectIds`, `message`).
- **Aceptación:** INV-04 con PostGIS (`ST_IsValid`, `ST_CoveredBy`, solapamiento de stands > 0.0001 m² según §3.4, stands sobre pasillos/accesos, códigos faltantes o repetidos, sin stands); INV-06 en la base: triggers impiden modificar objetos de una versión no borrador y cualquier cambio a una publicada salvo pasar a `ARCHIVED`; plantilla, versión y objeto con FK compuestas por tenant (INV-02) y RLS `ENABLE` + `FORCE`; predio de otro tenant → 404.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL/PostGIS real.
  - 2026-11-03: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 61/61 (17 de `test/layouts.int-spec.ts`): plantilla con versión 1 en borrador del tamaño del predio; predio ajeno → 404 y plantilla sin predio ni medidas → 400; listado por tenant con versiones; borradores con anillo abierto, tipo desconocido, coordenada no numérica, id mal formado o ids repetidos → 400; un borrador inválido se guarda y al publicar → 422 con `STAND_OVERLAP`, `OUT_OF_BOUNDS`, `CODE_MISSING`, `CODE_DUPLICATE`, `STAND_ON_RESERVED` e `INVALID_GEOMETRY` sobre los objetos exactos; `NO_STANDS`; la geometría vuelve idéntica, compartir un borde es válido y OPERATOR → 403 al publicar; versión publicada → 409 al guardar o republicar, y `UPDATE` directo en la base rechazado por los triggers; el clon es versión 2 con los mismos ids y un segundo borrador → 409; publicar la v2 archiva la v1; versión o plantilla de otro tenant → 404; borrar un predio en uso → 409; fuera de un tenant, las tres tablas devuelven 0 filas.
  - 2026-11-03: `npm test --workspace api` 78/78 (incluye `issues` en problem+json sólo para 4xx), `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
- Web: `/organizador/plano` lista los planos con el estado de cada versión (borrador, publicada, archivada) y permite "Nuevo plano" (elegir predio, crear la plantilla y abrir su borrador en el editor).
- **Clonar plano (2026-11-11, `LAY-02`):** decisión de producto: un evento conserva la versión de plano con la que se creó (no se cambia); para usar un plano modificado se crea un evento nuevo. Por eso un plano se puede clonar por sí solo: `POST /layout-templates/:id/clone` `{name, sourceVersionId, venueId?}` (OWNER, ADMIN y OPERATOR) copia una versión de cualquier estado (borrador, publicada o archivada) en una plantilla NUEVA cuya primera versión es un borrador con los objetos copiados (ids nuevos; misma geometría, códigos, tipo y metadatos; mismo tamaño que la versión origen). El predio por defecto es el de la plantilla origen; puede ser otro predio del mismo tenant. 404 si la plantilla, la versión o el predio no son del tenant, 409 si el nombre ya existe, 400 por cuerpo inválido. El origen no se modifica. Auditado como `layout_template.cloned`. Web: en `/organizador/plano`, cada versión tiene "Clonar versión N" con un formulario (nombre, predio) que abre el borrador nuevo en el editor; `/organizador/eventos` ofrece, para el predio elegido, la versión publicada de cada plano (hay a lo sumo una publicada por plantilla: índice único parcial) y el detalle del evento muestra "Plano del evento: <plano> · versión N" con la nota "Para usar otro plano, creá un evento nuevo".
- Fuera de alcance: borrar plantillas o borradores, editar las medidas de un borrador, polígonos con huecos y objetos sobre `UTILITY`/`OBSTACLE` (el editor tampoco los valida).

##### EVT-01 — Eventos, stands y tarifas

- **Estado:** `VERIFIED`
- **Dependencias:** `LAY-01`
- **Entrega:** `EventsModule` con las rutas de §5; tablas `events`, `event_sectors` y `event_stands` (migración `0006_events`).
- **Decisiones:**
  - Al crear el evento se genera un `event_stand` por cada `STAND` de la versión publicada, con el código del plano, estado `AVAILABLE` y **sin precio**.
  - `price_cents` es nullable (el DDL ilustrativo de §3.3 lo tenía `NOT NULL`): `NULL` significa "sin tarifa" y lo distingue de un stand gratis. La API nunca devuelve `null`: muestra `priceCents: 0` con `hasPrice: false` (decisión 2026-11-04). Publicar exige precio en todo stand que no esté `DISABLED` (§4.1), y si falta responde 422 con `STAND_WITHOUT_PRICE` / `NO_SELLABLE_STANDS`.
  - El slug es único global porque el portal público usa `/public/events/:slug`. Si no viene, se genera desde el nombre sin acentos.
  - Las fechas son ISO 8601 con offset obligatorio. Reglas: inicio < fin, apertura de venta < cierre, y cierre ≤ fin del evento (también como `CHECK`).
  - Un evento publicado no cambia sus datos, pero el precio de los stands sí, porque cada reserva congela el suyo (INV-05). `ASSIGNED` no lo fija el organizador (lo hará `RES-01`), y el estado de un stand asignado no se puede cambiar.
- **Aceptación:** INV-03 con FK compuestas (stand → evento + versión, stand → objeto de esa versión) y un trigger que exige versión `PUBLISHED` al crear e impide cambiar plano o predio; INV-09 con la FK `(tenant_id, event_id, sector_id)` y `ON DELETE SET NULL (sector_id)`; sectores únicos por evento sin distinguir mayúsculas; RLS `ENABLE` + `FORCE` en las tres tablas; altas, ediciones, publicación e inventario auditados.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-03: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 76/76 (15 de `test/events.int-spec.ts`): alta en borrador con slug generado, fechas normalizadas y stands A1–A3 disponibles, sin precio y con el `layoutObjectId` del plano; plano en borrador → 409, predio de otro tenant → 404, fechas incoherentes o sin offset → 400; slug repetido → 409; listado y lectura sólo del tenant; sectores con nombre único (409) y orden por `sortOrder`; precio y sector en bloque; 400 con stands ajenos, sector de otro evento, precio negativo o con decimales, estado `ASSIGNED`, sin cambios o lista vacía; OPERATOR → 403 al publicar; publicar con un stand sin precio → 422 con ese stand; deshabilitarlo y publicar → 200; evento publicado → 409 al editar o republicar, pero el precio sigue editable; edición de borrador con fechas validadas contra las guardadas; borrar un sector deja sus stands sin sector; en la base, un evento sobre un plano en borrador es rechazado y un sector de otro evento → `23503`; alta y publicación auditadas; fuera de un tenant, las tres tablas devuelven 0 filas.
  - 2026-11-03: `npm test --workspace api` 86/86 (incluye `slugify` y `datesProblem`), `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
- Fuera de alcance: métricas (`/events/:id/metrics`, `REP-01`), transiciones `ACTIVE`/`CLOSED`/`CANCELLED` (dependen de las reservas, `RES-01`), reglas de tarifa por m² o por sector (§4.4, posteriores al MVP), "copiar sectores de otro evento". Web: `/organizador/eventos` (listado, alta con predio y plano publicado, fechas en horario de Argentina) y `/organizador/eventos/:id` con pestañas Datos (edición sólo en borrador), Sectores (CRUD) y Stands y precios (precio en ARS, sector y estado por fila; el guardado agrupa los cambios iguales en un `PATCH /events/:id/stands`); "Publicar" sólo para OWNER/ADMIN y muestra los `issues` del 422. La moneda no se elige: la API no la recibe.

##### EXH-01 — Expositores

- **Estado:** `VERIFIED`
- **Dependencias:** `CORE-03`
- **Entrega:** `ExhibitorsModule` con las rutas de §5; tabla `exhibitors` (migración `0007_exhibitors`).
- **Decisiones (2026-11-05):**
  - El perfil lo crea y edita **el propio feriante** (membresía `EXHIBITOR`), uno por usuario y organización (`UNIQUE (tenant_id, user_id)`). El organizador sólo lo lee. Así el consentimiento lo da el titular de los datos (Ley 25.326) y `RES-01` sabe para qué expositor reserva cada usuario.
  - `public_contact_opt_in` es el consentimiento para aparecer en el directorio público (AC-11, AC-PRD-03). `public_consent_at` guarda cuándo se dio, conserva esa fecha mientras siga vigente y se borra al retirarlo; un `CHECK` exige que los dos campos sean coherentes.
  - El rubro era texto (`category`) porque no había tabla de rubros; `EXH-02` lo migró a `category_id` (ver su detalle).
  - El CUIT es opcional, se valida con el dígito verificador de AFIP (mod 11) y se guarda con sus 11 dígitos.
  - `documentsStatus` respondía `MISSING` hasta que existieran documentos; desde `EXH-03` se deriva de ellos.
- **Aceptación:** el dueño y la organización salen de la sesión (un `userId` en el body → 400); sólo `EXHIBITOR` usa `/me/exhibitor-profile` y sólo OWNER/ADMIN/OPERATOR listan expositores; el expositor de otra organización → 404; RLS `ENABLE` + `FORCE`; altas y cambios auditados con estado anterior y nuevo; `UNIQUE (tenant_id, id)` como destino de la FK de reservas (INV-02).
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-05: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 91/91 (15 de `test/exhibitors.int-spec.ts`): sin perfil → 404; el primer `PUT` → 201 con CUIT normalizado y el siguiente → 200; dar consentimiento registra la fecha, que se conserva en ediciones posteriores y se borra al retirarlo; 400 por CUIT con dígito verificador inválido, nombre comercial vacío, rubro faltante, `userId` en el body y consentimiento no booleano; perfil sin CUIT aceptado; el mismo usuario empieza sin perfil en otra organización; OWNER → 403 en `/me/exhibitor-profile` y EXHIBITOR → 403 en `/exhibitors`; el organizador ve CUIT, razón social, rubro y `documentsStatus: MISSING`; expositores de otra organización → lista vacía o 404; alta y tres ediciones auditadas; fuera de un tenant, 0 filas.
  - 2026-11-05: `npm test --workspace api` 95/95 (incluye `normalizeCuit`), `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
- Fuera de alcance: registro e invitación de feriantes (resuelto en `EXH-04`), logo (`logo_key`, con subida de archivos), documentos y su revisión (resuelto en `EXH-03`), tabla de rubros (resuelto en `EXH-02`), búsqueda y filtros del lado del servidor (D4 los hace en el cliente) y directorio público (`PUB-01`).

##### EXH-02 — Rubros

- **Estado:** `VERIFIED`
- **Dependencias:** `EXH-01`
- **Entrega:** migración `0020_exhibitor_categories_documents` (junto con `EXH-03`); `CategoriesService`/`CategoriesController` en `ExhibitorsModule`.
- **Decisiones (2026-11-11):**
  - Tabla `exhibitor_categories(id, tenant_id, name, created_at)`, RLS `ENABLE` + `FORCE`, nombre único por organización sin distinguir mayúsculas ni espacios (`UNIQUE (tenant_id, lower(btrim(name)))`). `exhibitors.category_id` es una FK compuesta `(tenant_id, category_id)` con `ON DELETE RESTRICT`: un rubro de otra organización no se puede enlazar y uno en uso no se borra.
  - La migración crea un rubro por organización y nombre (deduplicado sin distinguir mayúsculas) con los textos existentes, enlaza cada expositor y **elimina** la columna `category`: todos los lectores (ficha del organizador, mapa y expositores del portal público) hacen join al nombre. La migración aborta si algún expositor queda sin enlazar. `category_id` queda nullable; sin rubro, el portal público muestra "Sin rubro".
  - `PUT /me/exhibitor-profile` recibe `categoryId` (UUID de un rubro de la organización; si no existe → 400) en lugar de `category`. La API responde `categoryId` y `category` (nombre).
- **Endpoints:** `GET /exhibitor-categories` (owner/admin/operator y expositor), `POST`, `PATCH /:id` (nombre repetido → 409 `CATEGORY_EXISTS`) y `DELETE /:id` (en uso → 409 `CATEGORY_IN_USE`) para owner/admin/operator. Cada rubro informa `exhibitorCount`. Altas, cambios y bajas auditados.
- **Web:** sección "Rubros" en Expositores (agregar, renombrar, eliminar con confirmación en la página); el filtro por rubro usa los rubros reales; nueva pantalla `/feriante/perfil` ("Mi perfil", no existía en la web) con un select de rubros.
- **Evidencia:**
  - 2026-11-11: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 306/306 (`test/categories.int-spec.ts`: CRUD, nombre repetido, 409 en uso, rubros de otra organización 404, el expositor lee pero no modifica 403, RLS, auditoría y el paso de datos de la migración 0020 sobre un esquema de prueba con el formato anterior; `test/exhibitors.int-spec.ts` actualizado: `categoryId` desconocido o de otra organización → 400).
  - 2026-11-11: web `ng test` 642/642 (`categories-panel`, `exhibitor-profile.page`, filtro por rubro real); `e2e/exhibitor-documents.e2e.ts` (alta, repetido, renombrar y rubro en uso).

##### EXH-03 — Documentos del expositor

- **Estado:** `VERIFIED`
- **Dependencias:** `EXH-01`, S3 (`StorageModule`)
- **Entrega:** tabla `exhibitor_documents` (misma migración 0020); puerto `ObjectStorage` (`OBJECT_STORAGE`) con adaptador S3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`).
- **Decisiones (2026-11-11):**
  - La especificación no fija tipos de documento: se usa la lista corta `CONSTANCIA_AFIP`, `SEGURO`, `HABILITACION`, `OTRO` (`CHECK` en la tabla).
  - Subida directa del navegador al bucket: `POST /exhibitors/me/documents` valida tipo (`application/pdf`, `image/jpeg`, `image/png`) y tamaño (1 byte a 10 MiB) y devuelve una URL `PUT` firmada, de 5 minutos, con `Content-Type` y `Content-Length` dentro de la firma. La clave la elige el servidor: `tenants/<tenant>/exhibitors/<expositor>/documents/<uuid>` (ids validados como UUID). La URL se firma con `S3_PUBLIC_ENDPOINT`.
  - `POST /exhibitors/me/documents/:id/complete` hace `HEAD` del objeto: si falta → 409 `UPLOAD_MISSING`; si el tipo o el tamaño no coinciden → se borra el objeto y la fila y responde 422 `UPLOAD_REJECTED`. Recién confirmado, el documento se lista, cuenta y puede revisarse (`uploaded_at`); es idempotente.
  - Descarga: `GET /exhibitors/me/documents/:id/download` (dueño) y `GET /exhibitors/:id/documents/:docId/download` (owner/admin/operator) devuelven una URL `GET` firmada de 60 segundos con `Content-Disposition: attachment`. Otro expositor, otra organización o un id mal formado → 404; la API nunca devuelve la clave ni recibe una URL.
  - Revisión: `GET /exhibitors/:id/documents` y `POST /exhibitors/:id/documents/:docId/review` `{decision: APPROVED|REJECTED, reason}` (el motivo es obligatorio al rechazar). `documentsStatus` = `MISSING` sin documentos confirmados; si no, `REJECTED` si hay alguno rechazado, `PENDING` si hay alguno pendiente y `APPROVED` si están todos aprobados.
  - El expositor puede eliminar un documento que no esté aprobado (`DELETE /exhibitors/me/documents/:id`, 409 `DOCUMENT_APPROVED` si lo está) para reemplazarlo. Subida confirmada y revisión quedan auditadas (`exhibitor_document.uploaded|approved|rejected|deleted`).
- **Web:** `/feriante/documentos` ("Mis documentos"): validación de tipo y tamaño en el navegador, barra de progreso, estado con ícono y texto, motivo del rechazo, descarga y eliminación con confirmación; el panel del expositor en Expositores lista los documentos con descarga, aprobar y rechazar (motivo obligatorio) con confirmación en la página. El `PUT` va con `HttpClient` a una URL fuera de la API, así que el interceptor no agrega token ni organización.
- **Evidencia:**
  - 2026-11-11: `test:int` 306/306 (`test/documents.int-spec.ts`, con un `ObjectStorage` en memoria: tipo y tamaño rechazados al firmar, clave del servidor, confirmación, objeto grande o de otro tipo → 422 y borrado, descarga del dueño y del organizador, otro expositor 404, rutas de organizador 403 para el expositor, otra organización 404, revisión con y sin motivo, `documentsStatus` derivado, borrado, auditoría y RLS); `npm test --workspace api` 221/221 (`document-policy`, `S3ObjectStorage`: firma sobre el endpoint público y `Content-Disposition`), `test:e2e` 7/7, `tsc --noEmit` y `oxlint` OK.
  - 2026-11-11: web `ng test` 642/642, `playwright test` 62/62 dos veces (incluye `exhibitor-documents.e2e.ts` con el `PUT` firmado simulado y las dos páginas nuevas en las cinco paletas).
  - 2026-11-11: prueba real contra LocalStack con un token firmado como `sandbox-checkout.mjs`: firma, `PUT` (200), `complete` (PENDING), descarga con el mismo contenido y `attachment`, aprobación (APPROVED) y preflight CORS desde `http://localhost:4200` (tras aplicar el CORS al bucket existente).
- **Limpieza de subidas sin confirmar (2026-11-11):** `ExhibitorDocumentsSweeper` (`exhibitors/document-sweeper.service.ts`) borra cada 10 min las filas con `uploaded_at IS NULL` y más de `DOCUMENT_UPLOAD_TTL_MINUTES` (60 por defecto; mínimo 10, porque la URL firmada dura 5 min) y su objeto (`remove` es idempotente: un objeto que falta no es error). Como `ReconciliationService`: `setInterval` en `onApplicationBootstrap`, apagado con `NODE_ENV=test`, recorre `tenants` (sin RLS) y barre cada tenant bajo su RLS; es seguro con varias instancias porque toma las filas con `FOR UPDATE SKIP LOCKED` (una fila que un `complete` está confirmando queda saltada). El objeto se borra dentro de la transacción: si el storage falla la fila queda y se reintenta; si falla el commit, la fila queda apuntando a un objeto inexistente y la próxima pasada lo borra de nuevo. Cada borrado se audita (`exhibitor_document.upload_expired`, sin la clave del objeto) y los logs llevan sólo conteos e ids. Sin migración nueva. La fuente de verdad es la app, no el bucket: una regla de ciclo de vida no distingue un objeto confirmado de uno sin confirmar (todos viven bajo `tenants/<tenant>/exhibitors/<id>/documents/<uuid>`). Subir a un prefijo `pending/` y renombrar al confirmar exigiría copiar y borrar en `complete` (una operación más que puede fallar a medias), así que no se hizo; como red de seguridad ante filas perdidas se puede sumar una regla del bucket que borre objetos viejos (ver README).
- **Pendiente (2026-11-11), ver `EXH-06`, `EXH-07` y `EXH-08`:** antivirus de los documentos subidos, retención y eliminación según la Ley 25.326, logo del expositor (`logo_key`) y vencimiento de documentos.

##### EXH-09 — Publicaciones del feriante y compartir

- **Estado:** `IN_PROGRESS`
- **Change:** [`exh-media-share`](changes/2026-11-16-exh-media-share/proposal.md) (propuesta, diseño, tareas y spec de la capacidad `exhibitor-media`).
- **Entrega (2026-11-16 a 2026-11-20):**
  - migración `0022` (publicaciones: `kind`, `event_id`, `caption`, `duration_s`, estado `HIDDEN`) y `0023` (`public_media_share`, lectura pública de una publicación);
  - reglas compartidas de subida (`photo-policy`, formatos sin conversión, límites y cupo por evento);
  - API del feriante (subir, confirmar, editar texto, borrar) y publicaciones en el mapa público con URLs firmadas de una hora;
  - página de compartir `GET /api/v1/public/share/:id` con metadatos Open Graph y redirección a la feria;
  - web: sección "Publicaciones" en el perfil del feriante; galería con videos y botón "Compartir" en el modal del stand; `?publicacion=` abre la publicación compartida;
  - e2e y axe en los 6 temas.
- **Pendiente:**
  - organizador: ocultar y mostrar publicaciones (`MED-11`) y borrado al terminar el evento (`MED-12`);
  - prueba de integración de los endpoints de la API (bloqueada por la conexión desde el host, `28P01`);
  - menú nativo de compartir en un celular real, y video válido de punta a punta en el e2e;
  - decisiones legales: texto de la declaración de derechos de imagen y plazo de retención (revisión de abogado).
- **Decisiones:** formatos sin conversión (el navegador prueba la decodificación; el servidor confía en el tipo MIME); las publicaciones pertenecen a una feria; la vista previa de WhatsApp y Facebook depende de metadatos en el servidor, porque sus rastreadores no ejecutan JavaScript.

##### EXH-04 — Invitación y alta de feriantes

- **Estado:** `VERIFIED`
- **Dependencias:** `EXH-01`
- **Entrega:** tabla `exhibitor_invitations` (migración `0008_invitations`), columnas `users.full_name`, `users.phone` y `users.confirmed_at`, y estas rutas:
  - Organizador (OWNER/ADMIN/OPERATOR): `POST/GET /exhibitor-invitations` y `DELETE /exhibitor-invitations/:id` (revocar).
  - Público (quien tiene el link, sin sesión): `GET /public/invitations/:token` y `POST /public/invitations/:token/accept`.
  - Administradores (OWNER/ADMIN): `GET /audit-logs?entityType=exhibitor_invitation`, el registro de altas.
- **Decisiones (2026-11-06):**
  - Link de un solo uso `<web>/invitacion/<token>`, con un token aleatorio de 256 bits del que se guarda sólo el SHA-256. El link y el `whatsappUrl` (`https://wa.me/<teléfono>?text=…`, o sin número para elegir el contacto) se devuelven **sólo al crear**. Vence a los 7 días (1–30 configurable) y se puede revocar.
  - El alta pide nombre, email, contraseña (≥ 10) y teléfono opcional. Si la invitación se mandó a un email, la cuenta tiene que usar ese email. Crea el usuario **confirmado** (`confirmed_at`: tener el link prueba que la invitación llegó a esa persona) y la membresía `EXHIBITOR`, y consume la invitación, todo en una transacción. Si el email ya tiene cuenta → 409.
  - El link no lleva tenant: la única lectura entre tenants es la función `exhibitor_invitation_lookup(hash)` (`SECURITY DEFINER`), que devuelve sólo `(id, tenant_id)` de una invitación vigente; el resto corre en `withTenant` con RLS. Por eso esta tabla tiene RLS `ENABLE` sin `FORCE`, y para `juntta_app` sigue aplicando.
  - La URL base del front se toma del primer origen de `CORS_ORIGINS`; si alguna vez difieren, se agrega una variable `APP_PUBLIC_URL`.
  - El registro de altas es el `audit_logs` de la organización: `invitation.created`, `invitation.accepted` (con el email de la cuenta nueva) e `invitation.revoked`, con autor y fecha.
- **Web del organizador (2026-11-11):** sección "Invitaciones" en `/organizador/expositores` (`features/exhibitors/ui/invitations-panel.ts`, adaptador HTTP y en memoria): crear con nombre, email opcional (aclara que sólo esa cuenta de Google puede aceptar), teléfono y vencimiento; el link se muestra **una vez** con "Copiar link" (con respaldo de seleccionar el texto), "Compartir por WhatsApp" (`whatsappUrl` de la API) y aviso de que no se vuelve a mostrar; listado con estado (pendiente, usada, vencida, revocada), email y fechas; "Revocar" sólo en pendientes, con confirmación en la página. La API permite crear, listar y revocar a OWNER/ADMIN/OPERATOR, los mismos que ven la pantalla. E2E con API simulada y axe (la pantalla está en `e2e/themes.e2e.ts`, 5 temas). Falta una prueba manual del flujo completo (invitar, abrir el link y aceptar con Google) contra la API real.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-06: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 107/107 (16 de `test/invitations.int-spec.ts`): link de 43 caracteres bajo el origen del front y `wa.me` con el teléfono normalizado y el nombre de la organización; vence en 7 días; 400 por teléfono, email o validez inválidos; el listado no expone link ni hash y no ve otra organización; el link muestra la organización y un token desconocido → 404; 400 por contraseña corta, nombre vacío, email distinto del invitado o campo extra; el alta crea la cuenta confirmada con nombre y teléfono, que puede iniciar sesión con membresía `EXHIBITOR`; el link no se puede reusar (404) y la invitación queda `ACCEPTED`; un email con cuenta → 409; `wa.me` también sin teléfono; revocar → 204, después el link da 404 y revocar de nuevo o revocar una aceptada → 409; una vencida da 404 y figura `EXPIRED`; el OWNER ve el registro con alta, aceptación (y el email) y revocación, OPERATOR → 403 y otra organización ve una lista vacía; fuera de un tenant, 0 filas.
  - 2026-11-06: `npm test --workspace api` 95/95, `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
- Fuera de alcance: envío del link por email o por la API de WhatsApp Business (hoy el organizador lo comparte él mismo), verificación de email por correo, invitar a una persona que ya tiene cuenta (debería aceptar con sesión iniciada), límite de intentos sobre los endpoints públicos (el token de 256 bits no se puede adivinar) y la pantalla del front.

##### RES-01 — Reservas concurrentes

- **Estado:** `VERIFIED`
- **Dependencias:** `EVT-01`, `EXH-01`, `EXH-04`, base de `EXH-05`
- **Entrega:** `ReservationsModule` con las rutas de §5 (`POST/GET /reservations`, `GET /reservations/:id`, `POST /reservations/:id/cancel`); tablas `reservations` y `platform_subscriptions` (migración `0009_reservations`). El problem+json suma `code` (§5).
- **Reglas, en orden (§6):**
  1. **Idempotencia:** `Idempotency-Key` UUID obligatorio, único por (organización, usuario). Si se repite con el mismo stand devuelve la reserva original (200); con otro stand → 422 `IDEMPOTENCY_KEY_REUSED`.
  2. **Habilitación del feriante** (403 con `code`):
     - cuenta confirmada → si no, `ACCOUNT_NOT_CONFIRMED`;
     - perfil propio con CUIT → si no, `PROFILE_INCOMPLETE`;
     - un `exhibitorId` que no es el propio → `EXHIBITOR_NOT_AUTHORIZED`;
     - suscripción `ACTIVE` (o `CANCELLED` dentro del período ya pagado, `EXH-05`) con `current_period_end` futuro → si no, `SUBSCRIPTION_REQUIRED`.
  3. **Evento publicado o activo** dentro de la ventana de venta; si no → 422 `EVENT_SALES_CLOSED`.
  4. **El stand se bloquea** (`SELECT … FOR UPDATE`). Tiene que estar `AVAILABLE` y con precio; si no → 409 `STAND_UNAVAILABLE`.
  5. **Un hold vencido se libera en el momento** (`EXPIRED`, auditado). Un HELD no tiene cobro en vuelo: al abrir el checkout pasa a `PAYMENT_PENDING` (`PAY-02`), que no se libera solo, así que no hace falta la ventana de conciliación de §6.6. Una reserva activa vigente → 409 `STAND_UNAVAILABLE`.
  6. **Un hold vivo por expositor y evento** ("un stand por checkout", §1.5) → 409 `HOLD_LIMIT`.
  7. **Hold de 15 minutos** con reloj del servidor. Precio, moneda y versión de términos quedan congelados en la reserva (INV-05).
- **Invariantes en la base:** índice único parcial de una reserva activa por stand (INV-01), FK compuestas `(tenant_id, event_stand_id)` y `(tenant_id, exhibitor_id)` (INV-02), `CHECK` de hold con vencimiento y RLS `ENABLE` + `FORCE`. `platform_subscriptions` es global por usuario (se paga a la plataforma), sin tenant ni RLS, como `users`.
- **Lectura:** el expositor sólo ve sus reservas; OWNER/ADMIN/OPERATOR ven las de la organización. Un HELD vencido se muestra `EXPIRED` aunque todavía no se haya escrito. La respuesta trae monto, stand (código y `areaM2` calculada con PostGIS), evento, expositor y términos.
- **Activación manual de la suscripción** (atajo de desarrollo; el cobro real es `EXH-05`), con el rol dueño:
  `INSERT INTO platform_subscriptions (user_id, status, current_period_end) SELECT id, 'ACTIVE', now() + interval '30 days' FROM users WHERE lower(email) = lower('<email>') ON CONFLICT (user_id) DO UPDATE SET status = 'ACTIVE', current_period_end = EXCLUDED.current_period_end, updated_at = now();`
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-06: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 125/125 (18 de `test/reservations.int-spec.ts`), repetido 3 veces sin fallos: hold 201 con precio congelado, `areaM2` 9 y vencimiento a 15 min; misma clave → 200 con la misma reserva y con otro stand → 422; sin clave o con clave no UUID → 400; stand tomado → 409 `STAND_UNAVAILABLE`; segundo hold en el mismo evento → 409 `HOLD_LIMIT`; dos feriantes a la vez sobre el mismo stand → exactamente un 201 y un 409; 403 `ACCOUNT_NOT_CONFIRMED`, `PROFILE_INCOMPLETE` (sin perfil y sin CUIT) y `SUBSCRIPTION_REQUIRED` (vencida); venta cerrada → 422; stand deshabilitado → 409; stand inexistente → 404; OWNER → 403; `exhibitorId` ajeno → 403 `EXHIBITOR_NOT_AUTHORIZED`; un hold vencido se lee `EXPIRED` y el siguiente feriante toma el stand (el viejo queda `EXPIRED`); cada feriante ve sólo lo suyo (otro → 404) y el organizador ve todo; cancelar un hold → `CANCELLED`, cancelar de nuevo → 409, el stand queda libre y el organizador puede cancelar; una segunda reserva activa directa en la base → `23505`; holds, vencimientos y cancelaciones auditados; fuera de un tenant, 0 filas.
  - 2026-11-06: `npm test --workspace api` 96/96 (incluye `code` en problem+json), `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
- Fuera de alcance: checkout y paso a `PAYMENT_PENDING`/`CONFIRMED` (`PAY-02`/`PAY-03`, que marcarán el stand `ASSIGNED`), job periódico de expiración con ventana de conciliación (`PAY-05`), cancelación de reservas pagas (`PAY-06`), duración del hold configurable (`RESERVATION_HOLD_MINUTES`), rate limit de `POST /reservations` (§5.1: 429) y cobro de la suscripción (`EXH-05`).

##### EXH-05 — Suscripción del feriante a la plataforma

- **Estado:** `IN_PROGRESS` (API hecha; falta la pantalla)
- **Dependencias:** `EXH-04`, `PAY-01`, `PAY-03`, base de `RES-01`
- **Entrega:** migración `0015_platform_subscription_billing` (estado `PENDING`, `current_period_end` nullable, `init_point`, `payer_email`, `provider_status`, `idempotency_key` y `provider_subscription_id` único); `PlatformSubscriptionsService/Controller` en `PaymentsModule`; el puerto de pagos suma `createSubscription`, `getSubscription`, `cancelSubscription` y `getAuthorizedPayment` (SDK `PreApproval` y `fetch` para `/authorized_payments`); variable `PLATFORM_SUBSCRIPTION_PRICE_CENTS`.
- **Reglas:**
  1. **Credenciales de plataforma:** siempre `MP_ACCESS_TOKEN`, nunca el token de un vendedor, también en `production`. Sin token o sin `PLATFORM_SUBSCRIPTION_PRICE_CENTS` → 503.
  2. **Quién:** un usuario con al menos una membresía `EXHIBITOR` activa (403 `EXHIBITOR_REQUIRED`): la suscripción habilita a reservar y así ninguna cuenta cualquiera crea `preapproval` en la cuenta de la plataforma. La suscripción sigue siendo global (sin tenant, sin RLS).
  3. **`POST /me/subscription`** (`Idempotency-Key` UUID obligatorio, `payerEmail` opcional, por defecto el de la cuenta): crea el `preapproval` sin plan (`status: pending`, mensual, `external_reference` = `user_id`, `back_url` = `<web>/feriante/suscripcion`) en 3 pasos (reservar la fila `PENDING`, llamar al proveedor fuera de la transacción, persistir). 201 al crear; 200 si ya hay uno pendiente con el mismo email; con otro `payerEmail` se reemplaza (el anterior se cancela); `ACTIVE` → 409 `SUBSCRIPTION_ALREADY_ACTIVE`. Si el proveedor falla (502) la fila queda reservada y el reintento reutiliza la misma clave del proveedor.
  4. **Webhook:** los topics `subscription_preapproval` y `subscription_authorized_payment` se aceptan **sin** el parámetro `tenant` (la URL del panel no lo lleva); `payment` lo sigue exigiendo. Misma firma, inbox y reintentos que `PAY-03`. Sólo se confía en el id: se lee el `preapproval` (o el pago autorizado y su `preapproval_id`) y se aplica: `authorized` → `ACTIVE` con `current_period_end = next_payment_date` (una renovación lo extiende); `paused` → `PAST_DUE`; `cancelled` → `CANCELLED`; `pending` → sin cambios. Un `preapproval` que no es el vigente de ese usuario o cuyo `external_reference` no es nuestro se ignora (`UNKNOWN_SUBSCRIPTION`); `CANCELLED` es final.
  5. **Cancelar:** `DELETE` cancela en Mercado Pago (irreversible) y marca `CANCELLED`; es idempotente. **Se conserva lo pagado:** RES-01 habilita `ACTIVE` o `CANCELLED` con `current_period_end` futuro; `PENDING` y `PAST_DUE` nunca habilitan.
  6. **Sin auditoría de tenant:** `audit_logs` es por organización y esta suscripción no tiene tenant; el rastro es la fila (`provider_status`, `updated_at`), el inbox de webhooks y el log.
  7. **Sandbox:** sin plan, Mercado Pago exige que la cuenta que paga tenga el email del `payerEmail`; en sandbox es el del **comprador de prueba**, que casi nunca es el de la cuenta Juntta.
- **Aceptación:** el feriante inicia la suscripción, autoriza en `init_point`, el webhook la activa y recién entonces puede reservar; una renovación extiende el período; pausada bloquea reservar; cancelada conserva el período pagado.
- **Evidencia:**
  - 2026-11-10: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 206/206 (22 de `test/subscriptions.int-spec.ts`), repetido 2 veces sin fallos: `NONE`; 401/400/403 `EXHIBITOR_REQUIRED`; `pending` con precio del servidor, email de la cuenta, `external_reference` y `back_url`; reintento → 200 sin segundo `preapproval`; un pendiente no reserva; otro `payerEmail` cancela el anterior; fallo del proveedor reintentable con la misma clave; webhook firmado `authorized` → `ACTIVE` y `POST /reservations` 201; `ACTIVE` → 409; renovación por pago autorizado extiende el período; `pending` sin cambios; `paused` → `PAST_DUE` y 403 `SUBSCRIPTION_REQUIRED`; reanudada → `ACTIVE`; `DELETE` cancela en el proveedor, conserva el período (reserva 201) y es idempotente, un `authorized` tardío no la reactiva; 404 sin suscripción y 502 sin cambios; firma mala o ausente → 401 sin inbox; `preapproval` ajeno → `IGNORED`; error del proveedor → `FAILED`; `payment` sin `tenant` sigue `MISSING_TENANT`; sin precio → 503.
  - 2026-11-10: `npx vitest run` (apps/api) 133/133 (6 del adaptador de suscripciones, 2 de `auto_return` y 1 de configuración), `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` sin errores.
- Fuera de alcance: pantalla `/feriante/suscripcion` (retorno del `back_url`), días de gracia al vencer, avisos por email, `PLATFORM_SUBSCRIPTION_PRICE_CENTS` en `.env.example`, implicancias fiscales (R1) y la suscripción SaaS del organizador (`SUB-01`).

##### PUB-01 — Portal público

- **Entrega (2026-11-11):** API pública, sin sesión ni `X-Tenant-Id`, de sólo lectura: `GET /api/v1/public/events` (eventos `PUBLISHED`/`ACTIVE` de organizaciones activas: slug, nombre, organización, predio y dirección, fechas, `salesOpen`, stands totales y disponibles), `GET /public/events/:slug` (lo mismo más los sectores), `GET /public/events/:slug/map` (GeoJSON como §5.3: stands con código, superficie, sector, precio y estado `AVAILABLE`/`RESERVED`/`OCCUPIED`/`BLOCKED`; pasillos, accesos y salidas) y `GET /public/events/:slug/exhibitors` (directorio). Mismas formas que el puerto `PublicCatalogRepository` de la web.
- **Decisiones:**
  - El slug de evento es único global (EVT-01), así que la ruta no lleva el slug de la organización.
  - Sin sesión no hay tenant: la migración `0019_public_portal` agrega dos funciones `SECURITY DEFINER` (mismo patrón que `exhibitor_invitation_lookup`, `0008`): `public_event_lookup(slug)` resuelve (evento, tenant) sólo de eventos en venta y organizaciones activas, y `public_event_list()` lista columnas publicables. El resto de las lecturas corre en `withTenant` bajo RLS, con columnas explícitas. Un borrador, un evento cerrado o cancelado, una organización suspendida, un slug inexistente o mal formado dan el mismo 404.
  - Un expositor sólo aparece (mapa y directorio) con `public_contact_opt_in` y una reserva `CONFIRMED`; una reserva retenida (`HELD`/`PAYMENT_PENDING`) muestra el stand como `RESERVED` sin nombrar a nadie. Nunca se publican razón social, CUIT, email, teléfono, ids de usuario o expositor, reservas, pagos ni `metadata` de objetos del plano.
  - Del plano sólo salen `STAND`, `AISLE`, `ENTRY` y `EXIT`: `EMERGENCY`, `UTILITY` y `OBSTACLE` son datos operativos ("no publicar geometría de seguridad sensible", §5.3). Los stands `DISABLED` no se dibujan; `BLOCKED` o sin precio se muestran bloqueados.
  - Caché: `Cache-Control: public, max-age=60` en lista, evento y directorio; `max-age=15` en el mapa, porque lleva la disponibilidad (§5.3).
- **Aceptación:** AC-11 y AC-PRD-03: la ficha privada no aparece sin consentimiento; un borrador responde 404 en todas las rutas.
- **Evidencia:**
  - 2026-11-11: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 258/258 (9 de `test/public-portal.int-spec.ts`: sin credenciales, listado entre organizaciones, mapa con estados y expositor consentido, directorio, ningún email/teléfono/CUIT/razón social/reserva/pago en ninguna respuesta, borrador/cerrado/suspendido/slug malformado → 404, aislamiento entre organizaciones).
- **Web (2026-11-11):** el portal del visitante (`/ferias`, `/ferias/:slug`) usa el adaptador HTTP de la API pública, sin sesión; E2E con API simulada y axe en `e2e/public-catalog.e2e.ts`. Falta una prueba manual contra la API real con datos cargados.
- Fuera de alcance: SSE de disponibilidad (`/events/:id/stand-events`), límite de tasa (hoy sólo caché HTTP; falta un limitador por IP en el borde), ciudad y provincia del predio (el predio sólo guarda `address`), descripción y catálogo de productos del expositor (sin tabla de rubros ni productos, `EXH-02`), logo, SSR/prerender y auditoría de accesibilidad (AC-12).

##### REP-01 — Métricas del evento

- **Entrega (2026-11-11):** `GET /api/v1/events/:id/metrics[?days=N]` (OWNER/ADMIN/OPERATOR; EXHIBITOR → 403; otra organización → 404). Primer bloque idéntico a `EventMetricsDto` del Panel (D2 de `org-ui-shell`) y los agregados de REP-01: `stands { total, available, held, pending, confirmed, blocked }`, `pendingAmountCents`, `reservationsByDay [{ day, count }]` (últimos `days` días UTC, 30 por defecto, 1 a 90, con ceros), `latePaymentIncidents` y `occupancyBySector`.
- **Definiciones:** `sellableStands` = stands no `DISABLED`; `approvedGmvCents` = pagos `APPROVED` de reservas `CONFIRMED` (un reembolso o un pago tardío en conflicto no suma); `pendingAmountCents` = precio de las reservas `HELD`/`PAYMENT_PENDING`; `reconciliationPending` = intentos `PENDING`; `latePaymentIncidents` = auditoría `payment.late_conflict` de reservas del evento; `gmvByMonth` por mes UTC de la última actualización del intento.
- **Evidencia:**
  - 2026-11-11: `test:int` → 258/258 (8 de `test/metrics.int-spec.ts`: estados de stands, ingresos confirmados sin reembolsos, monto pendiente, reservas por día con ceros, incidencias del evento, sectores, 403/401/404/400).
- **Web (2026-11-11):** el Panel (`/organizador/panel`) lee `GET /events/:id/metrics` con el adaptador HTTP.
- **Exportación CSV (2026-11-11):** `GET /api/v1/events/:id/reservations/export` (OWNER/ADMIN/OPERATOR; EXHIBITOR → 403; otra organización → 404). `text/csv; charset=utf-8` con BOM UTF-8, `Content-Disposition: attachment; filename="reservas-<slug>-<AAAA-MM-DD>.csv"` y una fila por reserva: stand, sector, expositor, email, estado, monto (ARS con decimales), creada, actualizada (UTC ISO 8601), estado del último intento de pago e id de pago. Escapado RFC 4180 y protección contra inyección de fórmulas (las celdas de texto que empiezan con `=`, `+`, `-`, `@`, tab o CR llevan un `'` delante). La web lo baja con `HttpClient` (blob) desde el Panel y desde "Reservas y cobros".
  - Evidencia: `test/reservations-export.int-spec.ts` (5: columnas y adjunto, escapado, inyección, 403/401, otra organización/id inválido → 404), `src/events/csv.spec.ts`, 3 adaptadores/componentes en `features/reports` y E2E de descarga en `e2e/organizer-screens.e2e.ts` y `e2e/organizer-reservations.e2e.ts`.
- Fuera de alcance: otras exportaciones (pagos, expositores) y reportes por rango de fechas.

#### Integración Mercado Pago (EP07)

Desglose de EP07 según §6, §7 e INV-07, con la documentación oficial relevada el 2026-10-30 (§16). Lo marcado **(verificar)** no quedó confirmado en ese relevamiento y se valida contra la documentación vigente antes de implementarlo.

##### PAY-00 — Decisiones de integración

- **Estado:** `VERIFIED` — [ADR 0006](../adr/0006-integracion-mercado-pago.md)
- **Dependencias:** ninguna
- **Entrega:** ADR con las decisiones que condicionan PAY-01..07.
- **Aceptación:** cada decisión cita la página oficial que la respalda; lo no confirmado queda como riesgo explícito.
- **Evidencia requerida:** revisión documental con enlaces oficiales vigentes.
  - 2026-11-02: ADR 0006 con 13 fuentes oficiales (`mercadopago.com.ar/developers` + SDK `mercadopago` 3.6.1) y riesgos R-MP-1..8 para lo no confirmado.
  - Corrección: no se confirmó que Mercado Pago "recomiende Orders para integraciones nuevas"; sólo la Payments API figura como legacy.
- [x] Track: Checkout Pro vía **Preferences API** para el MVP. Orders API queda diferida, porque `application_fee`/split todavía no está documentado ahí. Payments API sólo para `GET` de pagos y reembolsos.
- [x] Credenciales por organizador (R1): **OAuth de Mercado Pago** (`authorization_code` + PKCE, `offline_access`; access token de 180 días, y cada refresh devuelve uno nuevo). Renovación serializada por organizador y tokens cifrados AES-256-GCM con clave envuelta por KMS/vault (`key_id`). `marketplace_fee` queda fuera del MVP (R-MP-3, R-MP-4).
- [x] `x-signature`: `WebhookSignatureValidator` del SDK (HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`). La deriva de `ts` se registra siempre; la tolerancia de 300 s se exige recién tras verificar en sandbox que los reintentos se re-firman (R-MP-1, R-MP-2, R-MP-8).
- [x] Idempotencia: Preferences propia (payment attempt UUID = `external_reference`, `preference_id` persistido una vez). En reembolsos y escrituras, `X-Idempotency-Key` propio y estable, porque el SDK genera uno nuevo por llamada (R-MP-5).
- [x] `binary_mode: false`: se aceptan pagos pendientes/offline, `expiration_date_to` ≤ vencimiento del hold y no se libera el hold a ciegas con un attempt pendiente. El pago tardío genera `LATE_PAYMENT_CONFLICT` (R-MP-6).

##### PAY-01 — Proveedor de pagos y credenciales

- **Estado:** `IN_PROGRESS` (falta la prueba en sandbox con usuarios de prueba)
- **Dependencias:** `FND-04`, `PAY-00`
- **Entrega:** puerto `PaymentProvider` (crear preferencia, obtener pago, reembolsar, cancelar) y adaptador con el SDK oficial `mercadopago`; adaptador falso para tests.
- **Aceptación:** sin credenciales, las operaciones de pago fallan con error explícito y el resto de la API arranca (§13.1); el Access Token nunca llega al frontend ni a logs; sólo la Public Key es pública.
- **Evidencia requerida:** tests unitarios del adaptador contra dobles HTTP y prueba en sandbox con usuarios de prueba.
  - 2026-11-07: `src/payments/mercadopago.provider.spec.ts` (9 tests, `fetch` global reemplazado): preferencia con monto del servidor en unidades, `external_reference`, `back_urls`, `auto_return`, `binary_mode: false`, `expires` y `expiration_date_to` con offset; la creación de preferencia no se reintenta; sin token o en producción → 503 sin llamar al proveedor; error del proveedor → 502 sin su cuerpo; pago leído en centavos; reembolso total/parcial y cancelación con `X-Idempotency-Key` propio. `npm test` 108/108, `tsc` y `oxlint` OK.
- **Decisiones:**
  - SDK `mercadopago` fijado en `3.6.1` (ADR 0006, R-MP-8).
  - **Un `MercadoPagoConfig` nuevo por llamada:** el SDK mezcla `requestOptions` dentro del config compartido, así que reusarlo arrastraría la idempotency key o `maxRetries: 0` a la llamada siguiente.
  - Reintentos: crear preferencia **0** (Preferences no tiene clave idempotente); `GET`, reembolso y cancelación **2**, con clave propia. Timeout 10 s.
  - **Credenciales:** desde `PAY-07`, el token de la cuenta vendedora que el organizador vinculó por OAuth (ADR 0006 §2). Sin cuenta vinculada, `MP_ACCESS_TOKEN` de plataforma **sólo en `sandbox`**; en `production` los pagos responden 503, así nunca se cobra a nombre de la plataforma por error.
- [x] Validar `MP_ENVIRONMENT` (`sandbox`|`production`, por defecto `sandbox`), `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y `MP_NOTIFICATION_URL` (https) en el esquema de entorno. Sin Public Key: no hay SDK de frontend.
- [x] Cliente con timeouts, reintentos acotados sólo en operaciones idempotentes y errores mapeados a problem+json (503/502) sin filtrar datos del proveedor; el log registra sólo operación, status y tenant.
- [x] Credenciales de prueba y usuarios de prueba comprador/vendedor documentados (sin valores) en el README.
- [ ] Prueba en sandbox con usuarios de prueba hasta `init_point` (requiere credenciales `TEST-` cargadas a mano).

##### PAY-02 — Preferencia Checkout Pro

- **Estado:** `IN_PROGRESS` (falta la prueba en sandbox hasta `init_point`)
- **Dependencias:** `RES-01`, `PAY-01`
- **Entrega:** `POST /api/v1/reservations/:id/checkout` crea un payment attempt idempotente y una preferencia por reserva (§6.5). Tabla `payment_attempts` (migración `0010_payment_attempts`).
- **Aceptación:** el precio sale del snapshot del servidor, nunca del frontend; reintentar no crea una segunda preferencia; si el proveedor falla el hold se mantiene.
- **Evidencia requerida:** tests de integración con proveedor falso y prueba en sandbox hasta `init_point`.
  - 2026-11-07: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 136/136 (11 de `test/checkout.int-spec.ts`), repetido 3 veces sin fallos:
    - Checkout → 201 `{paymentAttemptId, checkoutUrl, status: "PENDING"}` con el monto congelado de la reserva, aunque el precio del stand cambie después (INV-05). `expiresAt` = vencimiento del hold, `back_urls` de la web y reserva en `PAYMENT_PENDING`.
    - Reintento con la misma u otra clave → 200 con el mismo attempt y sin llamar de nuevo al proveedor.
    - Si el proveedor falla → 502 y la reserva sigue `HELD`; el reintento completa el mismo attempt.
    - Dos checkouts a la vez → un 201 y un 200, con el mismo cuerpo.
    - Una reserva con checkout no se libera al vencer el hold: otro feriante recibe 409 `STAND_UNAVAILABLE`.
    - Reserva cancelada o hold vencido → 409 `RESERVATION_NOT_PAYABLE`; otro feriante → 404, OWNER → 403; sin clave → 400.
    - En la base: un segundo attempt `PENDING` por reserva → `23505`. El checkout queda auditado y fuera de un tenant se ven 0 filas.
  - 2026-11-07: `npm test` 108/108, `test:e2e` 7/7, `tsc` y `oxlint` OK.
- **Reglas:**
  1. Sólo el dueño de la reserva (rol EXHIBITOR) y con `Idempotency-Key` UUID. La reserva se bloquea (`FOR UPDATE`), así que los checkouts concurrentes comparten un attempt.
  2. Pagable si es un `HELD` vigente o un `PAYMENT_PENDING` (que devuelve su checkout); si no → 409 `RESERVATION_NOT_PAYABLE`.
  3. Se reutiliza el attempt de la misma clave o, si no, el `PENDING` de la reserva; si no hay ninguno se crea uno con el monto y la moneda congelados en la reserva.
  4. La preferencia se crea **fuera de la transacción**. Se guarda una sola vez (`WHERE preference_id IS NULL`): si dos requests crearon preferencia, la segunda queda huérfana y expira (ADR 0006 §4). Recién entonces la reserva pasa `HELD → PAYMENT_PENDING` (auditado).
  5. Un `PAYMENT_PENDING` **no se libera solo** al vencer el hold, porque puede haber un pago en vuelo (§6.6). La resuelven el webhook (`PAY-03`) o la conciliación (`PAY-05`), que la vence si no hay pago pasados 5 min del hold.
- [x] `items` con `title` (`Stand <código> — <evento>`), `quantity: 1`, `unit_price` y `currency_id` desde el snapshot; `external_reference` = id del payment attempt.
- [x] `notification_url` = `MP_NOTIFICATION_URL` + `tenant=<id>` (para `PAY-03`; sin la variable rige la del panel), `back_urls` `<web>/feriante/reservas/:id/pago/{aprobado,pendiente,rechazado}` y `auto_return: "approved"`.
- [x] `expires: true` con `expiration_date_to` = vencimiento del hold (ISO 8601 con offset).
- [x] Persistir `preference_id` y `init_point` (o `sandbox_init_point` en sandbox) y devolver sólo la URL de checkout.
- [ ] Prueba en sandbox hasta `init_point`. Riesgo a verificar: Mercado Pago podría rechazar `auto_return` con una `back_urls.success` que no sea https (en local es `http://localhost:4200`).

##### PAY-03 — Webhooks de pago

- **Estado:** `IN_PROGRESS` (falta la prueba con el simulador del panel y webhooks reales en sandbox)
- **Dependencias:** `PAY-02`
- **Entrega:** `POST /api/v1/webhooks/mercadopago` con inbox (`payment_webhook_inbox`) y procesamiento asíncrono idempotente (§6.7). Migración `0011_payment_webhooks`, que también suma `payment_id` y `payment_status` al attempt.
- **Aceptación:** AC-07 (dos webhooks idénticos, un único efecto); firma inválida → 401 sin procesar; respuesta 200/201 en mucho menos de 22 s (Mercado Pago reintenta cada 15 min); la aprobación sólo ocurre tras `GET /v1/payments/{id}` y cotejo de `external_reference`, cobrador, monto y moneda.
- **Evidencia requerida:** tests con webhooks duplicados, desordenados y con firma inválida; prueba con el simulador del panel.
  - 2026-11-07: `test:int` → 145/145 (9 de webhooks en `test/checkout.int-spec.ts`, firmados con HMAC real), repetido 3 veces sin fallos:
    - Firma falsa o ausente → 401 y nada en el inbox.
    - Pago `approved` → 200, se lee el pago con el tenant de la URL, la reserva queda `CONFIRMED` y el stand `ASSIGNED`.
    - El mismo `x-request-id` → una sola fila en el inbox; otra notificación del mismo pago → `ALREADY_APPROVED` y un solo `reservation.confirmed` auditado (AC-07).
    - Un `pending` posterior no revierte la aprobación.
    - `in_process` → se registra sin confirmar.
    - Monto distinto → `AMOUNT_MISMATCH`, auditado y sin confirmar.
    - Aprobado sobre una reserva cancelada → `LATE_PAYMENT_CONFLICT` auditado, sin adjudicar.
    - `merchant_order`, una notificación sin tenant o una referencia ajena → 200 e `IGNORED`.
    - Si el proveedor falla → 200 y `FAILED`.
  - 2026-11-07: `npm test` 108/108, `test:e2e` 7/7, `tsc` y `oxlint` OK.
- **Decisiones:**
  - **Tenant en la `notification_url`** (`?tenant=<id>`, `PAY-02`): el webhook necesita el tenant para leer el pago con las credenciales del vendedor (`PAY-07`). Es un parámetro **sin firmar**, así que sólo es una pista: el pago se lee con ese tenant y se exige que su `external_reference` sea un attempt de ese tenant (RLS). Si no coincide → `UNKNOWN_ATTEMPT`. Requiere `MP_NOTIFICATION_URL`; la URL del panel, sin tenant, se ignora (`MISSING_TENANT`).
  - **Inbox global** (sin RLS, como `users`), deduplicado por `x-request-id`. Guarda sólo identificadores; el `tenant_id` no tiene FK porque viene de un input no confiable. Cada fila termina `PROCESSED`/`IGNORED`/`FAILED` con un `outcome`.
  - **Procesamiento en el mismo proceso** después del 200. Los `FAILED` (proveedor caído) y los `RECEIVED` que quedaron colgados por un reinicio los retoma la conciliación (`PAY-05`).
  - **Efectos:** sólo `approved` cambia estado (attempt `APPROVED`, reserva `HELD`/`PAYMENT_PENDING` → `CONFIRMED`, stand `ASSIGNED`). `pending`/`in_process`/`rejected`/`cancelled` se registran en el attempt sin tocar la reserva, porque la preferencia sigue pagable hasta vencer y otro medio puede aprobarla. Un attempt aprobado no se toca más, salvo para registrar `refunded`/`charged_back` (`PAY-06`).
  - **Pago aprobado de una reserva que ya no puede confirmarse** (vencida, cancelada o confirmada por otro attempt) → `payment.late_conflict` con `LATE_PAYMENT_CONFLICT` (INV-07); la devolución es de `PAY-06`.
  - **Frescura de `ts`:** se registra la deriva en el log y todavía no se exige tolerancia (ADR 0006 §3).
- [x] Validar `x-signature` (`ts`, `v1`) con `x-request-id` y `data.id` de la query, según PAY-00 (`WebhookSignatureValidator` del SDK).
- [x] Topic `payment`; `merchant_order` y los no suscriptos se responden 200 y se ignoran (Checkout Pro manda ambos, y `payment` alcanza).
- [x] Transiciones monotónicas: un evento viejo no revierte un estado más avanzado.
- [x] Cotejo del **cobrador** (`PAY-07`): con cuenta vinculada, `collector_id` distinto del vendedor → `COLLECTOR_MISMATCH`.
- [x] Mapear `refunded`/`charged_back` (`PAY-06`).
- [ ] Verificar la lista vigente de `status`/`status_detail` en sandbox.
- [ ] Prueba con el simulador del panel; confirmar que Mercado Pago conserva el query `tenant` de la `notification_url`.

##### PAY-04 — Retorno de checkout (P19)

- **Estado:** `IN_PROGRESS` (el área Feriante ya usa la API real; falta pagar de punta a punta en el sandbox con el comprador de prueba)
- **Dependencias:** `PAY-02`, `PUB-UI-01..06`
- **Entrega:** páginas de retorno aprobado/pendiente/rechazado en el área Feriante, en las `back_urls` de PAY-02: `/feriante/reservas/{id}/pago/{aprobado|pendiente|rechazado}`.
- **Web del feriante con datos reales (2026-11-10):**
  - Sesión (P01, `/ingresar`): token de acceso sólo en memoria, renovado con la cookie HttpOnly al arrancar y ante un 401 (una sola renovación a la vez); el interceptor suma `Authorization` y `X-Tenant-Id` (la organización de la membresía `EXHIBITOR`; `/me/subscription` va sin tenant). `/feriante/**` exige sesión y vuelve a `?volver=`; el visitante y el organizador siguen sin login.
  - Catálogo: no existe `PUB-01`, así que "Explorar stands" lee los eventos, stands, rubros y plano **de la organización del feriante** (`GET /events`, `/events/{id}/stands|sectors`, `/layout-versions/{id}`), que se abrió al rol `EXHIBITOR` sólo para eventos `PUBLISHED`/`ACTIVE` y versiones de plano `PUBLISHED`. Los stands con reserva propia viva se ven como "Reservado". Ruta `/feriante/explorar[/{slug}]`.
  - P18 `/feriante/reservas/nueva?stand=…&feria=…` (o `?reserva={id}` para retomar el pago): resumen y términos (`termsVersion` 2026-11) → `POST /reservations` (hold, `Idempotency-Key`) → cuenta regresiva → `POST …/checkout` → `MercadoPagoWallet` (o link a `checkoutUrl`). Errores con mensaje claro: `SUBSCRIPTION_REQUIRED` (link a la suscripción), `PROFILE_INCOMPLETE`, `STAND_UNAVAILABLE`, `EVENT_SALES_CLOSED`, hold vencido.
  - "Mis reservas" `/feriante/reservas`: `GET /reservations` con evento, importe, estado en español, "Pagar" para holds vivos y enlace al estado (P19).
  - Actualización 2026-11-11: el panel, expositores, editor de plano, Mercado Pago, reservas y cobros del organizador y el portal del visitante (`/ferias`, `PUB-01`) ya leen la API; ya no queda ninguna pantalla con adaptador en memoria en las rutas. Lo único pendiente de `PAY-04` es pagar de punta a punta en el sandbox.
- **Aceptación:** los query params del retorno (`payment_id`, `status`, `external_reference`, `merchant_order_id`, `preference_id`…) sólo orientan la UI; el estado mostrado sale de la API propia y se actualiza cuando llega el webhook.
- **Evidencia requerida:** tests de página, E2E con API simulada y axe.
  - 2026-11-09: `ng test` 292/292 (7 de `checkout-return.page.spec.ts` y 1 de rutas), repetido 3 veces; Playwright 11/11 (3 de `e2e/checkout-return.e2e.ts`, axe sin violaciones serias/críticas); `tsc` y `oxlint` OK.
- **Reglas de la pantalla** (`CheckoutReturnPage`, puerto `ReservationPaymentRepository`):
  - Se ignoran los query params; el retorno sólo elige el texto. Lo que manda es `GET /reservations/{id}`: `CONFIRMED` → confirmado, `EXPIRED` → venció, `CANCELLED`/`REFUND_*` → reserva inactiva, aunque el retorno diga "aprobado".
  - Aprobado o pendiente con la reserva todavía `HELD`/`PAYMENT_PENDING`: consulta cada 4 s hasta 15 veces y después ofrece "Volver a consultar".
  - Rechazado: una sola consulta; "Reintentar el pago" (`POST /reservations/{id}/checkout`, que devuelve la preferencia abierta) sólo mientras el hold no venció.
  - El pago se abre con el **Wallet Brick** de Checkout Pro (etapa "Agregar el SDK al frontend"): `MercadoPagoWallet` carga `sdk.mercadopago.com/js/v2` con la Public Key de la plataforma (`MP_PUBLIC_KEY`), el `preferenceId` y `marketplace: true` cuando el organizador vinculó su cuenta (PAY-07). Sin public key, o si el SDK no carga, cae a un link a `init_point`. `CheckoutView` suma `preferenceId` y `wallet: {publicKey, marketplace} | null`.
  - 2026-11-09: API `test:int` 171/171 (vista del checkout con `wallet`, modo marketplace con cuenta vinculada), `npm test` 124/124; web `ng test` 295/295 (3 de `mercado-pago-wallet.spec.ts`), Playwright 11/11.
  - 2026-11-10 (web con sesión y datos reales: P01, P07 real, P18, Mis reservas, `/feriante/suscripcion`): `ng test` 353/353 (sesión con renovación única, interceptor, guard, login, adaptadores con `HttpTestingController`, P18, Mis reservas, suscripción); Playwright 23/23 con la API simulada con `page.route` (`e2e/support/mock-api.ts`; flujos de `e2e/reservation-flow.e2e.ts` y `e2e/subscription.e2e.ts`, axe sin violaciones serias/críticas); `tsc` (app y spec) y `oxlint` OK. Verificado a mano contra el stack real con el escenario sandbox: login, stands del evento publicado, hold del stand S2 y Wallet Brick de Mercado Pago renderizado (sin pagar).
- [x] Estado pendiente con reintento de consulta y explicación de pagos offline.
- [x] Rechazado con opción de reintentar dentro del hold.
- [ ] Adaptador HTTP de `ReservationPaymentRepository` (con sesión).

##### PAY-05 — Conciliación y pago tardío

- **Estado:** `IN_PROGRESS` (API y P10 listas; falta la prueba en sandbox)
- **Dependencias:** `PAY-03`
- **Entrega:** job de conciliación de attempts pendientes y vista P10 de incidencias (§6.6, §6.8, INV-07). `ReconciliationService.run(now)` y `GET /api/v1/payment-incidents` (OWNER/ADMIN).
- **Aceptación:** el hold no se libera a ciegas si el proveedor no responde; un pago aprobado tras la adjudicación genera `LATE_PAYMENT_CONFLICT` sin doble adjudicación.
- **Evidencia requerida:** tests de reloj controlado y escenarios de carrera.
  - 2026-11-07: `test:int` → 153/153 (8 de conciliación en `test/checkout.int-spec.ts`, con `run(now)` como reloj controlado), repetido 3 veces sin fallos:
    - Con un pago `in_process` se mantiene.
    - Con un pago aprobado por otro monto se mantiene.
    - Si el proveedor no responde no se libera (`unreachable: 1`).
    - A 1 min del vencimiento sigue `PAYMENT_PENDING`; pasada la ventana pasa a `EXPIRED` (attempt `EXPIRED`) y otro feriante toma el stand.
    - Un pago aprobado que nunca se notificó → `CONFIRMED`.
    - Un webhook `FAILED` se reintenta y confirma.
    - Dos corridas simultáneas → un solo vencimiento auditado.
    - Las incidencias `LATE_PAYMENT_CONFLICT`/`AMOUNT_MISMATCH` sólo las ve el admin (feriante → 403).
  - 2026-11-07: `npm test` 109/109 (incluye `findPayments`), `test:e2e` 7/7, `tsc` y `oxlint` OK.
- **Reglas del job** (cada 60 s, en el proceso; apagado en `NODE_ENV=test`):
  1. **Reintenta webhooks:** los `FAILED` y los `RECEIVED` de más de 1 min (perdidos por un reinicio), dentro de los últimos 4 días, que es cuando Mercado Pago deja de reintentar.
  2. **Reservas `PAYMENT_PENDING` vencidas hace más de 5 min** (ventana de conciliación) con su attempt `PENDING`: busca los pagos por `external_reference` (`GET /v1/payments/search`).
     - Aprobado con el monto del snapshot → se aplica como un webhook (`CONFIRMED`).
     - Aprobado con otro monto → se mantiene y queda en el log: llegó plata y decide una persona.
     - `pending`/`in_process`/`authorized`/`in_mediation` → se mantiene.
     - Proveedor sin respuesta → se mantiene y se alerta en el log (`unreachable`).
     - Sin pagos, o sólo rechazados/cancelados → `EXPIRED` (reserva y attempt, auditado) y el stand queda libre.
  3. Cada cambio vuelve a verificar el estado bajo `FOR UPDATE`: si un webhook ganó mientras tanto, el job no hace nada. Por eso dos instancias a la vez son seguras.
- **Incidencias (P10):** `GET /payment-incidents` lee la auditoría (`payment.late_conflict` → `LATE_PAYMENT_CONFLICT`, `payment.mismatch` → `AMOUNT_MISMATCH`), de la más nueva a la más vieja. Se resuelven con `POST /reservations/{id}/refunds` (`PAY-06`).
- [x] Consultar el pago por `external_reference` antes de expirar un hold. La orden comercial no hace falta: los pagos de la preferencia llevan el `external_reference` del attempt.
- [ ] Alertas y KPIs de conciliación pendiente y errores de webhook (§1.4): hoy sólo `warn` en el log; falta métrica/dashboard.
- [x] Pantalla P10 en la web: las incidencias se muestran en "Reservas y cobros" (`/organizador/reservas`, `features/organizer-reservations`) y llevan a devolver la reserva; E2E con API simulada y axe en `e2e/organizer-reservations.e2e.ts`.
- [ ] Ponytail: el job corre en el proceso de la API. Pasarlo a un job repetible de BullMQ cuando la API escale a varias instancias (hoy es correcto, pero duplica las consultas al proveedor).

##### PAY-06 — Reembolsos, cancelaciones y contracargos

- **Estado:** `IN_PROGRESS` (API lista; el reembolso total/parcial y la devolución desde una incidencia ya están en "Reservas y cobros"; falta la prueba en sandbox)
- **Dependencias:** `PAY-05`
- **Entrega:** `POST /api/v1/reservations/:id/refunds` (OWNER/ADMIN, `Idempotency-Key`): reembolso total o parcial (`POST /v1/payments/{id}/refunds`, parcial con `amount`), cancelación de pagos pendientes (`PUT /v1/payments/{id}` → `cancelled`) y registro de contracargos. Tabla `payment_refunds` (migración `0012_payment_refunds`), una fila por `payment_id`.
- **Aceptación:** reembolsos idempotentes y auditados; dentro de los 180 días desde la aprobación; un pago con dos medios se revierte por cada `payment_id`.
- **Evidencia requerida:** tests con proveedor falso y prueba en sandbox.
  - 2026-11-09: `test:int` → 162/162 (9 de `PAY-06` en `test/checkout.int-spec.ts`), repetido 3 veces sin fallos:
    - Reembolso total de una reserva `CONFIRMED` → `REFUNDED` y stand `AVAILABLE`; el replay con la misma clave → 200, misma respuesta, sin otra llamada al proveedor y un solo `reservation.refunded`.
    - Sin nada para devolver → 409 `NOTHING_TO_REFUND`.
    - `LATE_PAYMENT_CONFLICT` → se reembolsa sin tocar la reserva (`CANCELLED`).
    - Pago con dos medios → un reembolso por `payment_id`; si el proveedor falla → 502 y la reserva queda `REFUND_PENDING` (stand todavía `ASSIGNED`); el reintento con la misma clave completa → `REFUNDED`.
    - Aprobado hace más de 180 días → 422 `REFUND_WINDOW_CLOSED`.
    - Parcial: monto mayor al pago → 422 `REFUND_AMOUNT_INVALID`; válido → la reserva sigue `CONFIRMED`.
    - Pago `pending` de una reserva `PAYMENT_PENDING` → se cancela; reserva y attempt `CANCELLED`.
    - Feriante → 403; sin `Idempotency-Key` → 400.
    - Webhook `charged_back` → `PAYMENT_CHARGED_BACK`, incidencia `CHARGEBACK` con `reservationId`, la reserva no cambia.
  - 2026-11-09: `npm test` 109/109 (incluye `date_approved` → `approvedAt`), `test:e2e` 7/7, `tsc` y `oxlint` OK.
- **Reglas:**
  1. Se leen del proveedor todos los pagos de los attempts de la reserva (`external_reference`): `approved` → `REFUND`, `pending`/`in_process`/`authorized` → `CANCEL`. Los ya revertidos por completo se saltean.
  2. Parcial (`amountCents`) sólo con exactamente un pago aprobado y hasta su monto (si no → 422 `PARTIAL_REFUND_AMBIGUOUS` / `REFUND_AMOUNT_INVALID`).
  3. Tres pasos, como el checkout: se registran las filas `PENDING` bajo lock de la reserva; se llama al proveedor fuera de la transacción con el **id de la fila como `X-Idempotency-Key`**; se cierra bajo lock. Una falla deja la fila `PENDING` (502) y el replay con la misma clave la retoma; otra clave mientras tanto → 409 `REFUND_IN_PROGRESS`.
  4. Efecto en la reserva, sólo si es total: `CONFIRMED` → `REFUND_PENDING` → `REFUNDED` (stand `ASSIGNED` → `AVAILABLE`); `PAYMENT_PENDING` → `CANCELLED` (attempt `CANCELLED`). En cualquier otro estado (conflicto tardío, monto distinto) o si es parcial, la reserva no cambia.
  5. Webhook sobre un attempt aprobado: `refunded` sólo se registra en el attempt; `charged_back` audita `payment.charged_back` → incidencia `CHARGEBACK` (decide una persona).
- [x] Nombre del campo del parcial: `amount` (en unidades; el adapter convierte desde centavos).
- [ ] Prueba en sandbox de reembolso total, parcial y cancelación de un pago offline.
- [ ] Botón "Devolver" en P10 (web).
- [ ] Ponytail: una fila que quedó `PENDING` por una falla del proveedor se retoma sólo cuando el admin reintenta con la misma clave. Sumarla al job de conciliación si pasa seguido.
- [ ] Ponytail: no se suscribe el topic `chargebacks` (`GET /v1/chargebacks/{id}`); el topic `payment` ya informa `charged_back`. Sumarlo cuando haga falta el detalle de la disputa.

##### PAY-07 — Configuración Mercado Pago (P12)

- **Estado:** `IN_PROGRESS` (API y pantalla P12 listas, la web usa el adaptador HTTP desde 2026-11-10; falta la prueba en sandbox con cuentas de prueba)
- **Dependencias:** `PAY-01`, `CORE-03`
- **Entrega:** vinculación OAuth de la cuenta vendedora del organizador según ADR 0006 §2. `GET /api/v1/payment-account`, `POST /payment-account/authorization`, `POST /payment-account/link` y `DELETE /payment-account` (OWNER/ADMIN). Tabla `seller_accounts` (migración `0013_seller_accounts`, RLS), una por tenant.
- **Aceptación:** sólo owner/administrador; los secretos nunca vuelven al navegador; estado de vinculación y entorno visibles.
- **Evidencia requerida:** tests de autorización, de página y axe.
  - 2026-11-10: `test:int` → 171/171 (8 en `test/payment-account.int-spec.ts` con servidor OAuth falso, 1 de cobrador en `test/checkout.int-spec.ts`), repetido 3 veces sin fallos:
    - Sin vincular → `NOT_LINKED` con el entorno; feriante → 403.
    - Vinculación con PKCE: el verifier cumple `S256` con el challenge enviado y no viaja en el `state`; la respuesta y la auditoría no contienen tokens; en base sólo hay texto cifrado con el `key_id` de la clave.
    - `state` adulterado, de otro usuario o de otra organización → 400 `INVALID_OAUTH_STATE`, sin canjear el código.
    - Lejos del vencimiento se usa el token guardado; tres llamadas concurrentes cerca del vencimiento → **una sola** renovación y se guarda el refresh token rotado.
    - Renovación fallida con el token vigente → se sigue usando; vencido → 503 y estado `EXPIRED` (revincular).
    - Revincular reemplaza la cuenta; desvincular → `NOT_LINKED`. Sin tenant (RLS) no se ve ninguna fila.
    - Pago cobrado por otra cuenta que la vinculada → `COLLECTOR_MISMATCH`, incidencia, sin confirmar.
  - 2026-11-10 (web P12): `ng test` 284/284 (6 de `PaymentAccountPage`, 4 de la página de retorno, 1 de rutas con el flujo completo); `playwright` 8/8 con 2 de P12 y **axe sin violaciones serias/críticas** (sin vincular, vinculada, confirmación de desvincular, retorno inválido); capturas desktop (1280) y móvil (390) revisadas.
  - 2026-11-10: `npm test` 124/124 (`TokenCipher`, `MercadoPagoOAuth` con `fetch` simulado, provider con el token del vendedor, contrato de entorno), `test:e2e` 7/7, `tsc` y `oxlint` OK.
- **Flujo:**
  1. `POST /payment-account/authorization` arma la URL de `auth.mercadopago.com/authorization` con `client_id`, `platform_id=mp`, `redirect_uri` estática, `code_challenge` (S256) y un `state` **cifrado con AES-256-GCM** que lleva tenant, usuario, verifier y vencimiento (10 min, lo que dura el código). No hace falta tabla de autorizaciones en curso.
  2. Mercado Pago vuelve a `MP_OAUTH_REDIRECT_URI` (pantalla P12 de la web) con `code` y `state`; la web llama `POST /payment-account/link` con su sesión y el `X-Tenant-Id`. La API exige que el `state` sea de ese tenant y de ese usuario (anti-CSRF) y canjea el código con el verifier (`POST /oauth/token`, `test_token` en sandbox).
  3. Se guardan cifrados access y refresh token, `seller_id` (`user_id` del vendedor), `live_mode`, `expires_at` y `key_id`. Se audita `payment_account.linked`/`unlinked` sin secretos.
- **Uso de las credenciales:** el provider pide el token por tenant. Con cuenta vinculada usa la del organizador (también en `production`); sin cuenta, `sandbox` cae al `MP_ACCESS_TOKEN` de plataforma para desarrollo y `production` responde 503.
- **Renovación:** 7 días antes de vencer (el token dura 180). Serializada con `SELECT … FOR UPDATE` sobre la fila del tenant durante la llamada, porque cada refresh rota el refresh token. Si falla y el token sigue vigente, se usa y se avisa en el log; vencido → 503 y la pantalla pide revincular.
- **Cobrador (§6.7):** con cuenta vinculada, un pago cuyo `collector_id` no es el `seller_id` → `payment.collector_mismatch` (incidencia `COLLECTOR_MISMATCH`) y no se confirma.
- [x] Pantalla P12 en la web: `/organizador/mercado-pago` (estado con ícono y texto, entorno, id de vendedor, vencimiento; vincular, revincular y desvincular con confirmación `alertdialog` y foco en Cancelar; aviso si venció) y `/organizador/mercado-pago/vincular` (retorno: canjea `code`/`state`, explica `state` inválido o autorización cancelada con `error=access_denied`).
- [x] Adaptador HTTP de `PaymentAccountRepository` (`HttpPaymentAccountRepository`, provisto en la ruta `/organizador/mercado-pago`); el adaptador en memoria queda sólo para tests.
- [ ] Prueba en sandbox con cuentas de prueba: confirmar los campos de `/oauth/token` (`user_id`, `live_mode`, `expires_in`) y el comportamiento del refresh (R-MP-4).
- [ ] Ponytail: la clave de cifrado sale de `MP_TOKEN_ENCRYPTION_KEY`. Envolverla con KMS/vault antes de producción; la rotación re-cifra las filas del `key_id` viejo.
- [ ] Ponytail: la renovación sólo ocurre cuando se usa el token. Sumar al job de conciliación una renovación proactiva y una alerta para cuentas sin uso cerca del vencimiento.

##### SUB-01 — Suscripción SaaS del organizador

- **Estado:** `PENDING` — **fuera del MVP** (§1.5); requiere decisión de producto sobre planes y precios.
- **Dependencias:** `CORE-03`, `PAY-00`
- **Entrega:** planes `POST /preapproval_plan` (`reason`, `back_url`, `auto_recurring`: `frequency`, `frequency_type`, `transaction_amount`, `currency_id: "ARS"`, `billing_day`, `free_trial`) y suscripciones `POST /preapproval` (`preapproval_plan_id`, `payer_email`, `card_token_id` con `status: "authorized"`, o `status: "pending"` con `init_point`); cambios con `PUT /preapproval/{id}`.
- **Aceptación:** el ingreso SaaS se registra aparte del GMV de stands (§1.4); webhooks `subscription_preapproval`, `subscription_authorized_payment` y `subscription_preapproval_plan` con la misma validación de firma que PAY-03.
- **Evidencia requerida:** prueba en sandbox con usuarios de prueba.
- [ ] Confirmar valores de `status` para pausar/cancelar **(verificar)** y reglas de usuarios de prueba.

##### SEC-01 — Límite de tasa de las rutas anónimas

- **Estado:** `VERIFIED` (2026-11-11)
- **Entrega:** `@RateLimit('public' | 'webhook')` + `RateLimitGuard` (`http/rate-limit.guard.ts`) sobre el mismo `CounterStore` de Redis del límite de login (`INCR` + `EXPIRE NX`, ventana fija): el contador se comparte entre instancias. No se agregó `@nestjs/throttler`: habría duplicado el cliente de Redis y no emite las cabeceras del borrador; el guard son ~80 líneas sobre lo que ya existía. `RateLimitModule` provee un único `RedisCounterStore` (una sola conexión para el login y las rutas públicas).
- **Rutas y cupos:** bucket `public` (`PUBLIC_RATE_LIMIT`=120 cada `PUBLIC_RATE_LIMIT_WINDOW_SECONDS`=60, por IP; el mapa es lo más consultado): `GET /public/events`, `/:slug`, `/:slug/map`, `/:slug/exhibitors`, `GET /public/invitations/:token`, `POST /public/invitations/:token/accept` y `GET /auth/providers`. Bucket `webhook` (`WEBHOOK_RATE_LIMIT`=600 por minuto y por IP): `POST /webhooks/mercadopago`. Mercado Pago reintenta y manda ráfagas desde pocas direcciones, y una notificación rechazada demora la confirmación de un pago; el tope sólo corta inundaciones (cada request cuesta una verificación HMAC) y la conciliación (`PAY-05`) es la red de seguridad. Las demás rutas no cambian; el login mantiene su límite propio (por email y por IP, 503 si Redis falla).
- **Respuesta:** sobre el límite → `429 Too Many Requests` (RFC 6585) como `application/problem+json` (RFC 9457) con `code: RATE_LIMITED` y `Retry-After` en segundos (RFC 9110 §10.2.3). Toda respuesta de una ruta limitada lleva `RateLimit-Policy: "public";q=120;w=60` y `RateLimit: "public";r=<restantes>;t=<segundos hasta el reinicio>` según `draft-ietf-httpapi-ratelimit-headers-11` (IETF, mayo de 2026; sigue siendo Internet-Draft, la sintaxis puede cambiar). Las tres cabeceras se exponen por CORS.
- **IP del cliente:** `TRUST_PROXY` = cantidad de saltos de proxy de confianza (0 a 10; 0 por defecto = se ignora `X-Forwarded-For`). Fastify cuenta desde la DERECHA de la cabecera (lo que agregó cada proxy), así que un cliente que manda su propio `X-Forwarded-For` no puede elegir su cubo. Detrás de Firebase Hosting y Cloud Run hay que fijar la cantidad de saltos de Google delante del contenedor (a verificar al desplegar con un request de prueba: demasiado alto permite falsificar la IP, demasiado bajo agrupa a todos los clientes bajo la IP de Google; ver README).
- **Redis caído:** el guard **falla abierto** (las lecturas públicas siguen funcionando) y deja un `warn` sin IP ni clave; el límite de login no cambia.
- **Evidencia:** unit (`rate-limit-headers.spec.ts`, `rate-limit.guard.spec.ts`, `env.schema.spec.ts`) e integración (`test/rate-limit.int-spec.ts` con `MemoryCounterStore`: cabeceras, 429 con `Retry-After`, cubo por IP, `X-Forwarded-For` ignorado sin `TRUST_PROXY` y no falsificable con `TRUST_PROXY=1`, cupo propio del webhook).
- [ ] Pendiente: medir en el despliegue real los saltos de `TRUST_PROXY`, y un límite por usuario para rutas autenticadas (`POST /reservations`, §5.1).

## 11. Roadmap
Sprint 0 (1 semana): ADRs, UX, repo, CI, entorno, diseño RLS.
S1-S2 (4 semanas): core tenants, auth, venues, editor base.
S3-S4 (4 semanas): geometría robusta, versionado, evento, tarifas, expositor.
S5-S6 (4 semanas): reservas concurrentes, Mercado Pago Sandbox/Webhooks, conciliación.
S7 (2 semanas): portal público, reportes, pruebas accesibilidad.
S8 (2 semanas): hardening, carga, pilotaje, despliegue.
Total orientativo: 17 semanas incluyendo Sprint 0, con equipo de 3-5 personas; ajustar según velocidad real, integración MP y complejidad geométrica. No equivale a compromiso contractual.

## 12. Criterios de aceptación E2E y NFR
AC-01 Un editor crea stand 3x4 m y persiste 12 m² al cambiar zoom y dispositivo.
AC-02 Dos stands con lados compartidos se publican; superposición interior de 0.5 m² bloquea publicación.
AC-03 Una plantilla se usa en dos eventos; reserva en el evento A no ocupa stand del B.
AC-04 Cambiar plantilla crea versión nueva; A sigue leyendo geometría previa.
AC-05 100 requests simultáneos para último stand generan exactamente un hold activo y 99 resultados sin doble asignación.
AC-06 Un intento reintentado con misma Idempotency-Key no genera reserva adicional.
AC-07 Dos Webhooks idénticos generan un único efecto de confirmación.
AC-08 Retorno visual `success` sin pago validado NO confirma reserva.
AC-09 Pago tardío tras reasignación no confirma segundo expositor; registra incidencia.
AC-10 Expositor tenant B nunca accede a reserva ni documentos del tenant A ni modificando UUID/host.
AC-11 Perfil expositor privado no aparece en mapa público sin autorización.
AC-12 Mapa público usable móvil, alternativa tabla/lista y navegación teclado.
AC-13 Reporte distingue GMV aprobado, intentos pendientes, cancelaciones y potencial ingreso SaaS.
AC-14 Token MP ausente produce error configurable y no bloquea exploración de mapa.
AC-15 La caducidad de hold se determina por servidor y tareas reintentables.
AC-16 Backups restaurados se verifican en entorno separado.

## 13. Contratos de infraestructura y Docker
Estructura `apps/api` (NestJS), `apps/web` (Angular), `docker-compose.yml`, `.env.example`, `package.json` monorepo. Compose de desarrollo debe iniciar PostgreSQL/PostGIS, Redis, LocalStack limitado a S3, API y Web con servicios y volúmenes persistentes. Prohibir contraseñas de ejemplo para producción.

### 13.1 Configuración por entorno
`.env.example` es la plantilla versionada para desarrollo local; `.env` nunca se versiona. Los secretos de ejemplo son marcadores que deben reemplazarse, no credenciales utilizables. `POSTGRES_PASSWORD` debe ser hexadecimal seguro para que la URI PostgreSQL generada por Compose no requiera escape de caracteres. Compose sustituye los endpoints `localhost` de `DATABASE_URL`, `REDIS_URL` y `S3_ENDPOINT` por nombres de servicio dentro de la red Docker.

| Variables | Requisito y uso |
|---|---|
| `NODE_ENV`, `API_HOST`, `PORT`, `API_PREFIX`, `WEB_PORT`, `API_PROXY_TARGET`, `CORS_ORIGINS`, `LOG_LEVEL`, `SWAGGER_ENABLED` | Configuración local de API/web; `CORS_ORIGINS` es una lista separada por comas (en producción no admite `*` ni Swagger). Validadas al arrancar ([ADR 0004](../adr/0004-contrato-de-entorno-y-autenticacion.md)). |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL` | PostgreSQL/PostGIS local; las credenciales se generan localmente y nunca se comparten. `DATABASE_URL` usa el rol de aplicación `juntta_app` (sin superusuario ni `BYPASSRLS`, §2.2). |
| `APP_DB_PASSWORD`, `DATABASE_MIGRATION_URL` | `CORE-01`: contraseña del rol `juntta_app` (generada por `scripts/init-local-env.mjs`) y conexión del rol dueño, usada **sólo** por `npm run db:setup` / el servicio `db-migrate`. La API nunca recibe la URL ni la contraseña del dueño (Compose las vacía en el servicio `api`). |
| `REDIS_URL` | Redis local para BullMQ, jobs y cache; también los contadores del límite de tasa (`SEC-01`). |
| `TRUST_PROXY`, `PUBLIC_RATE_LIMIT`, `PUBLIC_RATE_LIMIT_WINDOW_SECONDS`, `WEBHOOK_RATE_LIMIT` | `SEC-01`: saltos de proxy de confianza para leer la IP del cliente (por defecto `0`), cupo por IP de las rutas públicas (`120` cada `60` s) y del webhook de Mercado Pago (`600` por minuto). Opcionales. |
| `DOCUMENT_UPLOAD_TTL_MINUTES` | `EXH-03`: minutos tras los que una subida de documento sin confirmar se borra con su objeto (por defecto `60`, mínimo `10`). Opcional. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | LocalStack emula S3 en desarrollo con credenciales públicas de simulación; en producción se requiere un proveedor S3 y credenciales de mínimo privilegio administradas fuera de Git. |
| `S3_PUBLIC_ENDPOINT` (opcional) | Endpoint con el que se firman las URL de subida y descarga (`EXH-03`), el que alcanza el navegador; por defecto `S3_ENDPOINT`. En Compose: `http://localhost:4566` (la API usa `http://s3:4566`). |
| `MP_ENVIRONMENT`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_NOTIFICATION_URL`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_OAUTH_REDIRECT_URI`, `MP_TOKEN_ENCRYPTION_KEY` | Mercado Pago usa `sandbox` localmente (valor por defecto). Las credenciales pueden quedar vacías para flujos que no son de pago; los pagos responden 503 hasta configurarlas, y en `production` hasta que `PAY-07` vincule la cuenta del organizador. `MP_NOTIFICATION_URL` (https, opcional) es la URL pública del webhook; sin ella rige la configurada en el panel de Mercado Pago. `PAY-07`: credenciales de la aplicación OAuth y `redirect_uri` estática (la pantalla P12); con `MP_CLIENT_ID` se exigen las otras tres. `MP_TOKEN_ENCRYPTION_KEY` son 32 bytes aleatorios en base64 para cifrar los tokens de los vendedores (AES-256-GCM); cambiarla obliga a revincular. |
| `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_REFRESH_TOKEN_SECRET`, `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_COOKIE_NAME`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAME_SITE` | `CORE-02` ([ADR 0004](../adr/0004-contrato-de-entorno-y-autenticacion.md)): secretos de ≥ 32 caracteres y distintos entre sí (generados por `scripts/init-local-env.mjs`); TTL por defecto 900 s / 14 días; cookie `juntta_rt`, `Secure` y `SameSite=Strict` por defecto. En producción `AUTH_COOKIE_SECURE=false` se rechaza. |
| `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Integraciones opcionales de observabilidad; pueden quedar vacías localmente. |

## 14. Checklist de Definition of Done
- Tests unitarios de dominio + integración DB + E2E del flujo completo.
- Índices, migraciones `up/down` probadas, RLS y pruebas de aislamiento.
- Swagger publicado en entorno de desarrollo y versionado.
- Cobertura de estados de pago y corrida de Webhooks duplicados/desordenados.
- Lighthouse/accesibilidad revisados; mapa y lista equivalentes.
- Logs, tracing, métricas, alertas y rollback del release.
- Manual operador, manual feriante y política de soporte.

## 15. Riesgos y decisiones pendientes
R1 integración de cobro por cuenta de cada organizador: validar mecanismo legal/técnico y contratos. R2 operación de pago tardío y reservas inconsistentes: conciliación y estados intermedios. R3 plano complejo: determinar importación SVG/DXF y polígonos en futuro. R4 datos personales y fiscales: privacidad argentina/ARCA. R5 eventos en distintas sedes y fechas: reservar por `EventStand`, nunca por plantilla. R6 UI interactiva bajo conexiones lentas: fallback lista; SSE con reconexión. R7 sectores — **resuelto** (2026-10-30, [ADR 0002](../adr/0002-sectores-por-evento.md)): entidad del evento (`event_sectors` + `event_stands.sector_id`); el plano no cambia y el contorno en mapas se deriva de los stands.

## 16. Fuentes oficiales consultadas
- Mercado Pago Preferences: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/overview
- Mercado Pago Checkout Pro API: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/overview
- Mercado Pago Webhooks: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications
- Mercado Pago crear preferencia (consultado 2026-10-30): https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/create-payment-preference ; referencia: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post
- Mercado Pago notificaciones Webhooks (consultado 2026-10-30): https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
- Mercado Pago back_urls y reembolsos (consultado 2026-10-30): https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/configure-back-urls ; https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/refunds-and-cancellations
- Mercado Pago suscripciones (consultado 2026-10-30): https://www.mercadopago.com.ar/developers/es/docs/subscriptions/overview ; https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval-plan/post ; https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post
- Mercado Pago Checkout API / Orders (consultado 2026-10-30): https://www.mercadopago.com.ar/developers/es/docs/checkout-api/overview
- PostGIS ST_IsValid: https://postgis.net/docs/ST_IsValid.html
- PostGIS ST_Intersects: https://postgis.net/docs/en/ST_Intersects.html
