# Tasks: Editor de plano (P06)

Convenciones de §10.1: estados `PENDING` / `IN_PROGRESS` / `BLOCKED` / `VERIFIED`. TDD obligatorio en `domain/` y `state/`: test en rojo → implementación → refactor.

## Dependencias

```
LUI-01 (independiente)

LUI-02 ─┬─> LUI-03 ─┐
        └─> LUI-04 ─┴─> LUI-05 ─> LUI-06 ─┬─> LUI-07 ─> LUI-08 ─┐
                                           └─> LUI-09 ───────────┴─> LUI-10
```

`LUI-01` y `LUI-02` no dependen de nada, ni siquiera de Sprint 0A, y pueden ir en paralelo.

---

### LUI-01 — ADR editor SVG

- **Estado:** `VERIFIED`
- **Dependencias:** ninguna
- **Entrega:** ADR "SVG para editor y mapa público" en `docs/adr/` y §2 de la spec actualizado.
- **Aceptación:** el ADR registra alternativas (Konva, Fabric), criterio de reapertura (>2000 objetos o raster pesado) e impacto en accesibilidad.
- **Evidencia:** revisión documental y enlaces válidos.
  - 2026-10-30: [`docs/adr/0001-svg-para-editor-y-mapa.md`](../../../../adr/0001-svg-para-editor-y-mapa.md) con contexto, decisión, tabla de alternativas, consecuencias (accesibilidad, testeo, rendimiento) y criterio de reapertura; §2 enlaza al ADR; enlaces relativos verificados.
- [x] Redactar ADR con contexto, decisión, alternativas y consecuencias.
- [x] Reemplazar "Konva.js o Fabric.js" en §2 por referencia al ADR.

### LUI-02 — Núcleo de geometría

- **Estado:** `VERIFIED`
- **Dependencias:** ninguna
- **Entrega:** `domain/geometry.ts` y `domain/layout.types.ts`.
- **Aceptación:** escenarios "Serialización a Polygon", "Snap al mover", "Clamp en el borde" y "Polígono libre" cubiertos por tests.
- **Evidencia:** `npm test --workspace web` con cobertura ≥ 90% en `domain/geometry.ts`.
  - 2026-10-29: `ng test --watch=false --coverage` (contenedor `web`) → 19/19 tests de `geometry.spec.ts` en verde; `geometry.ts` 97.29% stmts, 95.83% branch, 100% funcs, 100% lines.
  - 2026-10-29: `apps/api` alineado a vitest/coverage-v8 `^5.0.5` + `npm dedupe`; web y api corren vitest 5.0.5 (antes web usaba 4.1.12 hoisteado por api).
- [x] Definir `LayoutObjectKind`, `LayoutObjectDto`, `LayoutVersionDto`, `Rect`, `Bounds`.
- [x] Test + impl `round2`, `snap(value, step)`, `clamp`, `clampToBounds`.
- [x] Test + impl `toPolygon(rect)` (anillo cerrado, antihorario).
- [x] Test + impl `fromPolygon(polygon)` → `Rect | null` (rechaza no rectangulares, no alineados, anillos abiertos, huecos y área cero).
- [x] Test + impl `intersectionArea(a, b)` incluyendo borde compartido = 0 (4 decimales para respetar epsilon 0.0001 m²).
- [x] Test + impl `isInside(rect, bounds)`.
- [x] Medir cobertura ≥ 90%.

### LUI-03 — Comandos de edición

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-02`
- **Entrega:** `domain/commands.ts`, con funciones puras e inmutables.
- **Aceptación:** escenarios "Rotar mantiene el centro" y "Duplicar genera código único"; ningún comando muta su entrada.
- **Evidencia:** tests unitarios, incluido uno de no mutación (`Object.freeze` sobre la entrada).
  - 2026-10-29: `ng test --watch=false --coverage` → 22/22 tests de `commands.spec.ts` en verde (43/43 totales); `commands.ts` 97.4% stmts, 92.06% branch, 100% funcs, 100% lines.
- [x] `addObject(objects, kind, at, ctx, id)`: tamaño por defecto por kind, snap + clamp y código `S01..` para `STAND`.
- [x] `moveObject(objects, id, to, ctx)` con snap + clamp.
- [x] `resizeObject(objects, id, handle, to, ctx)`: lado opuesto fijo, mínimo de 1 paso de snap, tope en el predio.
- [x] `rotate90(objects, id, ctx)` manteniendo centro y re-clamp (sin snap para conservar el centro).
- [x] `duplicateObject(objects, id, ctx, newId)`: copia adyacente (borde compartido) y `nextCode` con el prefijo de origen.
- [x] `removeObject(objects, id)`.
- [x] `updateProps(objects, id, patch, ctx)`: código trim/vacío → null, kind, medidas con mínimo de 1 paso; código automático solo al convertirse en `STAND`.
- [x] Ignorar comandos geométricos sobre objetos no rectangulares.
- Decisión: los ids nuevos se reciben por parámetro (`id`/`newId`); el store genera el UUID. Así los comandos son deterministas.

### LUI-04 — Validación de layout

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-02`
- **Entrega:** `domain/validation.ts` → `ValidationIssue[] { code, severity, objectIds, message }`.
- **Aceptación:** todos los escenarios de "Validación previa a publicación"; los códigos coinciden con la tabla D4.
- **Evidencia:** tests por regla, más un test de rendimiento: 500 stands validados en < 50 ms.
  - 2026-10-29: `ng test --watch=false --coverage` → 23/23 tests de `validation.spec.ts` en verde (66/66 totales), incluido el de rendimiento; `validation.ts` 100% stmts, 93.33% branch, 100% funcs, 100% lines.
- [x] `OUT_OF_BOUNDS` (todos los vértices, incluso de polígonos libres), `ZERO_AREA` (shoelace).
- [x] `STAND_OVERLAP` con epsilon 0.0001 m² estricto (`>`), igual que §3.4: borde y esquina compartidos válidos, exactamente 1 cm² válido, 2 cm² y 0.5 m² inválidos; un issue por par.
- [x] `STAND_ON_RESERVED` contra `AISLE`, `ENTRY`, `EXIT`, `EMERGENCY` (no contra `UTILITY`/`OBSTACLE`).
- [x] `CODE_MISSING` (null o en blanco), `CODE_DUPLICATE` (sin distinguir mayúsculas, agrupa todos los ids), `NO_STANDS`.
- [x] Mensajes en español con el código del objeto, sin depender del color.
- Límite conocido: el solapamiento solo se evalúa entre rectángulos; los polígonos libres quedan para PostGIS (`LAY-01`). Escaneo O(n²), suficiente para 500 stands; pasar a sweep-line por encima de ~2000 objetos.

### LUI-05 — Store del editor y repositorio en memoria

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-03`, `LUI-04`
- **Entrega:** `state/layout-editor.store.ts`, `data/layout.repository.ts`, `data/in-memory-layout.repository.ts` y `data/demo-layout.ts` con semilla de 100×60 m.
- **Aceptación:** "Un drag es un único paso de historial", "Publicada no editable" y "Nueva versión no altera la anterior"; `canPublish` es falso si hay errores.
- **Evidencia:** tests del store con repositorio en memoria.
  - 2026-10-29: `ng test --watch=false --coverage` → 93/93 en verde (18 del store, 8 del repositorio); `layout-editor.store.ts` 94.81% stmts, 95.55% funcs, 97.95% lines; repositorios y semilla al 100%.
- [x] Signals: `version`, `selectedId`, `past`, `future`, `step`, `isDirty`, `serverIssues`; `computed` para `objects`, `selected`, `validation`, `canPublish`, `isReadOnly`, `canUndo`/`canRedo`.
- [x] Métodos por comando (`add`, `move`, `resize`, `rotate`, `duplicate`, `remove`, `updateProps`) con historial tope 100; `beginGesture`/`commitGesture`/`cancelGesture` para drags.
- [x] `undo`/`redo`; la selección se limpia si el objeto seleccionado deja de existir.
- [x] `load`, `save`, `publish` (guarda antes si hay cambios; `PublishRejectedError` → `serverIssues`, sigue `DRAFT`), `createNewVersion` vía puerto `LayoutRepository`.
- [x] Ignorar todas las ediciones en solo lectura.
- [x] Semilla: pasillo central, entrada, salida de emergencia y 40 stands válidos (A–D × 10).
- Desvío: la semilla no incluye "2 sectores" porque `sector` no es un `kind` de `layout_objects` (§3.1). Los sectores quedan para cuando la spec los modele.
- Fix de dominio descubierto acá: un comando sin cambio efectivo (por ejemplo una flecha contra el borde) devuelve el mismo array, para no sumar pasos de undo vacíos.

### LUI-06 — Canvas SVG

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-05`
- **Entrega:** `ui/floor-plan-canvas`, un componente presentacional.
- **Aceptación:** "Superficie estable al cambiar zoom (AC-01)"; zoom anclado al cursor; pan con fondo; grilla 1 m con líneas de 5 m; reglas; estilos diferenciados por `kind` con patrón o ícono, además del color.
- **Evidencia:** tests de componente (render, selección, eventos emitidos) y prueba manual en Chrome desktop y móvil.
  - 2026-10-29: `ng test --watch=false --coverage` → 115/115 en verde (6 de viewport, 13 del canvas, 4 de integración de la página); `viewport.ts` 100%, `floor-plan-canvas.ts` 92.3% de líneas (sin cubrir: pinch y zoom-out, a probar a mano).
  - 2026-10-29: dev server sirve `/organizador/layouts/demo-v1/editor` (chunk lazy `layout-editor-page` 55 kB).
  - 2026-10-30: verificación en Chromium (Playwright) contra el stack Compose, 25/25 checks: desktop 1440×900 con mouse (40 stands, grilla 162 líneas con 34 mayores, reglas cada 5 m, estilo distinto por kind, AC-01 ×1.69 sin cambio de geometría ni m², rueda anclada al cursor con deriva 0.026 m y sin scroll de página, pan, drag +2 m con snap, 8 handles y resize 9→12 m², deselección, sin errores de consola) y móvil 390×844 táctil (sin overflow, pinch 2× sobre stands con deriva 0, pan con un dedo, tap selecciona, botones 36 px, sin errores de consola).
  - 2026-10-30: `ng test --watch=false --coverage` → 119/119 en verde; `floor-plan-canvas.ts` 99.18% lines, `viewport.ts` 100%.
- Fix (bug encontrado en la prueba manual): el pinch solo registraba dedos apoyados en el fondo; sobre un stand, el primer dedo arrastraba el stand y no había zoom. Ahora todo `pointerdown` (fondo, objeto, handle) registra el puntero; un segundo dedo cancela el drag en curso (nuevo output `dragCancel` → `store.cancelGesture()`) y pasa a pinch.
- Fix: el ancla del pinch se calculaba con el `viewBox` actual pero se aplicaba sobre la vista inicial del gesto; con dedos asimétricos el plano "patinaba" (0.22 m medidos). Ahora el ancla se calcula en el marco de la vista inicial.
- Nota: el primer dedo de un pinch sobre un stand lo selecciona (sin moverlo). Aceptable; revisar en `LUI-08` si molesta.
- Nota de arnés: una secuencia táctil CDP sobre una zona `touch-action: none` suprime el `click` sintético del tap siguiente en Chromium (reproducido con un `div` sin handlers). No es un bug de la app.
- [x] `viewBox` derivado de `zoom/cx/cy` con `linkedSignal` (se reinicia si cambian las medidas); zoom en rango [0.5, 8].
- [x] Rueda con `preventDefault` y zoom anclado al cursor; pinch con dos punteros; botones +/−/restablecer.
- [x] Render por `kind` con `track s.id`: color, patrón de trazo y etiqueta en texto; objetos inválidos con borde rojo y ⚠.
- [x] Drag de objeto → `dragStart`/`dragTo`/`dragEnd` (outputs, en metros); la página hace `beginGesture`/`move`/`commitGesture` en el store.
- [x] 8 handles de redimensionado en el objeto seleccionado (`resizeTo`); ocultos en solo lectura.
- [x] Objetos no rectangulares dibujados con `<polygon>`, sin handles ni drag (clase `locked`).
- Decisión: pantalla → metros con `screenToPlan` puro (xMidYMid meet) en lugar de `getScreenCTM`, que jsdom no implementa. Así es testeable.
- Adelantado de `LUI-07`: `layout-editor.page.ts` mínima (encabezado + canvas) y ruta lazy con `InMemoryLayoutRepository` a nivel de ruta. Se eliminó el placeholder de Angular.
- Fix de entorno: `ng serve --poll 1000` en Compose; sin polling, el watcher del contenedor no detecta los cambios hechos en Windows.

### LUI-07 — Paneles y toolbar

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-06`
- **Entrega:** `ui/object-properties`, `ui/object-list`, `ui/validation-panel`, `ui/editor-toolbar`, `layout-editor.page.ts` y ruta `/organizador/layouts/:versionId/editor` (lazy).
- **Aceptación:** "Sin datos comerciales" y "Lista sincronizada"; los errores del panel seleccionan el objeto al hacer click; el botón Publicar refleja `canPublish`.
- **Evidencia:** tests de componentes y E2E de humo.
  - 2026-10-30: `ng test --watch=false --coverage` → 149/149 en verde (7 propiedades, 5 lista, 5 validación, 6 toolbar, 2 nuevos del canvas, 5 nuevos de integración en la página).
  - 2026-10-30: E2E de humo en Chromium contra el stack Compose, 16/16: lista de 43 objetos; filtro + click en B03 lo selecciona y lo trae al viewport con zoom 483%; propiedades sin precio/reserva/expositor; editar X genera `STAND_OVERLAP` y deshabilita Publicar; click en el error selecciona el stand; Deshacer lo resuelve; Agregar crea y selecciona un stand; Publicar → banner de solo lectura sin toolbar; "Crear nueva versión" → v2 borrador con URL actualizada; móvil 390 px sin scroll horizontal y canvas de 506 px; sin errores de consola. La suite de `LUI-06` sigue 25/25.
- [x] Propiedades: código, kind, ancho, largo, x, y (inputs numéricos con paso de snap); rotar, duplicar y borrar; geometría bloqueada en polígonos libres.
- [x] Lista filtrable por kind/código, sincronizada con la selección (`aria-current`, ⚠ + "con errores" en el nombre accesible).
- [x] Toolbar: agregar por kind (en el centro de la vista actual), snap, undo/redo, guardar, publicar.
- [x] Banner de solo lectura para `PUBLISHED`/`ARCHIVED` con "Crear nueva versión" (navega con `replaceUrl` al nuevo borrador).
- Decisión: el zoom queda en los controles del canvas (como el mockup) y "Crear nueva versión" en el banner de solo lectura, donde AC-04 dice que se ofrece; no se duplican en la toolbar.
- Decisión: "visible en el viewport" lo resuelve el canvas: un `effect` sobre `selectedId` centra la vista (sin cambiar el zoom) si el objeto quedó fuera; solo sigue `selectedId` para no pelear con un drag.
- Desvío: los anuncios `aria-live` por acción quedan para `LUI-08`; acá solo se anuncian guardar/publicar/nueva versión.

### LUI-08 — Teclado y accesibilidad

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-07`
- **Entrega:** atajos de la tabla D7, foco gestionado y anuncios `aria-live`.
- **Aceptación:** "Mover con teclado"; flujo completo (crear, mover, redimensionar, borrar, publicar) sin mouse; sin violaciones axe serias o críticas.
- **Evidencia:** E2E Playwright solo con teclado y reporte axe.
  - 2026-10-30: `ng test --watch=false --coverage` → 184/184 en verde (25 de `keymap.spec.ts`, 6 nuevos del canvas, 4 nuevos de teclado en la página); `keymap.ts` 100%.
  - 2026-10-30: E2E solo teclado en Chromium (sin un solo evento de mouse), 22/22: Tab al plano y a A01 (foco = selección, trazo azul), → ×2 = 1 m con anuncio "A01 movido a 6, 10 m", Alt+↓ redimensiona, R rota, Ctrl+D duplica con foco en la copia, Supr borra y devuelve el foco al plano, Ctrl+Z / Ctrl+Shift+Z, `+`/`0`, Esc, Shift+Tab → "Agregar" + Enter crea y enfoca S01, Shift+↓ lo saca del pasillo, Shift+Tab → "Publicar" + Enter publica. axe-core 4.10.3 (wcag2a/2aa/21a/21aa) en estado inicial, con selección y publicada: **0 violaciones** de cualquier impacto. Suites de `LUI-06` (25/25) y `LUI-07` (16/16) sin regresiones.
- [x] `tabindex`, `role` y `aria-label` descriptivo por objeto (y el plano mismo enfocable).
- [x] Atajos de mover, redimensionar, rotar, duplicar, borrar, undo/redo y zoom (`ui/floor-plan-canvas/keymap.ts`, puro); Ctrl+R y Ctrl+0 quedan para el navegador.
- [x] Foco visible y que siga al objeto duplicado o creado (`focusObject` tras el render); al borrar vuelve al plano.
- [x] Región `aria-live="polite"` con anuncios de acciones y del cambio en la cantidad de errores.
- Decisión: la traducción intención → comando + texto del anuncio vive en `state/editor-actions.ts` y la comparten teclado, botones de propiedades y deshacer/rehacer de la toolbar.
- Límite conocido: cada objeto es una parada de Tab (43 en la demo; llegar a "Publicar" desde el plano con Shift+Tab tomó 45 pulsaciones). La lista lateral es la alternativa rápida. Si molesta en planos grandes: roving tabindex (una parada para todo el plano y navegación entre objetos con otra tecla) o un enlace "saltar el plano".
- Límite conocido: anuncios idénticos consecutivos (p. ej. varios "Deshecho.") pueden no releerse en algunos lectores de pantalla.

### LUI-09 — Rendimiento

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-06`
- **Entrega:** medición con 500 stands.
- **Aceptación:** drag sin frames > 50 ms en desktop de referencia; validación < 50 ms.
- **Evidencia:** trace de Chrome Performance registrado (resumen en este archivo).
  - 2026-10-30: Chromium 1440×900 contra `ng serve` (build de desarrollo, más lento que producción), `/organizador/layouts/stress-500/editor` (501 objetos, 4342 nodos DOM, carga 1.3 s). 60 movimientos, uno por frame; frames por `requestAnimationFrame` + `long-animation-frame`:

    | Escenario (CPU ×1) | p50 | p95 | max | frames > 50 ms |
    |---|---:|---:|---:|---:|
    | drag de stand | 6.1 | 24.3 | 36.3 | 0 |
    | pan | 6.1 | 18.3 | 30.3 | 0 |
    | zoom con rueda | 0 | 24.2 | 36.4 | 0 |

  - Perfil de CPU antes de optimizar: la validación se llevaba ~590 ms de JS en 60 movimientos (`overlapIssues` comparaba los 125k pares en cada `pointermove`; `roundTo` y `fromPolygon` detrás). Después: ~27 ms (−95%). El render de Angular es chico (~40 ms en total); el resto es render nativo del SVG.
  - Con CPU ×4 (gama baja simulada): frames de hasta ~200–230 ms en drag/pan/zoom, dominados por estilo/layout/paint del SVG, no por JS. Fuera del criterio de esta tarea; queda como riesgo para el mapa público (P15) en móviles.
  - `ng test` → 188/188; `validation.spec.ts` suma una guarda de equivalencia (300 stands aleatorios con semilla fija: mismos pares y mismo orden que el escaneo por fuerza bruta).
- [x] Semilla de estrés con 500 stands (`STRESS_LAYOUT`, id `stress-500`, válida, servida por el repositorio en memoria).
- [x] Medir drag y zoom; ajustar si hace falta: sweep-line en X para `STAND_OVERLAP` (exacto, mismo orden de issues) y memo de `fromPolygon` por identidad de geometría (`WeakMap`). `OnPush`/signals ya estaban; no hizo falta tocarlos.
- [x] Registrar resultados y decidir si D1 se mantiene: **se mantiene SVG** (ADR 0001). No se cumple ningún criterio de reapertura.
- Siguiente palanca si P15 sufre en móviles: grilla como `<pattern>` (−211 nodos), ocultar textos por debajo de cierto zoom y no re-renderizar formas sin cambios. Medir en dispositivo real antes de hacerlo.

### LUI-10 — E2E y cierre

- **Estado:** `VERIFIED`
- **Dependencias:** `LUI-08`, `LUI-09`
- **Entrega:** E2E Playwright de los escenarios del delta spec y archivo del change.
- **Aceptación:** AC-01, AC-02 (frontend) y AC-04 (frontend) pasan; lint, tests y build en verde.
- **Evidencia:** comandos y resultados con fecha.
  - 2026-10-30: `@playwright/test@^1.64.1` en el workspace `web` (script `npm run e2e --workspace web`, config `apps/web/playwright.config.ts`, specs `apps/web/e2e/*.e2e.ts`, base `E2E_BASE_URL` o `http://localhost:4200`). Requiere `npx playwright install chromium` una vez por máquina.
  - 2026-10-30: `npm run e2e` contra el stack Compose → 3/3 en verde, dos corridas seguidas (AC-01, AC-02, AC-04).
  - 2026-10-30: `ng test --watch=false` → 228/228 (23 archivos); `ng build` (producción) OK sin warnings: inicial 269,5 kB (73 kB transferidos), cada pantalla en su chunk lazy (editor 42,7 kB).
  - 2026-10-30: lockfile validado con `npm ci --dry-run` en `node:22-alpine` (654 paquetes) después de instalar desde Windows.
- [x] E2E: crear stand 3×4 → 12 m² tras zoom (área, puntos y medidas iguales; escala del plano ×1,3³ medida con el CTM del SVG).
- [x] E2E: solapamiento bloquea publicar; borde compartido no.
- [x] E2E: versión publicada en solo lectura → nueva versión editable, y la publicada conserva su geometría.
- [x] Mover el delta spec a la spec principal y marcar el change como archivado.
- Desvío (lint): `web` no tiene linter (sin ESLint ni target `lint`; el `npm run lint` raíz no ejecuta nada). Se usó `prettier --check` (7 archivos formateados, incluido `main.ts` preexistente) más el type-check estricto del build. Configurar ESLint queda en `FND-06`.
- Hallazgo: el `boundingBox` de un stand chico no sirve para medir el zoom (los trazos `non-scaling-stroke` tienen ancho fijo en píxeles); el E2E mide la escala con `getScreenCTM()`.

---

## Handoff a `LAY-01` (backend)

Contrato que `LAY-01` debe respetar para reemplazar `InMemoryLayoutRepository` por `HttpLayoutRepository`:

- DTOs de `design.md` D2 (GeoJSON Polygon en metros).
- Mismos códigos de validación (D4) en `application/problem+json`, con `objectIds` en una extensión del problema.
- Validación PostGIS (§3.4) como autoridad final.
