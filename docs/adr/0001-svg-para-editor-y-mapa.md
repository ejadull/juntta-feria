# ADR 0001 — SVG para el editor de plano y el mapa público

- **Estado:** aceptado
- **Fecha:** 2026-10-30
- **Contexto de decisión:** change [`lay-ui-floor-plan-editor`](../openspec/changes/archive/2026-10-30-lay-ui-floor-plan-editor/design.md) (D1), tarea `LUI-01`.
- **Reemplaza:** la mención "Konva.js o Fabric.js" de la spec §2.

## Contexto

El editor P06 y el mapa público P15 dibujan el mismo plano: un predio en metros con stands, pasillos, accesos y obstáculos. Volumen objetivo del MVP: hasta 500 stands por versión (§9, §12). Requisitos que condicionan la tecnología:

- Coordenadas persistidas en metros, nunca píxeles (§2); el render no puede alterar la geometría al hacer zoom (AC-01).
- Mapa navegable con teclado, lista alternativa sincronizada y estados que no dependan solo del color (§8, UX).
- Testeable en jsdom con Vitest, sin navegador real, para sostener TDD en `ui/`.
- Angular con signals y `OnPush`; sin dependencias pesadas si no son necesarias.

## Decisión

Usar **SVG nativo renderizado por Angular** para editor y mapa público. 1 unidad SVG = 1 metro; el zoom y el pan solo cambian el `viewBox`. Cada objeto es un `<g>` con `role`, `aria-label` y patrón de trazo por `kind`. La conversión pantalla → plano es una función pura (`screenToPlan`) y no depende de `getScreenCTM`.

## Alternativas consideradas

| Opción | A favor | En contra |
|---|---|---|
| **SVG nativo (elegida)** | DOM accesible (foco, ARIA, lectores de pantalla); estilos CSS; selección y eventos por elemento; testeable en jsdom; sin dependencias. | Rendimiento degrada con miles de nodos; transformaciones manuales. |
| Konva.js (canvas) | Muy rápido con muchos objetos; drag/transformer incluidos. | Canvas no es accesible: hay que duplicar un árbol ARIA paralelo; jsdom no tiene canvas (tests con mocks o navegador); dependencia extra. |
| Fabric.js (canvas) | Edición rica (rotación libre, agrupado, serialización). | Mismos problemas de accesibilidad y testeo que Konva; modelo de objetos propio que compite con el dominio en metros; dependencia mayor. |

## Consecuencias

- **Accesibilidad:** el mismo DOM sirve para teclado y lectores de pantalla (base de `LUI-08`); no hace falta un árbol accesible paralelo.
- **Testeo:** render, selección y gestos se prueban en jsdom; la verificación en navegador se automatiza con Playwright (evidencia de `LUI-06`).
- **Rendimiento:** objetivo de 500 stands sin frames > 50 ms durante el drag; se mide en `LUI-09`.
- **Código propio:** gestos (pan, pinch, rueda) y handles de redimensionado son responsabilidad nuestra (`ui/floor-plan-canvas`).

## Criterio de reapertura

Reabrir este ADR y evaluar canvas/WebGL (Konva, PixiJS) si ocurre cualquiera de estos casos:

- Planos reales con **más de 2000 objetos**, o `LUI-09` no cumple el objetivo con 500 stands después de optimizar.
- Necesidad de **fondos raster pesados** (planos escaneados, imágenes de alta resolución) como capa base.

Si se reabre, el reemplazo debe conservar una capa accesible equivalente (lista sincronizada y foco por objeto).

## Seguimiento

- 2026-10-30 (`LUI-09`): con 500 stands en desktop, ningún frame supera 50 ms en drag, pan ni zoom (peor caso 36 ms, build de desarrollo). La decisión se mantiene. Con CPU ×4 el costo dominante es el render nativo del SVG (~4300 nodos): vigilar en el mapa público móvil (P15).
