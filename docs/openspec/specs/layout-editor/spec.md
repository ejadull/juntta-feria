# Spec: layout-editor

> Fuente: change archivado [`lay-ui-floor-plan-editor`](../../changes/archive/2026-10-30-lay-ui-floor-plan-editor/proposal.md) (2026-10-30).

## Requirements

### Requirement: Coordenadas en metros

El editor MUST representar y persistir toda la geometría en metros, independientemente del zoom, del tamaño de pantalla y del dispositivo.

#### Scenario: Superficie estable al cambiar zoom (AC-01)
- **GIVEN** una versión `DRAFT` de 100×60 m
- **WHEN** el operador crea un stand de 3×4 m y cambia el zoom a 250%
- **THEN** el stand muestra 12 m²
- **AND** al guardar, su `geometry` es un Polygon cuya área es 12

#### Scenario: Serialización a Polygon
- **GIVEN** un stand en x=10, y=10, ancho 3, largo 3
- **WHEN** se serializa
- **THEN** `geometry.coordinates` es `[[[10,10],[13,10],[13,13],[10,13],[10,10]]]`

### Requirement: Separación entre layout y evento

El editor MUST editar únicamente geometría, tipo, código y metadata de `layout_objects`. MUST NOT exponer ni persistir precio, estado comercial ni expositor.

#### Scenario: Sin datos comerciales
- **WHEN** el operador selecciona un stand
- **THEN** el panel de propiedades muestra código, tipo, ancho, largo y posición
- **AND** no muestra precio, estado de reserva ni expositor

### Requirement: Snap y límites del predio

El editor MUST ajustar posición y medidas al paso de snap configurado (0.25, 0.5 o 1 m; default 0.5) y MUST impedir que un objeto se arrastre fuera de los límites de la versión.

#### Scenario: Snap al mover
- **GIVEN** snap 0.5 m
- **WHEN** el operador arrastra un stand hasta x=10.37
- **THEN** el stand queda en x=10.5

#### Scenario: Clamp en el borde
- **GIVEN** un predio de 100 m de ancho y un stand de 3 m de ancho
- **WHEN** el operador lo arrastra hasta x=99
- **THEN** el stand queda en x=97

### Requirement: Operaciones de edición

El editor MUST permitir agregar, mover, redimensionar, rotar 90°, duplicar y borrar objetos de cualquier `kind`, y MUST ofrecer deshacer/rehacer de al menos 100 pasos.

#### Scenario: Un drag es un único paso de historial
- **WHEN** el operador arrastra un stand atravesando 40 posiciones intermedias y suelta
- **AND** presiona `Ctrl+Z`
- **THEN** el stand vuelve a su posición previa al drag

#### Scenario: Rotar mantiene el centro
- **GIVEN** un stand 2×4 con centro en (10,10)
- **WHEN** el operador lo rota
- **THEN** el stand pasa a 4×2 con centro en (10,10)

#### Scenario: Duplicar genera código único
- **GIVEN** stands A01 y A02
- **WHEN** el operador duplica A01
- **THEN** el nuevo stand recibe un código no usado y queda seleccionado

### Requirement: Validación previa a publicación

El editor MUST validar la versión de forma continua según INV-04 y MUST deshabilitar "Publicar" mientras exista al menos un error. Cada error MUST identificar los objetos afectados y permitir seleccionarlos.

#### Scenario: Borde compartido es válido (AC-02)
- **GIVEN** stand A en x=0..3 y stand B en x=3..6, misma franja y
- **WHEN** se valida
- **THEN** no hay error `STAND_OVERLAP`

#### Scenario: Superposición bloquea publicación (AC-02)
- **GIVEN** dos stands cuya intersección es 0.5 m²
- **WHEN** se valida
- **THEN** existe un error `STAND_OVERLAP` que referencia ambos stands
- **AND** "Publicar" está deshabilitado

#### Scenario: Stand sobre pasillo
- **GIVEN** un `AISLE` y un `STAND` que se intersectan 1 m²
- **THEN** existe un error `STAND_ON_RESERVED`

#### Scenario: Código duplicado
- **GIVEN** dos stands con código `A01`
- **THEN** existe un error `CODE_DUPLICATE`

#### Scenario: Validación frontend no es autoridad
- **WHEN** el frontend no reporta errores y el backend rechaza la publicación
- **THEN** el editor muestra los errores devueltos por el backend y la versión sigue `DRAFT`

### Requirement: Inmutabilidad de versiones publicadas

Una versión `PUBLISHED` o `ARCHIVED` MUST abrirse en solo lectura (INV-06). Editarla MUST requerir crear una nueva versión `DRAFT`.

#### Scenario: Publicada no editable (AC-04)
- **GIVEN** una versión `PUBLISHED`
- **WHEN** el operador intenta arrastrar un stand
- **THEN** el stand no se mueve
- **AND** se ofrece "Crear nueva versión"

#### Scenario: Nueva versión no altera la anterior
- **WHEN** el operador crea una nueva versión y mueve un stand
- **THEN** la versión publicada conserva la geometría original

### Requirement: Accesibilidad del editor

El editor MUST ser operable completamente con teclado, MUST ofrecer una lista de objetos sincronizada con la selección y MUST NOT usar el color como único indicador de tipo o error.

#### Scenario: Mover con teclado
- **GIVEN** snap 0.5 m y un stand con foco
- **WHEN** el operador presiona `→` dos veces
- **THEN** el stand avanza 1 m
- **AND** un anuncio `aria-live` informa la nueva posición

#### Scenario: Lista sincronizada
- **WHEN** el operador selecciona `B03` en la lista
- **THEN** `B03` queda seleccionado en el plano y visible en el viewport

### Requirement: Objetos no rectangulares

Los objetos cuya geometría no sea un rectángulo alineado a ejes MUST mostrarse sin pérdida de datos y MUST quedar bloqueados para edición geométrica.

#### Scenario: Polígono libre
- **GIVEN** un objeto con un Polygon de 5 vértices
- **THEN** se dibuja con su forma real
- **AND** no muestra handles ni acepta mover/redimensionar
