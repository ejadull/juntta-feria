# Tasks: Vistas Feriante y Visitante

Convenciones de §10.1. TDD en dominio, componentes y páginas.

```
PUB-UI-01 ─> PUB-UI-02 ─> PUB-UI-03 ─┬─> PUB-UI-04 ─┐
                                      └─> PUB-UI-05 ─┴─> PUB-UI-06
```

### PUB-UI-01 — Shell con áreas y "Ver como"

- **Estado:** `VERIFIED`
- **Entrega:** `AppShell` con navegación por área y selector de demo; rutas `/feriante/*` y `/ferias/*`; marcadores de reserva.
- **Aceptación:** escenarios "Ver como" y "Marcadores de reserva".
- **Evidencia:**
  - 2026-10-30: `app.routes.spec.ts` (10 tests): área feriante con su navegación, cambio de área desde "Ver como", "Ferias" y "Mapa y expositores" activos por separado, marcadores con `RES-01` y sin importes.
  - 2026-10-30: un solo `AppShell` padre de las tres áreas (`features/shell/app-shell.ts`, ex `OrganizerShell`); `ReservationsPlaceholderPage` reutilizado con textos por `data` de ruta.
  - Hallazgo: con `withComponentInputBinding` los inputs ausentes en la ruta quedan en `undefined` y pisan los defaults; por eso los inputs del marcador son `required` y cada ruta pasa todos sus textos (cubierto por test de ruta).

### PUB-UI-02 — Contratos y adaptador público

- **Estado:** `VERIFIED`
- **Entrega:** `PublicCatalogRepository` (D3) y adaptador en memoria coherente con el Panel y el plano demo.
- **Aceptación:** conteos 12/3/23/2; sin datos privados.
- **Evidencia:**
  - 2026-10-30: `in-memory-public-catalog.repository.spec.ts` (5 tests): conteos 12/3/23/2, directorio sólo con perfiles con consentimiento, evento inexistente → `PublicEventNotFoundError`.

### PUB-UI-03 — Dominio de filtros y `stand-map`

- **Estado:** `VERIFIED`
- **Entrega:** `stand-filters.ts` y componente `stand-map` (D4/D5).
- **Aceptación:** escenarios "Estados sin depender del color", "Sectores" y "Filtros".
- **Evidencia:**
  - 2026-10-30: `stand-filters.spec.ts` y `stand-map.spec.ts` (8 tests): botón accesible por stand, rayado + 🔒 en bloqueado, contornos de sector, chips con conteo que atenúan sin ocultar, selección por click/Enter/Espacio, zoom.

### PUB-UI-04 — Feriante · Explorar stands

- **Estado:** `VERIFIED`
- **Entrega:** `ExploreStandsPage`.
- **Aceptación:** escenarios "Elegí tu stand" y "Lista equivalente".
- **Evidencia:**
  - 2026-10-30: `explore-stands.page.spec.ts` (7 tests): plano + lista de 12 disponibles, filtro por sector (lista filtrada, plano atenuado), límites de precio y superficie tomados de los datos, lista → plano y detalle con precio final, "Reservar" deshabilitado con `RES-01`, stand no disponible sin acción, error de carga.
  - Limitación del demo: todos los stands miden 9 m², así que superficie ofrece una sola opción; la lógica está cubierta en `stand-filters.spec.ts`.

### PUB-UI-05 — Visitante · Ferias y mapa

- **Estado:** `VERIFIED`
- **Entrega:** `FairsPage`, `FairMapPage`.
- **Aceptación:** escenarios "Catálogo", "Directorio público" y "Ficha de stand".
- **Evidencia:**
  - 2026-10-30: `fairs.page.spec.ts` (4 tests): tarjetas con lugar, fechas y disponibilidad; búsqueda "neuquen" sin acentos; estado vacío; enlace al mapa sólo con mapa público.
  - 2026-10-30: `fair-map.page.spec.ts` (5 tests): nombre, plano y directorio; sin expositores sin consentimiento ni datos privados; ficha de stand con expositor público; ubicar expositor en el plano; feria sin mapa público.
  - `fold()` (búsqueda sin acentos) movido a `shared/text.ts`, compartido con Expositores.

### PUB-UI-06 — E2E, accesibilidad y cierre

- **Estado:** `VERIFIED`
- **Aceptación:** axe sin serias/críticas en las 5 pantallas nuevas; sin scroll horizontal a 390 px; suites existentes sin regresiones.
- **Evidencia:**
  - 2026-10-30: `ng test --watch=false` → 266/266 en verde.
  - 2026-10-30: Playwright `e2e/` → 6/6 (3 nuevos en `public-catalog.e2e.ts`: "Ver como", filtro + lista → plano, búsqueda + ficha pública).
  - 2026-10-30: verificación en Chromium contra el stack Compose, 60/60: en 1440×900 y 390×844, las 5 pantallas con su `h1`, ítem activo correcto, sin scroll horizontal y **axe-core 4.10.3 sin violaciones serias/críticas**; teclado en el plano; sin datos privados; sin errores de consola.
  - 2026-10-30: sin regresiones: shell del organizador 50/50, `LUI-06` 25/25, `LUI-07` 16/16, `LUI-08` 22/22, `UX-01` 5/5.
- [x] E2E y axe en las 5 pantallas.
- [x] Actualizar §10.1.
- [ ] Archivar el change (pendiente de aprobación del commit).
