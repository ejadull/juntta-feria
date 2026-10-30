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
Autenticación de panel `Authorization: Bearer <token>` (o sesión HttpOnly con CSRF según decisión de implementación), rol y tenant verificados. Recursos públicos explícitos sin credenciales. Errores `application/problem+json` con `type,title,status,detail,code,traceId`.

| Método | Ruta | Rol | Propósito |
|---|---|---|---|
| POST | /api/v1/auth/login | público | Login |
| GET | /api/v1/me | usuario | Perfil y memberships |
| POST | /api/v1/tenants | superadmin | Crear organización |
| GET/POST | /api/v1/venues | owner/operator | Listar/crear predios |
| POST | /api/v1/layout-templates | operator | Plantilla nueva |
| POST | /api/v1/layout-templates/:id/versions | operator | Clonar nueva versión editable |
| PUT | /api/v1/layout-versions/:id/objects/:objectId | operator | Actualizar geometría y metadatos |
| POST | /api/v1/layout-versions/:id/publish | owner | Validar y publicar versión |
| POST/GET | /api/v1/events | operator | Crear/listar eventos |
| POST | /api/v1/events/:id/publish | owner | Publicar evento |
| GET/PATCH | /api/v1/events/:id/stands | operator | Inventario, tarifas y asignación masiva de sector |
| GET/POST/PATCH/DELETE | /api/v1/events/:id/sectors | operator | Sectores del evento ([ADR 0002](../adr/0002-sectores-por-evento.md)) |
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

- **Estado:** `IN_PROGRESS` (falta corregir las referencias de infraestructura del README)
- **Dependencias:** ninguna
- **Entrega:** ADRs para monorepo/ejecución, configuración/autenticación y persistencia/PostGIS; este tablero permanece alineado con el diseño aprobado.
- **Aceptación:** las decisiones no contradicen el stack existente ni presentan como implementadas capacidades aún pendientes.
- **Evidencia requerida:** revisión documental, enlaces internos válidos y `git diff --check`.
  - 2026-10-30: ADRs en `docs/adr/` (una sola carpeta y numeración, en lugar de `docs/architecture/adr/0001-0003` del plan): [0003](../adr/0003-monolito-modular-npm-workspaces.md), [0004](../adr/0004-contrato-de-entorno-y-autenticacion.md), [0005](../adr/0005-drizzle-y-sql-explicito-postgis.md).
- [x] Crear ADR del monolito modular con npm workspaces.
- [x] Crear ADR del contrato de configuración y JWT con refresh token HttpOnly.
- [x] Crear ADR de Drizzle ORM con SQL explícito para PostGIS, RLS y constraints críticos.
- [ ] Corregir referencias de infraestructura que no coincidan con las rutas reales.

##### FND-02 — Contrato de entorno y validación

- **Estado:** `IN_PROGRESS` (plantilla y `.env` locales pendientes de acción humana)
- **Dependencias:** ninguna
- **Entrega:** `.env.example` completo y seguro, `.env` local coherente y validación tipada al iniciar la API.
- **Aceptación:** variables requeridas inválidas detienen el arranque con mensajes saneados; variables futuras opcionales no bloquean flujos ajenos; ningún secreto se versiona ni aparece en salidas.
- **Evidencia requerida:** pruebas unitarias de configuración, comprobación de claves sin valores y revisión de archivos rastreados.
  - 2026-10-30: `npm run test --workspace api` → 28/28 (27 de `env.schema.spec.ts`); `node --test scripts/init-local-env.test.mjs` → 5/5; `docker compose config --quiet` OK.
  - Ajustes aprobados: sin variables `MINIO_*` (el stack usa LocalStack); `CORS_ORIGINS` reemplaza a `CORS_ORIGIN` en Compose; el puerto publicado de PostgreSQL usa `POSTGRES_PORT`, el nombre de la plantilla.
  - Bloqueo: `Read/Edit(.env.*)` está denegado en la configuración global de Claude Code; la plantilla y el `.env` real los aplica una persona.
- [x] Clasificar variables requeridas, opcionales, predeterminadas y reservadas (ADR 0004).
- [ ] Actualizar `.env.example` con documentación y marcadores inequívocos (propuesta entregada; falta aplicarla).
- [ ] Completar `.env` local preservando valores existentes y generando solo los secretos faltantes (`node scripts/init-local-env.mjs` listo y probado; falta confirmar su ejecución sobre el `.env` real).
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

- **Estado:** `VERIFIED` (con el `.env` local actual; FND-02 sigue abierta sólo por la acción humana sobre `.env`)
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

- **Estado:** `PENDING`
- **Dependencias:** `FND-03`, `FND-04`
- **Entrega:** el frontend consume la API por una ruta relativa estable y usa proxy configurable en desarrollo, sin URLs dependientes del entorno hardcodeadas en componentes.
- **Aceptación:** Web alcanza liveness a través de su origen local tanto con npm como con Compose.
- **Evidencia requerida:** prueba del cliente, build Angular y request HTTP atravesando el proxy.
- [ ] Definir cliente HTTP y base relativa `/api/v1`.
- [ ] Configurar proxy de desarrollo mediante variable de entorno con default local seguro.
- [ ] Agregar una comprobación visible mínima del estado API sin diseñar todavía el producto final.
- [ ] Probar éxito y fallo de conectividad.

##### FND-06 — Verificación y documentación de Sprint 0A

- **Estado:** `PENDING`
- **Dependencias:** `FND-01`, `FND-02`, `FND-03`, `FND-04`, `FND-05`
- **Entrega:** instrucciones locales consistentes, verificaciones completas y evidencia asentada en este documento.
- **Aceptación:** lint, tests, builds y validación Compose pasan; README refleja npm workspaces y rutas reales; no hay secretos ni cambios ajenos.
- **Evidencia requerida:** comandos, resultados y fecha registrados al cerrar la tarea.
- [ ] Actualizar README y eliminar contradicciones operativas con Nx/pnpm.
- [ ] Ejecutar lint, pruebas unitarias, E2E relevantes y builds.
- [ ] Validar Compose y el stack en ejecución.
- [ ] Auditar diff, archivos rastreados y posibles secretos.
- [ ] Registrar evidencia y cambiar estados solo para tareas realmente verificadas.

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
| `CORE-01` Base de datos y migraciones | `FND-06` | Drizzle, migraciones PostgreSQL/PostGIS y roles separados | `PENDING` |
| `CORE-02` Usuarios, sesiones y membresías | `CORE-01` | login, refresh rotativo HttpOnly, logout y membresías | `PENDING` |
| `CORE-03` Aislamiento y auditoría | `CORE-02` | autorización tenant, RLS y auditoría | `PENDING` |
| `VEN-01` Predios | `CORE-03` | CRUD de predios fijos/temporales | `PENDING` |
| `LUI-01..10` Editor de plano frontend | ninguna (ver change) | editor P06 con repositorio en memoria; fija contrato de geometría para `LAY-01` — [change archivado](changes/archive/2026-10-30-lay-ui-floor-plan-editor/proposal.md) · spec [`layout-editor`](specs/layout-editor/spec.md) | `VERIFIED` |
| `ORG-01..07` Shell del organizador, Panel y Expositores | ninguna (ver change) | navegación, P03 y P11 en consulta con adaptadores en memoria; fija contratos de lectura para `REP-01`/`EXH-01` — [change archivado](changes/archive/2026-10-30-org-ui-shell/proposal.md) · spec [`organizer-shell`](specs/organizer-shell/spec.md) | `VERIFIED` |
| `PUB-UI-01..06` Vistas Feriante y Visitante | ninguna (ver change) | "Ver como", P07 Elegí tu stand y catálogo/mapa público en consulta con adaptador en memoria; fija contrato de lectura para `PUB-01`; reserva y pago como marcadores de `RES-01`/`PAY-01` — [change archivado](changes/archive/2026-10-30-pub-ui-catalog/proposal.md) · spec [`public-catalog`](specs/public-catalog/spec.md) | `VERIFIED` |
| `LAY-01` Layouts versionados | `VEN-01`, contrato de `LUI-05` | geometría, publicación e inmutabilidad | `PENDING` |
| `EVT-01` Eventos, stands y tarifas | `LAY-01` | evento sobre versión publicada, sectores por evento ([ADR 0002](../adr/0002-sectores-por-evento.md)) e inventario valorizado | `PENDING` |
| `EXH-01` Expositores | `CORE-03` | perfil privado/público y consentimiento | `PENDING` |
| `RES-01` Reservas concurrentes | `EVT-01`, `EXH-01` | holds, locking e idempotencia | `PENDING` |
| `PAY-00` Decisiones de integración Mercado Pago | ninguna | ADR: track Checkout Pro, credenciales por organizador y validación de firma (ver [EP07](#integración-mercado-pago-ep07)) | `PENDING` |
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

#### Integración Mercado Pago (EP07)

Desglose de EP07 según §6, §7 e INV-07, con la documentación oficial relevada el 2026-10-30 (§16). Lo marcado **(verificar)** no quedó confirmado en ese relevamiento y se valida contra la documentación vigente antes de implementarlo.

##### PAY-00 — Decisiones de integración

- **Estado:** `PENDING`
- **Dependencias:** ninguna
- **Entrega:** ADR con las decisiones que condicionan PAY-01..07.
- **Aceptación:** cada decisión cita la página oficial que la respalda; lo no confirmado queda como riesgo explícito.
- **Evidencia requerida:** revisión documental con enlaces oficiales vigentes.
- [ ] Elegir track: Checkout Pro vía **Preferences API** (`POST /checkout/preferences`, el de §7) o vía **Orders API** (Mercado Pago lo recomienda para integraciones nuevas y marca la Payments API como legacy, sin funcionalidades nuevas).
- [ ] Credenciales por organizador (R1): mecanismo autorizado para cobrar en la cuenta vendedora de cada organizador (OAuth de Mercado Pago u otro vigente) frente a una cuenta única; almacenamiento cifrado (KMS/vault) y rotación.
- [ ] Validación de `x-signature`: usar `WebhookSignatureValidator` del SDK oficial o el manifest documentado en la pestaña "Sin SDKs" **(verificar plantilla del manifest y algoritmo HMAC)**; ventana de frescura del `ts`.
- [ ] Uso de `X-Idempotency-Key` en creación de pagos/reembolsos **(verificar en la referencia)**; en Preferences la idempotencia es propia (payment attempt + `external_reference`).
- [ ] `binary_mode` (sólo aprobado/rechazado) frente a aceptar `pending` (pagos offline) según la duración del hold.

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
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL` | PostgreSQL/PostGIS local; las credenciales se generan localmente y nunca se comparten. |
| `REDIS_URL` | Redis local para BullMQ, jobs y cache. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | LocalStack emula S3 en desarrollo con credenciales públicas de simulación; en producción se requiere un proveedor S3 y credenciales de mínimo privilegio administradas fuera de Git. |
| `MP_ENVIRONMENT`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Mercado Pago usa `sandbox` localmente. Las credenciales pueden quedar vacías para flujos que no son de pago; pagos deben fallar con error explícito y configurable hasta configurarlas. |
| `JWT_SECRET` | Marcador opcional hasta decidir en un ADR entre JWT y sesión HttpOnly; no se debe consumir antes de esa decisión. |
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
