# Tasks: Shell del organizador, Panel y Expositores

Convenciones de §10.1: estados `PENDING` / `IN_PROGRESS` / `BLOCKED` / `VERIFIED`. TDD en funciones puras, componentes y páginas.

## Dependencias

```
ORG-01 ─┬─> ORG-02 ─> ORG-03 ─┐
        ├─> ORG-04 ─> ORG-05 ─┼─> ORG-07
        └─> ORG-06 ───────────┘
```

---

### ORG-01 — Shell y rutas

- **Estado:** `VERIFIED`
- **Dependencias:** ninguna
- **Entrega:** `features/organizer-shell`, `app.routes.ts` (D1), `shared/demo-context.ts`, página "No encontrada"; el editor dentro del shell.
- **Aceptación:** escenarios "Sección activa", "Raíz", "Ruta inexistente" y "Móvil".
- **Evidencia:** tests de componente/ruteo y E2E de humo.
  - 2026-10-30: `app.routes.spec.ts` (6 tests con `RouterTestingHarness` y las rutas reales): redirect de `/`, `aria-current="page"`, título "Expositores · Juntta Feria", editor activo para cualquier versión, 404 dentro y fuera del shell.
  - 2026-10-30: E2E `org07.mjs` (ver ORG-07): navegación por clicks en desktop y móvil.
- [x] Shell con marca, organización demo, navegación (`aria-current` por prefijo de URL, porque la URL del editor cambia con cada versión) y aviso de demo.
- [x] Rutas lazy con `title`: panel, editor, reservas, expositores, `**` (dentro y fuera de `/organizador`).
- [x] Editor con `h-full` dentro del shell.

### ORG-02 — Contrato y adaptador de métricas

- **Estado:** `VERIFIED`
- **Dependencias:** `ORG-01`
- **Entrega:** `EventMetricsRepository` + `EventMetricsDto` (D2), adaptador en memoria con el evento demo, `occupancy()` y `formatArs()` puros.
- **Aceptación:** "Ocupación", "Ocupación sin stands", "GMV en pesos".
- **Evidencia:** tests unitarios.
  - 2026-10-30: `occupancy.spec.ts` (4), `money.spec.ts` (11), `in-memory-event-metrics.repository.spec.ts` (3); 100% de cobertura.
- [x] `occupancy(assigned, sellable)` → porcentaje entero o `null`.
- [x] `formatArs(cents, { compact })` con `es-AR`; `formatArsMillions` para series con una sola unidad.
- [x] Puerto + adaptador en memoria; `EventNotFoundError` para evento inexistente.
- Fix: `Math.round((23 / 40) * 100)` daba 57 (57,4999… en punto flotante); se multiplica primero (`2300 / 40 = 57,5` → 58).
- Decisión: `Intl` compacto en `es-AR` da "$800,0 k" / "$2,4 M"; se usa un formato propio en millones ("$ 2,4 M") como el mockup.
- Decisión: los datos demo son coherentes con el plano demo (40 stands) y consigo mismos (la suma mensual = GMV aprobado). El mockup no cumplía lo segundo.

### ORG-03 — Panel (P03)

- **Estado:** `VERIFIED`
- **Dependencias:** `ORG-02`
- **Entrega:** `DashboardPage`, `KpiCard`, `GmvChart` (D3).
- **Aceptación:** todos los escenarios de "Panel del evento" y "Rótulo visible".
- **Evidencia:** tests de componentes y página.
  - 2026-10-30: `dashboard.page.spec.ts` (7): evento y fechas en zona del evento ("20–22 nov"), 4 KPIs, "—" sin stands, tabla del gráfico, link al editor, marcadores RES-01/PAY-01, error tipado.
- [x] 4 KPIs con subtítulo explicativo ("no es ingreso SaaS" bajo el GMV).
- [x] Gráfico SVG con `role="img"`, resumen accesible, valores en texto en una sola unidad y tabla en `<details>`.
- [x] Tarjetas marcador de operaciones y cobros; botón al editor.
- Desvío: "Ocupación por sector" del mockup no se muestra: `sector` no existe en §3.1 (mismo hueco que `LUI-05`). Queda explicado en la tarjeta del plano.

### ORG-04 — Contrato y adaptador de expositores

- **Estado:** `VERIFIED`
- **Dependencias:** `ORG-01`
- **Entrega:** `ExhibitorRepository` + `ExhibitorSummaryDto` (D4), adaptador en memoria; `GET /api/v1/exhibitors` en §5.
- **Aceptación:** contrato documentado; datos demo con todos los estados de documentación.
- **Evidencia:** tests unitarios del adaptador.
  - 2026-10-30: `in-memory-exhibitor.repository.spec.ts` (3): los 4 estados, un CUIT faltante, ids únicos y CUIT con patrón ficticio.
- [x] Puerto, DTO y adaptador (12 expositores ficticios del prototipo).
- [x] Fila nueva en la tabla de §5.
- Decisión: CUIT de demo con patrón `NN-000000NN-D`, imposible de confundir con uno real.

### ORG-05 — Expositores (P11, consulta)

- **Estado:** `VERIFIED`
- **Dependencias:** `ORG-04`
- **Entrega:** `ExhibitorsPage`, `ExhibitorDetail`.
- **Aceptación:** "Búsqueda", "Filtro por documentación", "Ficha", "Rótulo visible".
- **Evidencia:** tests de componentes y página.
  - 2026-10-30: `exhibitors.page.spec.ts` (6): búsqueda sin mayúsculas ni acentos ("jaboneria" → Jabonería Lafken), filtros por rubro y documentación, ficha con CUIT, "Sin CUIT cargado", lista vacía.
- [x] Búsqueda sin acentos ni mayúsculas, filtros por rubro y documentación, contador `aria-live`.
- [x] Ficha con datos privados; estado con ícono + texto; aclaración de qué ve el directorio público.

### ORG-06 — Marcador de Reservas y cobros

- **Estado:** `VERIFIED`
- **Dependencias:** `ORG-01`
- **Entrega:** `ReservationsPlaceholderPage` (D5).
- **Aceptación:** "Marcador".
- **Evidencia:** test de página.
  - 2026-10-30: `reservations-placeholder.page.spec.ts`: menciona RES-01 y PAY-01, sin listas, tablas ni importes.
- [x] Texto de dependencia y alcance futuro; sin datos.

### ORG-07 — E2E, accesibilidad y cierre

- **Estado:** `VERIFIED`
- **Dependencias:** `ORG-03`, `ORG-05`, `ORG-06`
- **Entrega:** E2E de humo de navegación en desktop y móvil, reporte axe y archivo del change.
- **Aceptación:** sin violaciones axe serias/críticas; sin scroll horizontal a 390 px; suites del editor sin regresiones.
- **Evidencia:** comandos y resultados con fecha.
  - 2026-10-30: `ng test --watch=false` → 228/228 en verde.
  - 2026-10-30: E2E `org07.mjs` en Chromium contra el stack Compose, 50/50: en 1440×900 y 390×844, las 5 pantallas (panel, editor, reservas, expositores, 404) con su `h1`, ítem activo correcto, sin scroll horizontal y **axe-core 4.10.3 sin violaciones serias/críticas**; flujos de navegación por click, búsqueda + ficha de expositor y Panel → "Abrir editor de plano"; el editor conserva espacio útil dentro del shell; sin errores de consola.
  - 2026-10-30: suites del editor dentro del shell sin regresiones: `LUI-06` 25/25, `LUI-07` 16/16, `LUI-08` 22/22.
- [x] E2E de navegación y pantallas.
- [x] axe en cada pantalla.
- [x] Actualizar §10.1.
- [x] Archivar el change (junto con `lay-ui-floor-plan-editor`, misma convención: `specs/<capacidad>/spec.md` + `changes/archive/AAAA-MM-DD-<change>/`).
