# Proposal: Editor de plano (P06) — geometría de layout en el frontend

- **Change ID:** `lay-ui-floor-plan-editor`
- **Estado:** `ARCHIVED` (2026-10-30)
- **Fecha:** 2026-10-29
- **Pantalla:** P06 Editor canvas (§8)
- **Épica:** EP03 Editor planos (§10)

## Por qué

El editor de plano es el núcleo diferencial del producto (objetivo 1.2.1: publicar evento con plano en <30 min) y la épica de mayor riesgo técnico (40 SP). Hoy existe solo un mockup React/Lovable (`docs/juntta-feria-stand-studio`) que valida la UX pero contradice el modelo de dominio:

1. Mezcla geometría de layout con precio y estado comercial en el mismo objeto, lo que hace imposibles AC-PRD-01, AC-PRD-02 e INV-03.
2. No valida solapamientos (INV-04, AC-02).
3. Persiste rectángulo + `rotated: boolean` en lugar de `Polygon` (§3.3).
4. Los stands no son operables con teclado (§8 UX criterios).
5. Faltan crear, borrar, redimensionar, deshacer/rehacer, otros tipos de objeto y publicación.

Construir el editor desde el frontend permite validar la interacción y fijar el contrato de geometría **antes** de que existan `CORE-01..03` y `VEN-01`, sin bloquearse por ellos.

## Qué cambia

- **ADDED** capacidad `layout-editor`: edición de la geometría de una `layout_version` en estado `DRAFT`.
- Núcleo de geometría puro en TypeScript (sin Angular ni DOM): conversión rectángulo ↔ Polygon, snap, clamp, solapamiento y validación de publicación.
- Componente Angular con SVG en metros: zoom, pan, grilla, reglas, selección, mover, redimensionar, rotar 90°, duplicar, borrar y undo/redo.
- Panel de propiedades del objeto seleccionado: código, tipo, medidas y posición.
- Panel de validación que bloquea "Publicar" mientras haya errores.
- Puerto `LayoutRepository` con adaptador en memoria/mock; el adaptador HTTP llega con `LAY-01`.
- ADR: SVG en lugar de Konva/Fabric para el editor.

## Fuera de alcance

- Precio, estado comercial, expositores (P08/P09, `EVT-01`). **El editor no conoce precios.**
- Persistencia backend, migraciones y validación PostGIS (`LAY-01`).
- Polígonos arbitrarios y rotaciones no ortogonales (R3, evolución).
- Importación SVG/DXF y exportación PNG/PDF (evolución, §3.4).
- Alineación/distribución múltiple y multiselección (evolución).
- Edición colaborativa en tiempo real.

## Impacto

- **Código:** `apps/web` (nuevo feature `layout-editor`). Sin cambios en `apps/api`.
- **Spec:** §2 cambia "Konva.js o Fabric.js" por la decisión del ADR; `LAY-01` pasa a depender del contrato fijado aquí.
- **Dependencias nuevas:** ninguna.
- **Riesgos:** ver `design.md` §Riesgos.
