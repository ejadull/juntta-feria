# Juntta Feria

**Juntta Feria** es una plataforma SaaS multiempresa para organizar ferias, gestionar predios fijos e itinerantes, diseñar planos reutilizables a escala, comercializar stands, cobrar reservas con Mercado Pago y brindar un mapa público de expositores.

> **Estado:** en desarrollo, sin versión operativa. El frontend tiene las vistas de Organizador, Feriante y Visitante con **datos de demostración en memoria**. La API tiene la base operativa (configuración validada, `/api/v1`, errores `problem+json`, health checks) y la base de datos con migraciones Drizzle y un rol de aplicación sin `BYPASSRLS`, pero todavía **no tiene dominio ni autenticación**. El avance por tarea está en [§10.1 de la especificación](docs/openspec/specification.md#101-plan-de-ejecución-y-subtareas).

## Objetivos

- Organizar ferias y eventos desde una cuenta multiempresa con roles y permisos.
- Dibujar planos a escala en metros, versionarlos y reutilizarlos entre eventos.
- Publicar stands con dimensiones, superficie, ubicación, precios, servicios y disponibilidad.
- Permitir reservas de stands con retención temporal, concurrencia segura y pago por Mercado Pago.
- Mostrar a visitantes un mapa interactivo de expositores y productos.
- Registrar auditoría, pagos, ocupación y reportes operativos.

## Stack

| Componente | Tecnología | Estado |
| --- | --- | --- |
| Monorepo | npm workspaces (`apps/api`, `apps/web`) — [ADR 0003](docs/adr/0003-monolito-modular-npm-workspaces.md) | en uso |
| Frontend | Angular 22 (standalone, signals) + Tailwind CSS 4 — [Design System v1](docs/design/juntta-design-system-v1.md) | en uso, datos de demo |
| Editor y mapa de stands | SVG con coordenadas en metros — [ADR 0001](docs/adr/0001-svg-para-editor-y-mapa.md) | en uso |
| API | NestJS 12 + Fastify, OpenAPI sólo en desarrollo | base operativa |
| Configuración y auth | entorno validado con Zod; JWT + refresh rotativo HttpOnly — [ADR 0004](docs/adr/0004-contrato-de-entorno-y-autenticacion.md) | entorno y auth en uso (`CORE-02`: login, refresh, logout, `/auth/me`) |
| Persistencia | PostgreSQL 16 + PostGIS con Drizzle y SQL explícito — [ADR 0005](docs/adr/0005-drizzle-y-sql-explicito-postgis.md) | migraciones y roles en uso (`CORE-01`); RLS por tenant y auditoría en uso (`CORE-03`) |
| Cache y colas | Redis | contenedor listo |
| Archivos | S3 (en desarrollo: LocalStack, bucket creado al iniciar) | contenedor listo |
| Pagos | Mercado Pago Checkout Pro + Webhooks | pendiente (`PAY-00..07`) |
| Entorno local | Docker Compose (sólo desarrollo) | en uso |

## Documentación

- [Especificación OpenSpec](docs/openspec/specification.md): PRD, dominios, modelo de datos, API, seguridad, reglas de negocio, tablero de tareas, aceptación y roadmap.
- [Specs por capacidad](docs/openspec/specs/) y [changes archivados](docs/openspec/changes/archive/).
- [ADRs](docs/adr/): decisiones de arquitectura vigentes.
- [Juntta Design System v1](docs/design/juntta-design-system-v1.md): paleta, tokens y contraste.
- [Propuesta original de stack](docs/vision/stack-propuesto-original.md): borrador histórico de producto (PWA, offline, performance); **no vigente** donde contradice los ADR.

## Flujo principal

1. El organizador crea un predio y su plano reusable.
2. Publica un evento con una versión inmutable del plano y tarifas por stand.
3. El feriante elige un stand disponible y crea una reserva temporal.
4. Se inicia el checkout de Mercado Pago.
5. La API valida la notificación, consulta el pago y adjudica el stand si corresponde.
6. El visitante explora el mapa de expositores del evento.

## Desarrollo local

Requisitos: Node.js ≥ 22.12, npm 11 y Docker (Docker Desktop en Windows/macOS).

### 1. Variables de entorno

```bash
cp .env.example .env
node scripts/init-local-env.mjs
```

El script completa los marcadores `GENERATE_LOCAL_HEX_64` con valores aleatorios, conserva lo que ya tenga `.env`, deja vacías las credenciales de Mercado Pago y sólo informa **nombres** de variables, nunca valores. Las credenciales sandbox de Mercado Pago se cargan a mano recién cuando se trabaje en pagos. `.env` no se versiona.

#### Mercado Pago: Checkout Pro (`PAY-01..07`)

Sin credenciales, la API arranca igual y los pagos responden 503. La integración sigue las [etapas de Checkout Pro vía Orders API](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-application) (ADR 0007):

| Etapa | Dónde |
|---|---|
| 1. Crear aplicación | En [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app): *Pagos online* → *Checkout Pro*. Activá OAuth con la URL de redirección igual a `MP_OAUTH_REDIRECT_URI`. |
| 2. Configurar ambiente | Credenciales de prueba de la aplicación (selector *Prueba*): Access Token → `MP_ACCESS_TOKEN`, Public Key → `MP_PUBLIC_KEY` (el checkout ya no la usa), Client ID/Secret → `MP_CLIENT_ID`/`MP_CLIENT_SECRET`, `MP_ENVIRONMENT=sandbox`. SDK `mercadopago` en la API. |
| 3. Order | `POST /reservations/{id}/checkout` (PAY-02) crea una order (`POST /v1/orders`, `type: online`, `processing_mode: manual`) con monto congelado, `external_reference`, `payer` (el feriante logueado), `expiration_time` = lo que resta del hold y `X-Idempotency-Key` = id del intento: un reintento tras un timeout devuelve la misma order. `retries.allowed: true`: tras un rechazo se reintenta sobre la misma order. |
| 4. URLs de retorno | `config.online.{success,pending,failure}_url` a `/feriante/reservas/{id}/pago/{aprobado\|pendiente\|rechazado}`; `auto_return` solo con `success_url` https (PAY-04). |
| 5. Redirección | La web redirige al `checkout_url` de la order (`checkoutUrl`); `wallet` es siempre `null`: no hay Wallet Brick. |
| 6. Notificaciones | En *Webhooks* activá el evento **Order (Mercado Pago)** (topic `order`/`orders`) con la URL https de `/api/v1/webhooks/mercadopago` (en local, un túnel como `cloudflared`) y la clave en `MP_WEBHOOK_SECRET` (PAY-03). La URL no lleva `?tenant=`: el tenant sale de nuestro `order id`. El topic `payment` ya no se procesa; `MP_NOTIFICATION_URL` queda sin uso. |
| 7. Pruebas | En *Cuentas de prueba* creá un **vendedor** (organizador, que vincula su cuenta en `/organizador/mercado-pago`) y un **comprador** (feriante). Pagá siempre con el comprador de prueba. |
| 8. Producción | Activá las credenciales productivas, reemplazá Access Token/Public Key, `MP_ENVIRONMENT=production` y HTTPS obligatorio. |

**Suscripción del feriante a la plataforma (`EXH-05`).** Se cobra en la cuenta de la plataforma con `preapproval` (no con el OAuth del organizador):

- `PLATFORM_SUBSCRIPTION_PRICE_CENTS`: precio mensual en centavos de ARS (entero > 0). Sin él, `POST /api/v1/me/subscription` responde 503. Usa el `MP_ACCESS_TOKEN` de la plataforma en cualquier ambiente.
- En el panel de la aplicación, además de *Order (Mercado Pago)*, activá el webhook de **Suscripciones** (`subscription_preapproval` y `subscription_authorized_payment`) con la misma URL `/api/v1/webhooks/mercadopago` **sin** `?tenant=`; la firma se valida con `MP_WEBHOOK_SECRET`.
- Sandbox: sin plan, Mercado Pago rechaza el cobro si la cuenta que paga no tiene el email del `payerEmail`. Enviá **el email del comprador de prueba** (`{ "payerEmail": "..." }`), no el de la cuenta Juntta. Para probar el flujo real: `bootstrap-sandbox.mjs --no-subscription`, luego `sandbox-checkout.mjs subscribe <email del comprador>` y, tras autorizar, `sandbox-checkout.mjs notify-subscription <preapproval_id>`.

Los valores nunca se versionan ni se pegan en issues: sólo los nombres de las variables. `MP_TOKEN_ENCRYPTION_KEY` son 32 bytes en base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Sin cuenta vinculada, `sandbox` usa `MP_ACCESS_TOKEN` y `production` deja los pagos apagados.

### 2. Con Docker Compose (recomendado)

```bash
docker compose up --build -d
```

| Servicio | URL local |
| --- | --- |
| Web | http://localhost:4200 |
| API | http://localhost:3000/api/v1 |
| Liveness / readiness | `/api/v1/health/live` · `/api/v1/health/ready` (PostgreSQL, Redis y bucket S3) |
| OpenAPI (si `SWAGGER_ENABLED=true`) | http://localhost:3000/api/v1/docs |

Al arrancar, el servicio `db-migrate` corre `npm run db:setup` una vez con el rol dueño de la base: crea o actualiza el rol de aplicación `juntta_app` (sin superusuario ni `BYPASSRLS`) y aplica las migraciones de [`apps/api/drizzle/`](apps/api/drizzle/). Recién entonces arranca la API, que se conecta como `juntta_app` y no recibe las credenciales del dueño.

Todos los puertos se publican sólo en `127.0.0.1`. La web llama siempre a la ruta relativa `/api/v1`; el proxy de desarrollo ([`apps/web/proxy.conf.cjs`](apps/web/proxy.conf.cjs)) la envía a `API_PROXY_TARGET` (`http://api:3000` en Compose). Ambos contenedores detectan cambios de código por polling, porque los bind mounts de Windows/macOS no entregan eventos de archivos.

#### Primer superadministrador y primera organización (`CORE-04`)

Nadie puede llamar a la API antes de que exista un superadministrador, así que el primero se crea con un CLI que usa la conexión del dueño de la base (desde la raíz del repo, PowerShell o Git Bash):

```powershell
docker compose run --rm --no-deps db-migrate node apps/api/scripts/create-platform-admin.mjs --email admin@example.com --name "Ada Admin" --password "una-clave-de-12-o-mas"
```

Es idempotente: si el email ya existe sólo lo promueve (no cambia su contraseña). Con `NODE_ENV=production` se niega a correr salvo que se pase `--allow-production`, y nunca imprime la contraseña.

Después, iniciá sesión y creá la organización con su dueño (PowerShell):

```powershell
$api = "http://localhost:3000/api/v1"
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType "application/json" -Body (@{ email = "admin@example.com"; password = "una-clave-de-12-o-mas" } | ConvertTo-Json)
$body = @{ name = "Feria Norte"; slug = "feria-norte"; owner = @{ email = "duena@example.com"; fullName = "Ana Dueña"; password = "otra-clave-larga" } } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$api/tenants" -Headers @{ Authorization = "Bearer $($login.accessToken)" } -ContentType "application/json" -Body $body
```

Responde `201` con `{ id, name, slug, owner: { userId, email, created } }`; el dueño ya puede iniciar sesión. Si el email del dueño ya tenía cuenta se reutiliza (`created: false`) y su contraseña no cambia. Un slug repetido responde `409 TENANT_SLUG_TAKEN`.

### 3. Con npm (sin contenedores de apps)

```bash
npm ci
docker compose up -d postgres redis s3   # dependencias de la API
npm run db:setup --workspace api         # rol juntta_app + migraciones (DATABASE_MIGRATION_URL)
npm run dev:api                          # API en :3000 como juntta_app, lee ../../.env
npm run dev:web                          # web en :4200; proxy a http://localhost:3000 por defecto
```

Si las dependencias del contenedor `api` o `web` quedan desactualizadas después de cambiar `package.json` (volúmenes `*_node_modules`), reinstalarlas dentro del contenedor:

```bash
docker compose exec -w /workspace api npm ci --workspace api --include-workspace-root=false
```

## Verificación

| Qué | Comando |
| --- | --- |
| Lint (API y web, oxlint) | `npm run lint` |
| Tests API (unitarios) | `npm test --workspace api` |
| Tests API (e2e del bootstrap) | `npm run test:e2e --workspace api` |
| Tests API (integración con PostgreSQL real, base `<db>_test` descartable) | `npm run test:int --workspace api` (o `docker compose run --rm --no-deps db-migrate npm run test:int --workspace api`) |
| Nueva migración desde `src/db/schema.ts` | `npm run db:generate --workspace api` (SQL manual: `npx drizzle-kit generate --custom --name=<nombre>`) |
| Tests web (unitarios, Vitest) | `docker compose exec -w /workspace/apps/web web npx ng test --watch=false` |
| Proxy de desarrollo | `npm run test:proxy --workspace web` |
| E2E web (Playwright, con el stack levantado) | `npm run e2e --workspace web` |
| Script de entorno | `node --test scripts/init-local-env.test.mjs` |
| Compose | `docker compose config --quiet` |

En Windows con Git Bash, anteponer `MSYS_NO_PATHCONV=1` a los `docker compose exec -w …`.

## Seguridad

- No versionar `.env`, tokens de Mercado Pago, credenciales ni secretos; los errores de configuración nombran la variable, nunca su valor.
- El backend es la fuente de verdad de disponibilidad, precios, pagos y adjudicaciones; nunca se acepta un precio enviado por el frontend.
- El código de dominio debe contemplar aislamiento por tenant, idempotencia, Webhooks verificados y restricciones de concurrencia (§6–§8 de la especificación).

## Convenciones

- Rama de integración: `develop`. Commits con [Conventional Commits](https://www.conventionalcommits.org/).
- Cambios de producto con OpenSpec: proposal, design, specs y tasks en `docs/openspec/changes/`, archivados al cerrar.
- Las modificaciones de una plantilla de plano no cambian los planos ya publicados.

## Roadmap

Detalle y dependencias en [§10.1](docs/openspec/specification.md#101-plan-de-ejecución-y-subtareas) y [§11](docs/openspec/specification.md#11-roadmap) de la especificación:

1. Core multi-tenant y autenticación (`CORE-01..03`).
2. Predios y planos versionados (`VEN-01`, `LAY-01`).
3. Eventos, stands, tarifas y expositores (`EVT-01`, `EXH-01`).
4. Reservas y pagos con Mercado Pago (`RES-01`, `PAY-00..07`).
5. Portal público (`PUB-01`).
6. Reportes, hardening, E2E y piloto (`REP-01`).
