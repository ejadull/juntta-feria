# ADR 0003 — Monolito modular con npm workspaces

- **Estado:** aceptado
- **Fecha:** 2026-10-30
- **Tarea:** `FND-01`

## Contexto

El producto tiene una API (NestJS 12 + Fastify) y una web (Angular 22) que evolucionan juntas, comparten contratos y se ejecutan localmente con Docker Compose. El equipo es chico y el dominio todavía se está descubriendo (editor, eventos, reservas, pagos). Versiones anteriores del README proponían Nx + pnpm con `libs/` compartidas, pero el repositorio implementado usa npm workspaces.

## Decisión

- **npm workspaces** en la raíz (`apps/api`, `apps/web`) con **un único `package-lock.json`** como fuente de verdad de dependencias.
- **API como monolito modular**: un proceso NestJS con módulos por dominio (§2.1: `VenuesModule`, `LayoutsModule`, `EventsModule`, `ReservationsModule`, `PaymentsModule`…), sin acceso cruzado a tablas de otros módulos salvo por sus servicios públicos.
- **Web como workspace separado**: Angular con features por dominio, patrón contenedor-presentacional y puertos/adaptadores para hablar con la API.
- **Docker Compose construye desde la raíz** para que `npm ci` use el lockfile único (`apps/*/Dockerfile.dev`).
- **Sin worker separado todavía**: los jobs de BullMQ corren dentro del proceso de la API hasta que la carga o el aislamiento lo justifiquen.

## Alternativas consideradas

| Opción | Por qué no ahora |
|---|---|
| Nx + pnpm | Grafo de proyectos, caché y generadores valen con muchos paquetes; hoy son 2 apps. Suma una herramienta y otra convención de lockfile. |
| Microservicios | El dominio todavía cambia; las transacciones entre reservas, stands y pagos son más simples y seguras en un proceso con una base. |
| Worker de jobs separado | Agrega despliegue y observabilidad extra sin carga que lo pida. |
| Paquete `libs/shared` de tipos | Acoplaría builds; por ahora los contratos se documentan en la spec (§5) y cada app tiene su DTO. Reabrir si la duplicación duele. |

## Consecuencias

- Un solo `npm ci` reproduce el entorno; los Dockerfiles copian `package.json` de cada workspace y el lockfile raíz.
- Instalar dependencias desde Windows reescribe el lockfile: validar con `npm ci --dry-run` en `node:22-alpine` antes de commitear (visto en `LUI-10`).
- La modularidad de la API se cuida por convención y revisión; si un módulo necesita escalar aparte, se extrae a un proceso propio.

## Criterio de reapertura

Más de 4 aplicaciones o paquetes, tiempos de CI que justifiquen caché por proyecto, o un módulo con carga o despliegue independiente (p. ej. webhooks de pago o jobs pesados).
