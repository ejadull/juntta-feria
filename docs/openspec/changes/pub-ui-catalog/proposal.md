# Proposal: Vistas Feriante y Visitante (catálogo y mapa público)

- **Change ID:** `pub-ui-catalog`
- **Estado:** `IN_PROGRESS`
- **Fecha:** 2026-10-30
- **Pantallas:** P14 Catálogo público, P15 Mapa público, P16 Detalle de stand/expositor, exploración de stands del feriante (§4.2); P18–P20 solo como marcadores
- **Épicas:** EP08 Portal público, EP05 Feriantes (consulta)

## Por qué

El mockup de escritorio tiene un selector "Ver como" Organizador / Feriante / Visitante. Hoy solo existe el área del organizador (`org-ui-shell`). Faltan:

- **Feriante:** "Elegí tu stand" (filtros por sector, superficie y precio; plano con estados; lista equivalente), "Reserva y pago" y "Mis reservas".
- **Visitante:** "Ferias" (buscador y tarjetas de eventos) y "Mapa y expositores".

Las vistas de consulta se pueden construir ya con contratos de lectura y adaptadores en memoria (como el Panel). Reserva y pago dependen de holds, concurrencia, idempotencia y Mercado Pago (`RES-01`, `PAY-01`): siguen como marcadores, sin flujos simulados.

## Qué cambia

- **ADDED** capacidad `public-catalog`:
  - Selector de área **de demostración** "Ver como" en el shell; navegación por área.
  - Visitante: catálogo de ferias con búsqueda; mapa público con estados, contorno de sectores derivado (ADR 0002) y directorio de expositores con fichas públicas consentidas (INV-08, AC-11).
  - Feriante: exploración de stands con filtros, plano y lista equivalente (AC-12), detalle de stand con precio final.
  - Marcadores "Reserva y pago" y "Mis reservas" (`RES-01`/`PAY-01`).
- Puerto `PublicCatalogRepository` ↔ `GET /api/v1/public/events`, `/public/events/:slug/map`, `/public/events/:slug/exhibitors` (§5).
- Componente de solo lectura `stand-map` (no reutiliza el canvas del editor: el editor no conoce estados comerciales, INV-03).

## Fuera de alcance

- Crear holds, checkout y comprobantes (P18–P20; `RES-01`, `PAY-01`).
- "Recordarme" (notificaciones) y fotos de ferias (sin backend de archivos todavía).
- SSE de disponibilidad en tiempo real (`stand-events`, R6): el contrato se lee una vez.
- Autenticación real del feriante: el área se elige con el selector de demo hasta `CORE-02`.

## Impacto

- **Código:** `apps/web` (features `public-catalog`, `exhibitor-portal`; shell con áreas). Sin cambios en `apps/api`.
- **Spec:** §5 documenta los estados públicos; §10.1 suma `PUB-UI-01..06`.
- **Dependencias nuevas:** ninguna.
