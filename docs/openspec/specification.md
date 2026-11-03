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
- payment_attempts(id, tenant_id, reservation_id, provider, provider_preference_id, provider_payment_id, status, amount_cents, currency, external_reference, checkout_url, created_at)
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
| POST | /api/v1/tenants | superadmin | Crear organización |
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
| GET | /api/v1/public/events/:slug | público | Evento público |
| GET | /api/v1/public/events/:slug/map | público | GeoJSON y disponibilidad |
| GET | /api/v1/public/events/:slug/exhibitors | público | Directorio público |
| POST | /api/v1/reservations | expositor | Crear hold idempotente |
| POST | /api/v1/reservations/:id/checkout | propietario de reserva | Crear checkout |
| GET | /api/v1/reservations/:id | propietario/admin | Estado de reserva |
| POST | /api/v1/reservations/:id/cancel | propietario/admin | Cancelar según política |
| POST | /api/v1/webhooks/mercadopago | proveedor | Recibir eventos firmados |
| GET | /api/v1/events/:id/metrics | operator | KPIs, incluido `occupancyBySector` ([ADR 0002](../adr/0002-sectores-por-evento.md)) (modelo de lectura: D2 de [`org-ui-shell`](changes/archive/2026-10-30-org-ui-shell/design.md)) |
| GET | /api/v1/exhibitors | operator | Expositores del tenant con datos privados y estado de documentación (D4 de [`org-ui-shell`](changes/archive/2026-10-30-org-ui-shell/design.md)); nunca para vistas públicas |
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
| `VEN-01` Predios | `CORE-03` | CRUD de predios fijos/temporales — [detalle](#ven-01--predios) | `VERIFIED` |
| `LUI-01..10` Editor de plano frontend | ninguna (ver change) | editor P06 con repositorio en memoria; fija contrato de geometría para `LAY-01` — [change archivado](changes/archive/2026-10-30-lay-ui-floor-plan-editor/proposal.md) · spec [`layout-editor`](specs/layout-editor/spec.md) | `VERIFIED` |
| `ORG-01..07` Shell del organizador, Panel y Expositores | ninguna (ver change) | navegación, P03 y P11 en consulta con adaptadores en memoria; fija contratos de lectura para `REP-01`/`EXH-01` — [change archivado](changes/archive/2026-10-30-org-ui-shell/proposal.md) · spec [`organizer-shell`](specs/organizer-shell/spec.md) | `VERIFIED` |
| `PUB-UI-01..06` Vistas Feriante y Visitante | ninguna (ver change) | "Ver como", P07 Elegí tu stand y catálogo/mapa público en consulta con adaptador en memoria; fija contrato de lectura para `PUB-01`; reserva y pago como marcadores de `RES-01`/`PAY-01` — [change archivado](changes/archive/2026-10-30-pub-ui-catalog/proposal.md) · spec [`public-catalog`](specs/public-catalog/spec.md) | `VERIFIED` |
| `LAY-01` Layouts versionados | `VEN-01`, contrato de `LUI-05` | geometría, publicación e inmutabilidad — [detalle](#lay-01--layouts-versionados) | `VERIFIED` |
| `EVT-01` Eventos, stands y tarifas | `LAY-01` | evento sobre versión publicada, sectores por evento ([ADR 0002](../adr/0002-sectores-por-evento.md)) e inventario valorizado — [detalle](#evt-01--eventos-stands-y-tarifas) | `VERIFIED` |
| `EXH-01` Expositores | `CORE-03` | perfil privado/público y consentimiento | `PENDING` |
| `RES-01` Reservas concurrentes | `EVT-01`, `EXH-01` | holds, locking e idempotencia | `PENDING` |
| `PAY-00` Decisiones de integración Mercado Pago | ninguna | ADR: track Checkout Pro, credenciales por organizador y validación de firma — [ADR 0006](../adr/0006-integracion-mercado-pago.md) | `VERIFIED` |
| `PAY-01` Proveedor de pagos y credenciales | `FND-04`, `PAY-00` | puerto `PaymentProvider`, adaptador SDK `mercadopago`, sandbox | `PENDING` |
| `PAY-02` Preferencia Checkout Pro | `RES-01`, `PAY-01` | payment attempt idempotente y preferencia desde snapshot de precio | `PENDING` |
| `PAY-03` Webhooks de pago | `PAY-02` | firma, inbox deduplicado, consulta server-to-server y confirmación | `PENDING` |
| `PAY-04` Retorno de checkout (P19) | `PAY-02`, `PUB-UI-01..06` | pantallas aprobado/pendiente/rechazado sin confiar en query params | `PENDING` |
| `PAY-05` Conciliación y pago tardío | `PAY-03` | job de reconciliación, `LATE_PAYMENT_CONFLICT`, P10 | `PENDING` |
| `PAY-06` Reembolsos, cancelaciones y contracargos | `PAY-05` | refund total/parcial, cancelación de pendientes, chargebacks | `PENDING` |
| `PAY-07` Configuración Mercado Pago (P12) | `PAY-01`, `CORE-03` | vincular cuenta vendedora del organizador sin secretos en claro | `PENDING` |
| `SUB-01` Suscripción SaaS del organizador | `CORE-03`, `PAY-00` | planes (`preapproval_plan`) y suscripciones (`preapproval`); **fuera del MVP** | `PENDING` |
| `PUB-01` Portal público | `EVT-01`, `EXH-01`, `RES-01` | catálogo, mapa, disponibilidad y accesibilidad | `PENDING` |
| `REP-01` Reportes | `PAY-05` | ocupación, GMV y exportaciones CSV | `PENDING` |

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
- Fuera de alcance: endpoints de auditoría (consulta/exportación), superadministrador de plataforma (`POST /tenants`) y auditoría de login.

#### Dominio

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
- Fuera de alcance: ubicación geográfica (§3.1 no la define; EP02 menciona "ubicación", alcanza con `address`), paginación del listado y pantalla P04 en el frontend. La baja de un predio en uso responde 409 desde `LAY-01` (FK `RESTRICT`).

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
- Pendiente para la integración con el frontend: un `HttpLayoutRepository` en el editor, que sume `INVALID_GEOMETRY` a `ValidationCode` y lea `issues` del 422 para `PublishRejectedError`.
- Fuera de alcance: borrar plantillas o borradores, editar las medidas de un borrador, polígonos con huecos y objetos sobre `UTILITY`/`OBSTACLE` (el editor tampoco los valida).

##### EVT-01 — Eventos, stands y tarifas

- **Estado:** `VERIFIED`
- **Dependencias:** `LAY-01`
- **Entrega:** `EventsModule` con las rutas de §5; tablas `events`, `event_sectors` y `event_stands` (migración `0006_events`).
- **Decisiones:**
  - Al crear el evento se genera un `event_stand` por cada `STAND` de la versión publicada, con el código del plano, estado `AVAILABLE` y **sin precio**.
  - `price_cents` es nullable (el DDL ilustrativo de §3.3 lo tenía `NOT NULL`): `NULL` significa "sin tarifa" y lo distingue de un stand gratis. Publicar exige precio en todo stand que no esté `DISABLED` (§4.1), y si falta responde 422 con `STAND_WITHOUT_PRICE` / `NO_SELLABLE_STANDS`.
  - El slug es único global porque el portal público usa `/public/events/:slug`. Si no viene, se genera desde el nombre sin acentos.
  - Las fechas son ISO 8601 con offset obligatorio. Reglas: inicio < fin, apertura de venta < cierre, y cierre ≤ fin del evento (también como `CHECK`).
  - Un evento publicado no cambia sus datos, pero el precio de los stands sí, porque cada reserva congela el suyo (INV-05). `ASSIGNED` no lo fija el organizador (lo hará `RES-01`), y el estado de un stand asignado no se puede cambiar.
- **Aceptación:** INV-03 con FK compuestas (stand → evento + versión, stand → objeto de esa versión) y un trigger que exige versión `PUBLISHED` al crear e impide cambiar plano o predio; INV-09 con la FK `(tenant_id, event_id, sector_id)` y `ON DELETE SET NULL (sector_id)`; sectores únicos por evento sin distinguir mayúsculas; RLS `ENABLE` + `FORCE` en las tres tablas; altas, ediciones, publicación e inventario auditados.
- **Evidencia requerida:** pruebas de integración contra PostgreSQL real.
  - 2026-11-03: `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api` → 76/76 (15 de `test/events.int-spec.ts`): alta en borrador con slug generado, fechas normalizadas y stands A1–A3 disponibles, sin precio y con el `layoutObjectId` del plano; plano en borrador → 409, predio de otro tenant → 404, fechas incoherentes o sin offset → 400; slug repetido → 409; listado y lectura sólo del tenant; sectores con nombre único (409) y orden por `sortOrder`; precio y sector en bloque; 400 con stands ajenos, sector de otro evento, precio negativo o con decimales, estado `ASSIGNED`, sin cambios o lista vacía; OPERATOR → 403 al publicar; publicar con un stand sin precio → 422 con ese stand; deshabilitarlo y publicar → 200; evento publicado → 409 al editar o republicar, pero el precio sigue editable; edición de borrador con fechas validadas contra las guardadas; borrar un sector deja sus stands sin sector; en la base, un evento sobre un plano en borrador es rechazado y un sector de otro evento → `23503`; alta y publicación auditadas; fuera de un tenant, las tres tablas devuelven 0 filas.
  - 2026-11-03: `npm test --workspace api` 86/86 (incluye `slugify` y `datesProblem`), `test:e2e` 7/7, `tsc --noEmit` y `oxlint --type-aware` OK.
- Fuera de alcance: métricas (`/events/:id/metrics`, `REP-01`), transiciones `ACTIVE`/`CLOSED`/`CANCELLED` (dependen de las reservas, `RES-01`), reglas de tarifa por m² o por sector (§4.4, posteriores al MVP), "copiar sectores de otro evento" y la pantalla P09.

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

- **Estado:** `PENDING`
- **Dependencias:** `FND-04`, `PAY-00`
- **Entrega:** puerto `PaymentProvider` (crear preferencia, obtener pago, reembolsar, cancelar) y adaptador con el SDK oficial `mercadopago`; adaptador falso para tests.
- **Aceptación:** sin credenciales, las operaciones de pago fallan con error explícito y el resto de la API arranca (§13.1); el Access Token nunca llega al frontend ni a logs; sólo la Public Key es pública.
- **Evidencia requerida:** tests unitarios del adaptador contra dobles HTTP y prueba en sandbox con usuarios de prueba.
- [ ] Validar `MP_ENVIRONMENT`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (y Public Key si se usa SDK de frontend) en el esquema de entorno.
- [ ] Cliente con timeouts, reintentos acotados sólo en operaciones idempotentes y errores mapeados a problem+json sin filtrar datos del proveedor.
- [ ] Credenciales de prueba del usuario productivo y usuarios de prueba comprador/vendedor documentados (sin valores) en el README.

##### PAY-02 — Preferencia Checkout Pro

- **Estado:** `PENDING`
- **Dependencias:** `RES-01`, `PAY-01`
- **Entrega:** `POST /api/v1/reservations/:id/checkout` crea un payment attempt idempotente y una preferencia por reserva (§6.5).
- **Aceptación:** el precio sale del snapshot del servidor, nunca del frontend; reintentar no crea una segunda preferencia; si el proveedor falla el hold se mantiene.
- **Evidencia requerida:** tests de integración con proveedor falso y prueba en sandbox hasta `init_point`.
- [ ] `items` con `title`, `quantity: 1`, `unit_price` y `currency_id: "ARS"` desde el snapshot; `external_reference` = id del payment attempt.
- [ ] `notification_url` (prioridad sobre la configurada en el panel), `back_urls` `success`/`pending`/`failure` y `auto_return: "approved"`.
- [ ] `expires: true` con `expiration_date_to` ≤ vencimiento del hold (ISO 8601 con offset).
- [ ] Persistir `preference_id` e `init_point` (o `sandbox_init_point` en sandbox) y devolver sólo la URL de checkout.

##### PAY-03 — Webhooks de pago

- **Estado:** `PENDING`
- **Dependencias:** `PAY-02`
- **Entrega:** `POST /api/v1/webhooks/mercadopago` con inbox (`payment_webhook_inbox`) y procesamiento asíncrono idempotente (§6.7).
- **Aceptación:** AC-07 (dos webhooks idénticos, un único efecto); firma inválida → 401 sin procesar; respuesta 200/201 en mucho menos de 22 s (Mercado Pago reintenta cada 15 min); la aprobación sólo ocurre tras `GET /v1/payments/{id}` y cotejo de `external_reference`, cobrador, monto y moneda.
- **Evidencia requerida:** tests con webhooks duplicados, desordenados y con firma inválida; prueba con el simulador del panel.
- [ ] Validar `x-signature` (`ts`, `v1`) con `x-request-id` y `data.id` de la query, según PAY-00.
- [ ] Topics `payment` y órdenes comerciales (`merchant_order`); ignorar con 200 los no suscriptos.
- [ ] Transiciones monotónicas: un evento viejo no revierte un estado más avanzado.
- [ ] Mapear estados del pago (`approved`, `pending`, `in_process`, `rejected`, `cancelled`, `refunded`, `charged_back`) y `status_detail` **(verificar lista vigente)**.

##### PAY-04 — Retorno de checkout (P19)

- **Estado:** `PENDING`
- **Dependencias:** `PAY-02`, `PUB-UI-01..06`
- **Entrega:** páginas de retorno aprobado/pendiente/rechazado en el área Feriante, que reemplazan el marcador "Reserva y pago".
- **Aceptación:** los query params del retorno (`payment_id`, `status`, `external_reference`, `merchant_order_id`, `preference_id`…) sólo orientan la UI; el estado mostrado sale de la API propia y se actualiza cuando llega el webhook.
- **Evidencia requerida:** tests de página, E2E con API simulada y axe.
- [ ] Estado pendiente con reintento de consulta y explicación de pagos offline.
- [ ] Rechazado con opción de reintentar dentro del hold.

##### PAY-05 — Conciliación y pago tardío

- **Estado:** `PENDING`
- **Dependencias:** `PAY-03`
- **Entrega:** job de conciliación de attempts pendientes y vista P10 de incidencias (§6.6, §6.8, INV-07).
- **Aceptación:** el hold no se libera a ciegas si el proveedor no responde; un pago aprobado tras la adjudicación genera `LATE_PAYMENT_CONFLICT` sin doble adjudicación.
- **Evidencia requerida:** tests de reloj controlado y escenarios de carrera.
- [ ] Consultar el pago o la orden comercial por `external_reference` antes de expirar un hold.
- [ ] Alertas y KPIs de conciliación pendiente y errores de webhook (§1.4).

##### PAY-06 — Reembolsos, cancelaciones y contracargos

- **Estado:** `PENDING`
- **Dependencias:** `PAY-05`
- **Entrega:** reembolso total o parcial (`POST /v1/payments/{id}/refunds`; total con cuerpo vacío, parcial con monto **(verificar nombre del campo)**), cancelación de pagos pendientes y registro de contracargos.
- **Aceptación:** reembolsos idempotentes y auditados; dentro de los 180 días desde la aprobación; un pago con dos medios se revierte por cada `payment_id`.
- **Evidencia requerida:** tests con proveedor falso y prueba en sandbox.
- [ ] Topic de contracargos (`GET /v1/chargebacks/{id}`) e incidencia asociada.

##### PAY-07 — Configuración Mercado Pago (P12)

- **Estado:** `PENDING`
- **Dependencias:** `PAY-01`, `CORE-03`
- **Entrega:** pantalla del organizador para vincular y verificar su cuenta vendedora según PAY-00.
- **Aceptación:** sólo owner/administrador; los secretos nunca vuelven al navegador; estado de vinculación y entorno visibles.
- **Evidencia requerida:** tests de autorización, de página y axe.

##### SUB-01 — Suscripción SaaS del organizador

- **Estado:** `PENDING` — **fuera del MVP** (§1.5); requiere decisión de producto sobre planes y precios.
- **Dependencias:** `CORE-03`, `PAY-00`
- **Entrega:** planes `POST /preapproval_plan` (`reason`, `back_url`, `auto_recurring`: `frequency`, `frequency_type`, `transaction_amount`, `currency_id: "ARS"`, `billing_day`, `free_trial`) y suscripciones `POST /preapproval` (`preapproval_plan_id`, `payer_email`, `card_token_id` con `status: "authorized"`, o `status: "pending"` con `init_point`); cambios con `PUT /preapproval/{id}`.
- **Aceptación:** el ingreso SaaS se registra aparte del GMV de stands (§1.4); webhooks `subscription_preapproval`, `subscription_authorized_payment` y `subscription_preapproval_plan` con la misma validación de firma que PAY-03.
- **Evidencia requerida:** prueba en sandbox con usuarios de prueba.
- [ ] Confirmar valores de `status` para pausar/cancelar **(verificar)** y reglas de usuarios de prueba.

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
| `REDIS_URL` | Redis local para BullMQ, jobs y cache. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | LocalStack emula S3 en desarrollo con credenciales públicas de simulación; en producción se requiere un proveedor S3 y credenciales de mínimo privilegio administradas fuera de Git. |
| `MP_ENVIRONMENT`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Mercado Pago usa `sandbox` localmente. Las credenciales pueden quedar vacías para flujos que no son de pago; pagos deben fallar con error explícito y configurable hasta configurarlas. |
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
