# Juntta Design System v1.0 — Paleta

- **Estado:** propuesta aceptada para implementar en `UX-01` (§10.1)
- **Fecha:** 2026-10-30
- **Origen:** paleta derivada del afiche de El Paseíto Emprendedor, adaptada a interfaz digital (el rosa se intensificó para ganar presencia).

## Dirección visual

- Cercanía y creatividad con estética SaaS moderna: verde petróleo y rosa como colores distintivos sobre superficies neutras.
- Composición orientativa: ~70 % neutros, ~20 % verde petróleo, ~10 % acentos rosa y oliva. Es una guía, no una regla.
- Verde petróleo: acciones principales y navegación. Rosa: campañas, novedades y elementos promocionales. Oliva: decoración y categorías.
- Tipografía Inter; bordes discretos; radios de 10–16 px.
- Los estados operativos de los stands usan colores propios, distintos de los de marca, y siempre van con etiqueta, ícono o patrón (nunca solo color, §8).

## Paleta principal

| Color | Hex |
|---|---|
| Verde petróleo | `#055851` |
| Rosa marca | `#D94F80` |
| Verde oliva | `#738711` |
| Marfil | `#F5F1EF` |
| Grafito | `#263532` |

## Tokens

| Token | Color | Uso |
|---|---|---|
| `primary` | `#055851` | Navegación, botones principales, identidad |
| `primary-hover` | `#03453F` | Hover y selección |
| `secondary` | `#D94F80` | Promociones, destacados, acciones secundarias |
| `accent` | `#738711` | Elementos decorativos y categorías |
| `background` | `#FAF9F7` | Fondo general |
| `surface` | `#FFFFFF` | Tarjetas, formularios y modales |
| `surface-soft` | `#F5F1EF` | Menús, secciones y contenedores |
| `text` | `#263532` | Texto principal |
| `text-muted` | `#65716E` | Texto secundario |
| `border` | `#E2E8E5` | Bordes y divisores |

### Estados operativos de stands

| Token | Color | Significado |
|---|---|---|
| `available` | `#22815C` | Disponible: libre para reservar |
| `reserved` | `#D69A32` | Reservado: retención temporal o reserva pendiente |
| `occupied` | `#87938E` | Ocupado: adjudicado a un expositor |
| `blocked` | `#ECEEED` relleno + `#8A908E` contorno | Bloqueado: no comercializable. Aspecto **deshabilitado** (decisión 2026-10-30) |
| `selected` | `#326BB5` | Seleccionado: stand activo en el mapa |
| `danger` | `#C44949` | **Errores de validación** (no es un estado de stand) |

## Decisiones (2026-10-30)

- **Tipografía:** Inter desde Google Fonts (pesos 400/500/600/700, `display=swap`), con fallback a la fuente del sistema.
- **Bloqueado ≠ error:** el rojo `#C44949` pasa a `danger` y queda solo para errores de validación del editor. "Bloqueado" se ve deshabilitado: relleno gris claro `#ECEEED` (1.17 contra blanco, por eso necesita contorno), contorno punteado `#8A908E` (3.25 sobre el plano blanco), rayado diagonal y candado.
- **Bloqueado vs. Ocupado:** los dos son grises. Se distinguen por relleno (claro vs. medio, 2.73 entre sí), contorno punteado, rayado, ícono y etiqueta, nunca solo por tono. Etiquetas sobre "Bloqueado" en `text` (11.0), no en `text-muted` (4.35, no alcanza).

### Variables CSS

```css
:root {
  /* Brand */
  --color-primary: #055851;
  --color-primary-hover: #03453f;
  --color-secondary: #d94f80;
  --color-accent: #738711;

  /* Surfaces */
  --color-background: #faf9f7;
  --color-surface: #ffffff;
  --color-surface-soft: #f5f1ef;

  /* Typography */
  --color-text: #263532;
  --color-text-muted: #65716e;
  --color-border: #e2e8e5;

  /* Operational states */
  --color-available: #22815c;
  --color-reserved: #d69a32;
  --color-occupied: #87938e;
  --color-blocked: #eceeed; /* disabled look; always with --color-blocked-stroke */
  --color-blocked-stroke: #8a908e;
  --color-selected: #326bb5;

  /* Feedback */
  --color-danger: #c44949; /* validation errors only */

  /* Shape */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
}
```

## Auditoría de contraste (WCAG 2.2)

Calculada el 2026-10-30 con la fórmula de luminancia relativa de WCAG. Umbrales: texto normal 4.5:1 (AA), texto grande y componentes/gráficos no textuales 3:1 (1.4.3 y 1.4.11).

| Par | Ratio | Resultado |
|---|---:|---|
| Texto blanco sobre `primary` | 8.33 | ✅ AAA |
| Texto blanco sobre `primary-hover` | 10.90 | ✅ AAA |
| `primary` como texto sobre `background` | 7.92 | ✅ AAA |
| `text` sobre `background` / `surface-soft` | 12.19 / 11.43 | ✅ AAA |
| `text-muted` sobre `surface` / `background` / `surface-soft` | 5.07 / 4.82 / 4.52 | ✅ AA (justo en `surface-soft`) |
| Texto blanco sobre `secondary` (rosa) | 3.90 | ⚠️ solo texto grande |
| `secondary` como texto sobre `surface` | 3.90 | ⚠️ solo texto grande |
| Texto blanco sobre `accent` (oliva) / `accent` como texto | 4.04 | ⚠️ solo texto grande |
| `border` sobre `surface` | 1.24 | ⚠️ válido solo para divisores decorativos; no para bordes de inputs |
| `available` / `blocked` / `selected` contra `surface`, y con texto blanco | 4.81 / 4.78 / 5.38 | ✅ AA |
| `reserved` contra `surface` | 2.46 | ❌ ni 3:1 para el contorno del stand |
| Texto blanco sobre `reserved` | 2.46 | ❌ — usar texto `text` (5.21 ✅) |
| `occupied` contra `surface` | 3.18 | ✅ 3:1 como gráfico |
| Texto blanco / `text` sobre `occupied` | 3.18 / 4.03 | ❌ para texto normal |

### Variantes accesibles propuestas

Oscurecidas sobre el mismo tono hasta cumplir el umbral sobre `surface`, `background` **y** `surface-soft`. A validar visualmente en `UX-01`.

| Token nuevo | Base | Propuesta | Mínimo de las 3 superficies | Para |
|---|---|---|---:|---|
| `secondary-strong` | `#D94F80` | `#BA446D` | 4.52 | Texto rosa y botones rosa con texto blanco |
| `accent-strong` | `#738711` | `#65760F` | 4.51 | Texto oliva (categorías, etiquetas) |
| `reserved-stroke` | `#D69A32` | `#B5822A` | 3.02 | Contorno del stand reservado (relleno se mantiene) |
| `occupied-strong` | `#87938E` | `#67706D` | 4.55 | Texto/etiqueta sobre o junto a stands ocupados |
| `border-strong` | `#E2E8E5` | `#898C8B` | 3.02 | Bordes de inputs, selects y controles |

Regla de uso: los colores base se mantienen para superficies y decoración; las variantes `-strong`/`-stroke` se usan cuando el color transmite información (texto, contorno, control).
