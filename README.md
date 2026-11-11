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

1. El organizador crea un predio (Predios) y su plano reusable (Editor de plano).
2. Crea un evento sobre una versión publicada del plano (Eventos), carga sectores y tarifas por stand y lo publica (sólo propietarios y administradores).
3. El feriante elige un stand disponible y crea una reserva temporal.
4. Se inicia el checkout de Mercado Pago.
5. La API valida la notificación, consulta el pago y adjudica el stand si corresponde.
6. El visitante explora el mapa de expositores del evento.

## Roles, áreas y acceso

> **Importante:** la web muestra menús y permite rutas **según el rol del usuario en la organización activa**. No hay selector "Ver como": el área sale de la sesión ([`area.ts`](apps/web/src/app/shared/auth/area.ts), `SessionStore.area`).

| Área | Quién entra | Rol en la organización activa | Rutas | Inicio |
|---|---|---|---|---|
| **Organizador** (administración) | Dueños y equipo de la organización | `OWNER`, `ADMIN`, `OPERATOR` | `/organizador/**` | `/organizador/panel` |
| **Feriante** | Expositores invitados | `EXHIBITOR` | `/feriante/**` | `/feriante/explorar` |
| **Visitante** | Cualquiera, sin sesión | — | `/ferias/**` | `/ferias` |

- **Menú:** cada usuario ve sólo el menú de su área; el bloque *Sesión* muestra "Área: …". Sin sesión se ve el menú de visitante y el botón "Ingresar".
- **Rutas protegidas** (`areaGuard` en [`auth.guard.ts`](apps/web/src/app/shared/auth/auth.guard.ts)): sin sesión, `/organizador/**` y `/feriante/**` llevan a `/ingresar?volver=<ruta>` y vuelven ahí después de ingresar con Google. Con sesión pero con otro rol, redirigen al inicio del área propia: un feriante que abre `/organizador` vuelve a `/feriante/explorar`, y al revés.
- **Raíz `/`:** lleva al inicio del área según el rol (sin sesión, a `/ferias`).
- **Públicas para todos:** `/ferias/**`, `/ingresar` y `/invitacion/:token`.
- **Varias organizaciones:** quien pertenece a más de una elige la organización activa en el bloque *Sesión*. Si ahí tiene otro rol, cambia el área y la web va a su inicio. Con roles mixtos se arranca en la organización donde es feriante.
- **Usuario sin organizaciones:** se trata como visitante (con "Salir").
- **Las pantallas del organizador ya no se ven sin ingresar.** Para probarlas hace falta una cuenta con rol de organizador; con el sandbox es el email que pasaste en `bootstrap-sandbox.mjs --organizer`.
- **La API es la autoridad:** la web sólo oculta menús y redirige. Cada endpoint vuelve a validar sesión, organización (`X-Tenant-Id`) y rol; el menú no es un control de acceso.
- **Superadministrador de la plataforma** (`users.is_platform_admin`, ver *Primer superadministrador y primera organización*): todavía no tiene área en la web; opera por API (por ejemplo `POST /api/v1/tenants`).
- **Pruebas:** en unit tests `signedInAs('OWNER' | 'EXHIBITOR' | memberships)` ([`testing.ts`](apps/web/src/app/shared/auth/testing.ts)); en e2e `mockApi(page, { role: 'OWNER' })`.

## Temas de color

La web trae cinco paletas; se eligen en la lista **Tema de colores** de la barra lateral y se recuerdan por navegador (`localStorage`, clave `juntta.theme`). El tema se aplica antes de que arranque Angular, así que no parpadea.

| Tema | Referencia | Carácter |
|---|---|---|
| **Grafito** (por defecto) | [`docs/paleta2.webp`](docs/paleta2.webp) | Oscuro: negro metálico, gris niebla, naranja fundido |
| Clásico | [Design System v1](docs/design/juntta-design-system-v1.md) | La paleta original |
| Corporativo | [`docs/paleta1.webp`](docs/paleta1.webp) | Azul corporativo, teal, verde gestión, dorado ocre |
| Industrial Neon | — | Frost white, gunmetal, laser lime; barra lateral, métricas y contador oscuros |
| Matcha Organic | — | Matcha latte, ivory cream, cherry pop |

- Los temas sólo cambian **tokens** (`--color-*` en [`styles.css`](apps/web/src/styles.css), bloques `:root[data-theme='…']`). Los componentes no usan colores fijos: usan tokens, y así todos los temas se aplican solos.
- Tokens de contraste: `--color-on-primary` (texto sobre el color primario) y `--color-primary-strong` (el primario usado como texto). Hacen falta porque algunos acentos (lime, cherry, naranja) no se leen como texto o con texto blanco.
- **Accesibilidad:** [`themes.e2e.ts`](apps/web/e2e/themes.e2e.ts) pasa axe (contraste incluido) en 10 pantallas por cada tema. Un tema nuevo se agrega a esa lista, a `THEMES` en [`theme.ts`](apps/web/src/app/shared/theme.ts) y al script de `index.html`.

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
| 2. Configurar ambiente | Credenciales de prueba de la aplicación (selector *Prueba*): Access Token → `MP_ACCESS_TOKEN`, Public Key → `MP_PUBLIC_KEY` (la usa el Wallet Brick en modo `preferences`), `MP_CHECKOUT_API=preferences\|orders` (por defecto `preferences`, ver abajo), Client ID/Secret → `MP_CLIENT_ID`/`MP_CLIENT_SECRET`, `MP_ENVIRONMENT=sandbox`. SDK `mercadopago` en la API. |
| 3. Order | `POST /reservations/{id}/checkout` (PAY-02) crea una order (`POST /v1/orders`, `type: online`, `processing_mode: manual`) con monto congelado, `external_reference`, `payer` (el feriante logueado), `expiration_time` = lo que resta del hold y `X-Idempotency-Key` = id del intento: un reintento tras un timeout devuelve la misma order. `retries.allowed: true`: tras un rechazo se reintenta sobre la misma order. |
| 4. URLs de retorno | `config.online.{success,pending,failure}_url` a `/feriante/reservas/{id}/pago/{aprobado\|pendiente\|rechazado}`; `auto_return` solo con `success_url` https (PAY-04). |
| 5. Redirección | La web redirige al `checkout_url` de la order (`checkoutUrl`); `wallet` es siempre `null`: no hay Wallet Brick. |
| 6. Notificaciones | La clave de firma va en `MP_WEBHOOK_SECRET` (PAY-03) y la URL https de `/api/v1/webhooks/mercadopago` (en local, un túnel como `cloudflared`) en el panel. Según `MP_CHECKOUT_API`: **`preferences`** (por defecto) → activá el evento **Pagos** (topic `payment`); el tenant viaja en `?tenant=` de `MP_NOTIFICATION_URL`, que se envía en cada preferencia. **`orders`** → activá **Order (Mercado Pago)** (topic `order`/`orders`); la URL no lleva `?tenant=` (el tenant sale de nuestro `order id`) y `MP_NOTIFICATION_URL` no se usa. |
| 7. Pruebas | En *Cuentas de prueba* creá un **vendedor** (organizador, que vincula su cuenta en `/organizador/mercado-pago`) y un **comprador** (feriante). Pagá siempre con el comprador de prueba. |
| 8. Producción | Activá las credenciales productivas, reemplazá Access Token/Public Key, `MP_ENVIRONMENT=production` y HTTPS obligatorio. |

**Suscripción del feriante a la plataforma (`EXH-05`).** Se cobra en la cuenta de la plataforma con `preapproval` (no con el OAuth del organizador):

- `PLATFORM_SUBSCRIPTION_PRICE_CENTS`: precio mensual en centavos de ARS (entero > 0). Sin él, `POST /api/v1/me/subscription` responde 503. Usa el `MP_ACCESS_TOKEN` de la plataforma en cualquier ambiente.
- En el panel de la aplicación, además de *Order (Mercado Pago)*, activá el webhook de **Suscripciones** (`subscription_preapproval` y `subscription_authorized_payment`) con la misma URL `/api/v1/webhooks/mercadopago` **sin** `?tenant=`; la firma se valida con `MP_WEBHOOK_SECRET`.
- Sandbox: sin plan, Mercado Pago rechaza el cobro si la cuenta que paga no tiene el email del `payerEmail`. Enviá **el email del comprador de prueba** (`{ "payerEmail": "..." }`), no el de la cuenta Juntta. Para probar el flujo real: `bootstrap-sandbox.mjs --no-subscription`, luego `sandbox-checkout.mjs subscribe <email del comprador>` y, tras autorizar, `sandbox-checkout.mjs notify-subscription <preapproval_id>`.

Los valores nunca se versionan ni se pegan en issues: sólo los nombres de las variables. `MP_TOKEN_ENCRYPTION_KEY` son 32 bytes en base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Sin cuenta vinculada, `sandbox` usa `MP_ACCESS_TOKEN` y `production` deja los pagos apagados.

#### Ingresar con Google (`CORE-05`)

El alta y el ingreso son **sólo con Google**: la web no tiene formulario de usuario y contraseña. Sin `GOOGLE_CLIENT_ID`, `POST /api/v1/auth/google` responde 503 `GOOGLE_SIGN_IN_UNAVAILABLE` y `/ingresar` avisa que no está disponible. Sólo entran cuentas que ya existen (o que se crean aceptando una invitación con Google); nunca se crea un usuario desde un ingreso con Google. Una cuenta "pendiente" (sólo email, sin contraseña ni `google_sub`) se vincula a Google en su primer ingreso, por email verificado ([ADR 0008](docs/adr/0008-google-sign-in.md)).

**`AUTH_PASSWORD_ENABLED`** (por defecto `false`) es una válvula de escape para pruebas y desarrollo: con `true` la API vuelve a aceptar `POST /auth/login` y el alta de feriante con contraseña (la web sigue sin formulario). Apagado, esas rutas responden 403 `PASSWORD_SIGN_IN_DISABLED`. Docker Compose no lo enciende. Las cuentas con contraseña que ya existían en una base dejan de poder ingresar por la web, salvo que su email coincida con una cuenta de Google: se vinculan por email en el primer ingreso con Google.

1. En [Google Cloud Console](https://console.cloud.google.com/) elegí o creá un proyecto.
2. *APIs y servicios* → *Pantalla de consentimiento de OAuth*: tipo *Externo*, nombre de la app y tu email; los scopes por defecto (`openid`, `email`, `profile`) alcanzan. Mientras esté en *Prueba*, agregá como *usuarios de prueba* los emails que vayan a ingresar.
3. *APIs y servicios* → *Credenciales* → *Crear credenciales* → *ID de cliente de OAuth*:
   - Tipo de aplicación: **Aplicación web**.
   - *Orígenes autorizados de JavaScript*: `http://localhost:4200` (y más adelante el origen de producción, con HTTPS).
   - *URI de redireccionamiento autorizados*: **ninguno**; Google Identity Services entrega un ID token al navegador y no usa redirección.
4. Copiá el *ID de cliente* (`123-abc.apps.googleusercontent.com`; el secreto del cliente no se usa) en `.env` como `GOOGLE_CLIENT_ID=...` y recreá la API: `docker compose up -d --force-recreate api`.
5. La web lo descubre en `GET /api/v1/auth/providers` (`{ "google": { "clientId": "..." } }`, o `null`), así que no necesita variables de build. Probalo en `http://localhost:4200/ingresar`.

Un cambio de origen (otro puerto, `127.0.0.1` en lugar de `localhost`) requiere agregarlo a los orígenes autorizados: si no, el botón no aparece o Google rechaza el ingreso.

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
docker compose run --rm --no-deps db-migrate node apps/api/scripts/create-platform-admin.mjs --email admin@gmail.com [--name "Ada Admin"]
```

`--email` es la **cuenta de Google** del administrador: se crea un usuario pendiente, sin contraseña, que se vincula a Google en su primer ingreso en `/ingresar`. Es idempotente: si el email ya existe sólo lo promueve. Con `NODE_ENV=production` se niega a correr salvo que se pase `--allow-production`.

Después, ingresá con Google en la web y creá la organización con `POST /api/v1/tenants` (por ejemplo desde Swagger con el access token de la sesión). El dueño se da de alta sólo con su email, sin contraseña (queda pendiente y se vincula a Google en su primer ingreso):

```json
{ "name": "Feria Norte", "slug": "feria-norte", "owner": { "email": "duena@gmail.com", "fullName": "Ana Dueña" } }
```

Responde `201` con `{ id, name, slug, owner: { userId, email, created } }`. Si el email del dueño ya tenía cuenta se reutiliza (`created: false`). Un slug repetido responde `409 TENANT_SLUG_TAKEN`. Con `AUTH_PASSWORD_ENABLED=false`, enviar `owner.password` responde 403 `PASSWORD_SIGN_IN_DISABLED`.

#### Sandbox de pagos (`bootstrap-sandbox.mjs`)

```powershell
docker compose run --rm --no-deps db-migrate node apps/api/scripts/bootstrap-sandbox.mjs --organizer vos@gmail.com --exhibitor otra@gmail.com [--no-subscription]
```

Crea la organización de prueba con esos dos usuarios **sin contraseña** (pendientes: se vinculan a Google en su primer ingreso). Sin `--organizer`/`--exhibitor` crea usuarios ficticios `@sandbox.test` que no pueden ingresar por la web (sólo Google); `sandbox-checkout.mjs` funciona igual, porque en lugar de iniciar sesión firma un access token con `AUTH_ACCESS_TOKEN_SECRET` (corre dentro del contenedor `api`). Si tenés un estado viejo (`.sandbox-state.json` sin ids), volvé a correr el bootstrap.

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
- **API pública sin autenticación (`PUB-01`):** `GET /api/v1/public/events`, `/public/events/:slug`, `/public/events/:slug/map` y `/public/events/:slug/exhibitors` no piden sesión ni `X-Tenant-Id`. Exponen sólo eventos publicados o activos de organizaciones activas (nombre, fechas, predio, sectores, estado de cada stand, precio) y, con consentimiento explícito, nombre, rubro y descripción de los expositores con stand confirmado. Nunca emails, teléfonos, razón social, CUIT, reservas ni pagos; un borrador responde 404. Los datos salen de funciones `SECURITY DEFINER` mínimas (migración `0019`) y de consultas con columnas explícitas bajo RLS. Respuestas con `Cache-Control: public` (60 s; el mapa, 15 s).
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
