# Spec: public-catalog

> Fuente: change archivado [`pub-ui-catalog`](../../changes/archive/2026-10-30-pub-ui-catalog/proposal.md) (2026-10-30).

## Requirements

### Requirement: Áreas por rol (demo)

La app MUST ofrecer las áreas Organizador, Feriante y Visitante. Mientras no exista autenticación, un selector "Ver como" rotulado como demo MUST permitir cambiar de área.

#### Scenario: Ver como
- **WHEN** se elige "Feriante" en "Ver como"
- **THEN** se navega a `/feriante/explorar`, la opción queda marcada (`aria-pressed`) y la navegación muestra Explorar stands, Reserva y pago y Mis reservas

#### Scenario: Marcadores de reserva
- **WHEN** el feriante abre "Reserva y pago" o "Mis reservas"
- **THEN** ve que depende de `RES-01`/`PAY-01` y no ve reservas ni importes simulados

### Requirement: Estados de stand sin depender del color

Cada stand del mapa MUST mostrar su estado (Disponible, Reservado, Ocupado, Bloqueado) con algo más que color y exponerlo en su nombre accesible.

#### Scenario: Estados sin depender del color
- **THEN** un stand bloqueado se ve deshabilitado con rayado y su nombre accesible incluye "Bloqueado"
- **AND** los chips muestran la cantidad por estado (12 disponibles, 3 reservados, 23 ocupados, 2 bloqueados en el evento demo)

#### Scenario: Sectores
- **THEN** cada sector se dibuja como contorno punteado derivado de sus stands, con su nombre

### Requirement: Elegí tu stand (feriante)

El feriante MUST poder filtrar por sector, superficie y precio, ver el plano y una lista equivalente de stands disponibles, y abrir el detalle con el precio final.

#### Scenario: Filtros
- **WHEN** filtra por sector "Producción regional"
- **THEN** la lista muestra solo los stands disponibles de ese sector y el plano atenúa el resto

#### Scenario: Lista equivalente
- **WHEN** selecciona un stand en la lista
- **THEN** queda seleccionado en el plano y el detalle muestra código, sector, superficie y precio final en ARS
- **AND** "Reservar" indica que se habilita con `RES-01`, sin iniciar ningún flujo

### Requirement: Catálogo y mapa público (visitante)

El visitante MUST poder buscar ferias, abrir el mapa de una feria y ver solo fichas públicas consentidas.

#### Scenario: Catálogo
- **WHEN** busca "neuquen"
- **THEN** ve "Patagonia Emprende 2026" (búsqueda sin mayúsculas ni acentos) con fechas y stands disponibles

#### Scenario: Directorio público
- **THEN** el directorio muestra nombre, rubro, descripción y stand de expositores con consentimiento
- **AND** nunca razón social, CUIT ni contactos (INV-08, AC-11)

#### Scenario: Ficha de stand
- **WHEN** selecciona un stand ocupado con expositor público
- **THEN** ve el nombre y rubro del expositor
