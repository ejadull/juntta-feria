# Design: Shell del organizador, Panel y Expositores

## Contexto

Mismo enfoque que `lay-ui-floor-plan-editor`: features Angular por dominio, patrón contenedor-presentacional, signals + `OnPush`, puertos abstractos (también token de DI) con adaptador en memoria provisto a nivel de ruta. El adaptador HTTP llega con el backend sin tocar componentes.

## Decisiones

### D1 — Rutas y shell

```
/                                  → redirect /organizador/panel
/organizador                       → OrganizerShell (layout con <router-outlet>)
  panel                            → DashboardPage (P03)
  layouts/:versionId/editor        → LayoutEditorPage (P06, existente)
  reservas                         → ReservationsPlaceholderPage (P10, marcador)
  expositores                      → ExhibitorsPage (P11)
**                                 → página "No encontrada"
```

- El shell es un componente de layout: marca, tarjeta de organización, navegación con `routerLinkActive` + `aria-current="page"`, aviso "Demo de UX: datos ficticios" y `<main>` con el contenido.
- Escritorio (≥ `lg`): navegación lateral fija como el mockup. Móvil: barra superior con la navegación desplazable horizontalmente; sin menú hamburguesa (4 ítems).
- El editor ocupa el alto disponible del `<main>` (`h-full` en lugar de `h-dvh`).
- Organización y evento son constantes de demostración (`DEMO_CONTEXT`) hasta `CORE-02`/`EVT-01`; el link "Editor de plano" apunta a la versión del evento demo.

### D2 — Modelo de lectura del Panel

`GET /api/v1/events/:id/metrics` (§5) devuelve:

```ts
interface EventMetricsDto {
  eventId: string;
  eventName: string;
  venueName: string;
  startsAt: string;          // ISO 8601 UTC
  endsAt: string;
  layoutVersionId: string;   // para "Abrir editor de plano"
  sellableStands: number;    // event_stands no DISABLED
  blockedStands: number;     // BLOCKED
  assignedStands: number;    // ASSIGNED (reserva CONFIRMED)
  approvedGmvCents: number;  // pagos aprobados; BIGINT en DB, seguro hasta 2^53 en JS
  currency: 'ARS';
  activeReservations: number;      // HELD + PAYMENT_PENDING
  reconciliationPending: number;
  gmvByMonth: { month: string; cents: number }[]; // month = 'YYYY-MM'
}
```

- Ocupación = `assignedStands / sellableStands` (KPI §1.4), calculada en el frontend con función pura; `sellableStands = 0` ⇒ "—".
- Importes en centavos enteros (§0); formato con `Intl.NumberFormat('es-AR', { currency: 'ARS' })` en notación compacta para tarjetas ("$ 2,4 M") y completa en la tabla.
- Se rotula "GMV: venta cobrada por el organizador, no ingreso SaaS" (§1.4 distingue GMV de ingreso SaaS).

### D3 — Gráfico GMV accesible

- Barras en SVG propio (sin dependencias), una por mes; el último mes resaltado. Cada barra lleva su valor como texto (no depende del color).
- Alternativa equivalente: `<table>` con mes e importe dentro de `<details>` ("Ver datos"), cumpliendo §14 "mapa y lista equivalentes" aplicado a gráficos.

### D4 — Modelo de lectura de Expositores

Endpoint nuevo `GET /api/v1/exhibitors` (operator, tenant del token):

```ts
type DocumentsStatus = 'MISSING' | 'PENDING' | 'APPROVED' | 'REJECTED';
interface ExhibitorSummaryDto {
  id: string;
  tradeName: string;
  legalName: string;
  taxId: string | null;          // privado: solo organizador (INV-08)
  category: string;              // nombre del rubro (category_id resuelto)
  description: string;
  publicContactOptIn: boolean;
  documentsStatus: DocumentsStatus; // peor estado de documents.review_status; MISSING si no hay
}
```

- Lista con búsqueda (nombre comercial, razón social, rubro; sin mayúsculas ni acentos), filtros por rubro y por estado de documentación, contador "N de M".
- Ficha con todos los campos; estado de documentación con ícono + texto. "Contacto público: sí/no" explica qué se ve en el directorio público.
- Sin acciones de escritura en este change.

### D5 — Reservas y cobros

Página marcador: qué va a mostrar (P10, P12), de qué tareas depende (`RES-01`, `PAY-01`) y por qué no se simula. Sin datos.

### Estructura de archivos

```
apps/web/src/app/
  app.routes.ts                       # redirect + /organizador con children lazy
  shared/demo-context.ts              # organización/evento demo (hasta CORE-02/EVT-01)
  shared/money.ts                     # formatArs(cents, compact?)
  features/organizer-shell/organizer-shell.ts
  features/dashboard/
    data/event-metrics.repository.ts       # puerto + DTO
    data/in-memory-event-metrics.repository.ts
    domain/occupancy.ts                    # ocupación pura
    ui/kpi-card.ts
    ui/gmv-chart.ts
    dashboard.page.ts
  features/exhibitors/
    data/exhibitor.repository.ts           # puerto + DTO
    data/in-memory-exhibitor.repository.ts
    ui/exhibitor-detail.ts
    exhibitors.page.ts
  features/reservations/reservations-placeholder.page.ts
  features/not-found.page.ts
```

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El contrato de métricas cambia con `REP-01` | DTO plano y versionado en §5; un solo adaptador a reemplazar |
| Datos de demo confundidos con reales | Rótulo "Datos de demostración" en cada pantalla y en el shell |
| GMV mal interpretado como ingreso de la plataforma | Texto explícito bajo el KPI y el gráfico (§1.4) |
| Exponer datos privados del expositor | Solo vistas de organizador; el directorio público (`PUB-01`) usa otro DTO |
| `sector` ausente del modelo | No se muestra "Ocupación por sector"; decisión de spec pendiente |
