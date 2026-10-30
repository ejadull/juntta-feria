# Design: Editor de plano (P06)

## Contexto

El mockup `docs/juntta-feria-stand-studio/src/components/floor-plan.tsx` aporta patrones válidos que se conservan:

- SVG con `viewBox` expresado en metros (1 unidad = 1 m); zoom/pan cambian solo el `viewBox`, nunca los datos.
- Zoom anclado al cursor (`zoomAt`) y conversión pantalla → plano con `getScreenCTM().inverse()`.
- Snap y clamp aplicados al soltar/mover.
- Lógica de dominio en funciones puras testeables (`stand-logic.ts`).

Se descarta del mockup: modelo `Stand` con `price`/`status`/`exhibitorId`, `rotated: boolean`, estado global mutable compartido entre plano y evento.

## Decisiones

### D1 — SVG en lugar de Konva/Fabric

| | SVG (elegido) | Canvas (Konva/Fabric) |
|---|---|---|
| Accesibilidad | DOM real: foco, teclado, `aria-*`, lector de pantalla | Hay que reimplementar todo en una capa paralela |
| Integración Angular | Binding directo en templates con signals | Wrapper imperativo y sincronización manual |
| Dependencias | Ninguna | +1 librería (~150 kB) |
| Escala | Fluido hasta ~1–2k nodos | Mejor con miles de objetos o imágenes pesadas |

Objetivo de dataset: 500 stands (§9). SVG alcanza con margen. **Reabrir** si un plano real supera ~2000 objetos o se importan planos raster pesados. Se documenta en un ADR.

### D2 — Modelo de edición vs. modelo persistido

El contrato persistido es el de §3.1 `layout_objects`:

```ts
type LayoutObjectKind = 'STAND' | 'AISLE' | 'ENTRY' | 'EXIT' | 'UTILITY' | 'OBSTACLE' | 'EMERGENCY';

interface LayoutObjectDto {
  id: string;            // UUID
  kind: LayoutObjectKind;
  code: string | null;   // obligatorio y único para STAND
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }; // metros, anillo cerrado
  metadata: Record<string, unknown>;
}

interface LayoutVersionDto {
  id: string;
  templateId: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  widthM: number;
  heightM: number;
  objects: LayoutObjectDto[];
}
```

Para editar, el núcleo usa rectángulos alineados a ejes:

```ts
interface Rect { x: number; y: number; w: number; h: number } // metros; w/h ya rotados
```

- `toPolygon(rect)` produce el anillo cerrado en sentido antihorario: `[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]`.
- `fromPolygon(polygon)` devuelve `Rect` solo si el polígono es un rectángulo alineado a ejes; si no, devuelve `null` y el objeto se muestra **bloqueado para edición** (compatibilidad futura con polígonos libres, R3).
- Rotar 90° = intercambiar `w`/`h` manteniendo el centro, y luego clamp. No hace falta un campo `rotated`.

### D3 — Precisión numérica

Los valores en metros se redondean a 2 decimales (centímetros) en cada mutación (`round2`). El solapamiento usa epsilon `0.0001 m²`, igual que §3.4, para que compartir un borde sea válido.

### D4 — Validación en dos niveles

1. **Frontend (este change):** feedback inmediato y botón "Publicar" deshabilitado mientras haya errores.
2. **Backend (`LAY-01`):** PostGIS (`ST_IsValid`, `ST_CoveredBy`, `ST_Intersection`) es la fuente de verdad. El frontend **nunca** se considera autoridad.

Reglas (INV-04):

| Código | Regla | Severidad |
|---|---|---|
| `OUT_OF_BOUNDS` | Objeto no contenido en `[0,widthM]×[0,heightM]` | error |
| `ZERO_AREA` | `w ≤ 0` o `h ≤ 0` | error |
| `STAND_OVERLAP` | Intersección entre dos `STAND` > 0.0001 m² | error |
| `STAND_ON_RESERVED` | `STAND` intersecta `AISLE`/`ENTRY`/`EXIT`/`EMERGENCY` > epsilon | error |
| `CODE_MISSING` | `STAND` sin código | error |
| `CODE_DUPLICATE` | Código de `STAND` repetido en la versión | error |
| `NO_STANDS` | La versión no tiene ningún `STAND` | error |

### D5 — Estado del editor

- Un único `LayoutEditorStore` (servicio con signals) por instancia del editor, con estado inmutable: `{ version, selectedId, past[], future[] }`.
- Cada comando (`move`, `resize`, `rotate`, `add`, `duplicate`, `remove`, `updateProps`) es una función pura `(objects, args) => objects`; el store solo apila snapshots. Undo/redo con un tope de 100 entradas.
- Un drag completo genera **una** entrada de historial: se hace commit en `pointerup`, no en cada `pointermove`.
- `validation = computed(() => validateLayout(version()))`.
- `PUBLISHED`/`ARCHIVED` ⇒ el editor queda en solo lectura (INV-06). Editar exige "Crear nueva versión" (clona como `DRAFT`).

### D6 — Persistencia vía puerto

```ts
abstract class LayoutRepository {
  abstract get(versionId: string): Observable<LayoutVersionDto>;
  abstract saveDraft(version: LayoutVersionDto): Observable<LayoutVersionDto>;
  abstract publish(versionId: string): Observable<LayoutVersionDto>;
  abstract cloneAsDraft(versionId: string): Observable<LayoutVersionDto>;
}
```

`InMemoryLayoutRepository` con datos semilla en metros es el adaptador por defecto. Se reemplaza por `HttpLayoutRepository` contra los endpoints de §5 cuando exista `LAY-01`, sin tocar componentes.

### D7 — Interacción y accesibilidad

| Acción | Puntero | Teclado |
|---|---|---|
| Seleccionar | click | `Tab`/`Shift+Tab` entre objetos; `Esc` deselecciona |
| Mover | arrastrar | flechas = 1 paso de snap; `Shift`+flechas = 1 m |
| Redimensionar | handles en esquinas/lados | `Alt`+flechas |
| Rotar 90° | botón | `R` |
| Duplicar | botón | `Ctrl+D` |
| Borrar | botón | `Supr`/`Backspace` |
| Undo/Redo | botones | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Zoom | rueda / pinch / botones | `+` / `-` / `0` reset |
| Pan | arrastrar fondo | — |

- Cada objeto es un `<g tabindex="0" role="button" aria-label="Stand A01, 3 por 4 metros">`.
- Hay un anuncio `aria-live="polite"` en cada acción ("A01 movido a 10, 12 m").
- Lista lateral de objetos sincronizada con la selección (alternativa accesible al canvas, AC-12).
- Los errores de validación se muestran con ícono y texto, nunca solo con color.
- Paso de snap configurable: 0.25 m / 0.5 m (default) / 1 m (§3.4).

### Estructura de archivos

```
apps/web/src/app/features/layout-editor/
  domain/
    geometry.ts            # Rect, toPolygon, fromPolygon, snap, clamp, round2, intersectionArea
    geometry.spec.ts
    commands.ts            # move, resize, rotate90, add, duplicate, remove, updateProps
    commands.spec.ts
    validation.ts          # validateLayout -> ValidationIssue[]
    validation.spec.ts
    layout.types.ts        # DTOs y tipos
  data/
    layout.repository.ts   # puerto abstracto
    in-memory-layout.repository.ts
  state/
    layout-editor.store.ts
    layout-editor.store.spec.ts
  ui/
    floor-plan-canvas/     # SVG: viewBox, grilla, reglas, objetos, handles
    object-properties/     # panel derecho
    object-list/           # lista accesible
    validation-panel/
    editor-toolbar/        # snap, undo/redo, zoom, publicar
  layout-editor.page.ts    # contenedor: inyecta store y repositorio
```

Patrón contenedor-presentacional: solo `layout-editor.page.ts` conoce el store y el repositorio. Los componentes de `ui/` reciben `input()` y emiten `output()`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Divergencia entre validación frontend y PostGIS | Mismos códigos de error y epsilon; tests con los mismos casos en `LAY-01` |
| Rendimiento con drag en planos grandes | `ChangeDetectionStrategy.OnPush`, signals y `track` por id; medir con 500 stands |
| Polígonos no rectangulares futuros | `fromPolygon` devuelve `null` → objeto bloqueado, sin pérdida de datos |
| Gestos táctiles (pinch) inconsistentes entre navegadores | Pointer Events con `touch-action: none`; probar en Chrome Android y Safari iOS |
