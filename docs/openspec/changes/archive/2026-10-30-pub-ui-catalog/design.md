# Design: Vistas Feriante y Visitante

## D1 — Áreas y rutas

```
/organizador/*        área Organizador (existente)
/feriante/explorar    Feriante · Explorar stands   (P09 vista feriante)
/feriante/reserva     Feriante · Reserva y pago    (marcador RES-01/PAY-01)
/feriante/reservas    Feriante · Mis reservas      (marcador RES-01/PAY-01)
/ferias               Visitante · Ferias           (P14)
/ferias/:slug         Visitante · Mapa y expositores (P15/P16)
```

- Un solo shell (`AppShell`) para las tres áreas: la navegación cambia según el prefijo de URL.
- "Ver como" es un **control de demo** (rotulado así) que navega al inicio de cada área. En el producto el área sale de la sesión (`CORE-02`); el visitante no inicia sesión.

## D2 — Estados públicos de un stand

Saneados para el público (no exponen reservas ni personas):

| Estado público | Origen (`event_stands` + reserva activa) | Token UX-01 | Además del color |
|---|---|---|---|
| `AVAILABLE` "Disponible" | `AVAILABLE` sin reserva activa | `available` | etiqueta |
| `RESERVED` "Reservado" | reserva `HELD` o `PAYMENT_PENDING` | `reserved` + `reserved-stroke` | contorno punteado |
| `OCCUPIED` "Ocupado" | `ASSIGNED` (reserva `CONFIRMED` o asignación directa) | `occupied` | franja superior |
| `BLOCKED` "Bloqueado" | `BLOCKED` o `DISABLED` | `blocked` + `blocked-stroke` | rayado + candado (UX-01) |

El mockup tenía 5 estados (Retenido/Reservado separados); se sigue el design system UX-01, que define 4. Con el evento demo cuadra con el Panel: 3 reservas en curso = 3 `RESERVED`, 23 asignados = 23 `OCCUPIED`, 2 bloqueados, 12 disponibles (40).

## D3 — Contratos de lectura (§5)

```ts
interface PublicEventSummaryDto {
  slug: string; name: string; city: string; province: string; venueName: string;
  startsAt: string; endsAt: string;              // ISO 8601 UTC
  description: string;
  salesOpen: boolean;                             // false ⇒ "Venta de stands sin abrir"
  availableStands: number; totalStands: number;
  hasPublicMap: boolean;
}

// GET /public/events/:slug/map — extiende el ejemplo de §5.3
interface PublicMapDto {
  slug: string; layoutVersion: number; units: 'm';
  bounds: { width: number; height: number };
  features: {
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    properties:
      | { kind: 'STAND'; standId: string; code: string; areaM2: number; status: PublicStandStatus;
          sector: string | null; price: { currency: 'ARS'; valueCents: number };
          exhibitor: { name: string; category: string } | null }   // solo con consentimiento (AC-11)
      | { kind: 'AISLE' | 'ENTRY' | 'EXIT' | 'EMERGENCY' | 'UTILITY' | 'OBSTACLE'; label: string | null };
  }[];
}

// GET /public/events/:slug/exhibitors — solo fichas públicas consentidas (INV-08)
interface PublicExhibitorDto { name: string; category: string; description: string; standCode: string | null }
```

Nunca incluye razón social, CUIT ni contactos privados.

## D4 — `stand-map` (solo lectura)

- SVG en metros como el editor; reutiliza `viewport.ts` (zoom con rueda y botones, pan con arrastre).
- Stands por estado (D2) con código y, si hay filtro activo, los que no coinciden se atenúan (no se ocultan: el plano conserva contexto).
- Contorno de sector **derivado**: envolvente de los stands del sector + 0,6 m, punteado, con el nombre (ADR 0002).
- Cada stand es un `button` accesible (`aria-label` con código, sector, superficie, estado y precio); selección por click, Enter o Espacio.
- La lista equivalente vive en la página (AC-12), sincronizada con la selección.

## D5 — Filtros del feriante

Funciones puras: sector, superficie mínima y precio máximo. Las opciones se derivan de los datos (no hay umbrales fijos). Conteos por estado para los chips; la lista muestra solo los **disponibles** que cumplen los filtros.

## Estructura

```
features/public-catalog/
  data/public-catalog.repository.ts          # puerto + DTOs
  data/in-memory-public-catalog.repository.ts
  domain/stand-filters.ts                    # filtros, conteos, contornos de sector
  ui/stand-map/                              # plano de solo lectura
  fairs.page.ts                              # Visitante · Ferias
  fair-map.page.ts                           # Visitante · Mapa y expositores
features/exhibitor-portal/
  explore-stands.page.ts                     # Feriante · Explorar stands
features/pending-feature.page.ts             # marcadores con datos de ruta
features/shell/app-shell.ts                  # shell con áreas y "Ver como"
```
