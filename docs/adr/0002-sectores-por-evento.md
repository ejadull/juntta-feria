# ADR 0002 — Sectores como entidad del evento

- **Estado:** aceptado
- **Fecha:** 2026-10-30
- **Resuelve:** R7 de la spec (§15).
- **Afecta:** §3.1, §3.2 (INV-09), §3.3, §4.4, §5, §10 (EP02/EP04), `EVT-01`, `REP-01`, `PUB-01`.

## Contexto

Los mockups agrupan stands por sector ("Diseño y moda", "Producción regional", "Patio gastronómico", "Servicios y oficios"), con contorno punteado en el mapa y "Ocupación por sector" en el Panel. §4.2 pide filtrar stands por sector. Pero `sector` no existía en el modelo (§3.1), y la palabra se usaba con tres significados:

| Uso | Significado | Dueño natural |
|---|---|---|
| EP02 Predios: "sectores, medidas" | Zona física del predio | Plano/predio |
| §4.2 y mockups | Agrupación temática para filtrar y medir ocupación | Evento |
| Prototipo (`Sector.pricePerM2`) | Tarifa por zona | Evento (comercial) |

Restricciones que deciden: el plano publicado es inmutable y lo reutilizan varios eventos (INV-03, AC-PRD-01, AC-PRD-02), y el editor de plano no conoce datos comerciales (`layout-editor`, "Separación entre layout y evento"). El mismo predio puede ser "Patio gastronómico" en una feria y "Diseño" en otra.

## Decisión

El sector es una **entidad del evento**:

```text
event_sectors(id, tenant_id, event_id, name, category_id NULL, sort_order)
  UNIQUE INDEX (tenant_id, event_id, lower(btrim(name)))   -- "Diseño" = "diseño "
  UNIQUE (tenant_id, event_id, id)          -- destino de la FK compuesta
event_stands.sector_id NULL
  FK (tenant_id, event_id, sector_id) → event_sectors(tenant_id, event_id, id)
  ON DELETE SET NULL (sector_id)            -- PostgreSQL ≥ 15; tenant/evento no se tocan
```

- Un stand pertenece como máximo a un sector, y solo a uno de **su** evento (INV-09; misma técnica que INV-02).
- Tarifas por sector: regla `event_pricing_rules.rule_type = 'SECTOR'` con `config.sectorId`. El precio se congela en la reserva como hoy (INV-05).
- El contorno del sector en mapas **se deriva** de sus stands (envolvente: `ST_Envelope`/`ST_ConvexHull` sobre `ST_Collect` en el backend, o cálculo en el cliente). No se dibuja ni se persiste.
- El plano (`layout_objects`) **no cambia**: no hay `kind SECTOR`.

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| `kind: SECTOR` en `layout_objects` | Ata el tema y la tarifa al plano: cambiarlos entre eventos exige otra versión del plano. Choca con AC-PRD-01 y mete datos comerciales en el editor. |
| Atributo de texto `event_stands.sector` | Sin integridad ("Gastronomía" ≠ "gastronomia"), sin lugar para orden, rubro o tarifa. |
| Híbrido: zona física en el plano + tema/tarifa por evento | Cubre todo, pero la zona física no la necesita hoy ninguna pantalla. Se agrega si aparece el caso (ver reapertura). |

## Consecuencias

- **API (§5):** `GET/POST /api/v1/events/:id/sectors` (y `PATCH`/`DELETE` del sector); asignación masiva en `PATCH /api/v1/events/:id/stands`.
- **Métricas (P03):** el DTO de `GET /events/:id/metrics` suma `occupancyBySector: { sectorId, name, assigned, sellable }[]`; el Panel reemplaza su marcador cuando exista `EVT-01`.
- **Mapa público (P15):** cada feature GeoJSON lleva `sector` (nombre) para filtrar y para dibujar el contorno derivado.
- **UX de asignación:** asignar sectores es por evento. P09 necesita selección múltiple y "copiar sectores de otro evento" para que no sea tedioso.
- **EP02/EP04:** "sectores" sale de Predios (EP02) y pasa a Eventos y tarifas (EP04).
- **Editor de plano:** sin cambios.

## Verificación

2026-10-30, PostgreSQL 16.4 del stack local, en una transacción descartada (`ROLLBACK`):

- Stand con sector de **otro** evento → rechazado por la FK compuesta (INV-09).
- Sector "diseño " cuando ya existe "Diseño" en el mismo evento → rechazado por `uq_event_sector_name`; nombre vacío → rechazado por `CHECK`; "Diseño" en otro evento → permitido.
- Borrar un sector → el stand queda con `sector_id = NULL` y conserva `tenant_id`/`event_id` (`ON DELETE SET NULL (sector_id)`).

## Criterio de reapertura

Agregar zonas físicas en el plano (opción híbrida) si aparece alguno de estos casos: zonas sin stands que deban verse en el mapa (patio, escenario), o sectores que deban mantenerse idénticos en todos los eventos de un predio sin asignación por evento.
