# Juntta Feria

**Juntta Feria** es una plataforma SaaS multiempresa para organizar ferias, gestionar predios fijos e itinerantes, diseñar planos reutilizables a escala, comercializar stands, cobrar reservas con Mercado Pago y brindar un mapa público de expositores.

> **Estado:** en desarrollo, sin versión operativa. El frontend tiene las vistas de Organizador, Feriante y Visitante con **datos de demostración en memoria**. La API tiene la base operativa (configuración validada, `/api/v1`, errores `problem+json`, health checks) pero todavía **no tiene dominio, base de datos migrada ni autenticación**. El avance por tarea está en [§10.1 de la especificación](docs/openspec/specification.md#101-plan-de-ejecución-y-subtareas).

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
| Configuración y auth | entorno validado con Zod; JWT + refresh rotativo HttpOnly — [ADR 0004](docs/adr/0004-contrato-de-entorno-y-autenticacion.md) | entorno en uso; auth pendiente (`CORE-02`) |
| Persistencia | PostgreSQL 16 + PostGIS con Drizzle y SQL explícito — [ADR 0005](docs/adr/0005-drizzle-y-sql-explicito-postgis.md) | contenedor listo; migraciones pendientes (`CORE-01`) |
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

Todos los puertos se publican sólo en `127.0.0.1`. La web llama siempre a la ruta relativa `/api/v1`; el proxy de desarrollo ([`apps/web/proxy.conf.cjs`](apps/web/proxy.conf.cjs)) la envía a `API_PROXY_TARGET` (`http://api:3000` en Compose). Ambos contenedores detectan cambios de código por polling, porque los bind mounts de Windows/macOS no entregan eventos de archivos.

### 3. Con npm (sin contenedores de apps)

```bash
npm ci
docker compose up -d postgres redis s3   # dependencias de la API
npm run dev:api                          # API en :3000, lee ../../.env
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
