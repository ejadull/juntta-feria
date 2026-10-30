# Spec: organizer-shell

> Fuente: change archivado [`org-ui-shell`](../../changes/archive/2026-10-30-org-ui-shell/proposal.md) (2026-10-30).

## Requirements

### Requirement: Navegación del organizador

La app del organizador MUST ofrecer navegación persistente entre Panel, Editor de plano, Reservas y cobros y Expositores, indicando la sección activa con algo más que color.

#### Scenario: Sección activa
- **WHEN** el organizador abre Expositores
- **THEN** el ítem "Expositores" tiene `aria-current="page"` y un indicador visual
- **AND** el contenido de Expositores se muestra en el área principal

#### Scenario: Raíz
- **WHEN** se abre `/`
- **THEN** se redirige a `/organizador/panel`

#### Scenario: Ruta inexistente
- **WHEN** se abre una ruta que no existe
- **THEN** se muestra "Página no encontrada" con un enlace al Panel

#### Scenario: Móvil
- **GIVEN** un viewport de 390 px
- **THEN** la navegación es accesible sin scroll horizontal de la página

### Requirement: Datos de demostración rotulados

Mientras se usen adaptadores en memoria, cada pantalla con datos MUST rotularlos como "Datos de demostración".

#### Scenario: Rótulo visible
- **WHEN** el organizador abre Panel o Expositores
- **THEN** ve el rótulo "Datos de demostración"

### Requirement: Panel del evento (P03)

El Panel MUST mostrar stands comercializables, ocupación, GMV aprobado y reservas en curso del evento, y el GMV aprobado por mes con una alternativa en tabla.

#### Scenario: Ocupación
- **GIVEN** 29 stands comercializables y 17 asignados
- **THEN** la ocupación es 59 % ("17 asignados de 29")

#### Scenario: Ocupación sin stands
- **GIVEN** 0 stands comercializables
- **THEN** la ocupación se muestra "—", no `NaN` ni `Infinity`

#### Scenario: GMV en pesos
- **GIVEN** `approvedGmvCents = 244200000`
- **THEN** la tarjeta muestra "$ 2,4 M" y aclara que no es ingreso SaaS

#### Scenario: Gráfico con alternativa
- **WHEN** el organizador abre "Ver datos" del gráfico
- **THEN** ve una tabla con cada mes y su importe completo

#### Scenario: Atajo al editor
- **WHEN** el organizador pulsa "Abrir editor de plano"
- **THEN** navega al editor de la versión de plano del evento

#### Scenario: Secciones sin backend
- **THEN** "Últimas operaciones" y "Estado de cobros" se muestran como pendientes de `RES-01`/`PAY-01`, sin datos

### Requirement: Expositores (P11, consulta)

El organizador MUST poder buscar y filtrar expositores y ver su ficha con datos privados. Esos datos MUST NOT reutilizarse para vistas públicas (INV-08).

#### Scenario: Búsqueda
- **WHEN** el organizador escribe "lanas"
- **THEN** la lista muestra solo expositores cuyo nombre comercial, razón social o rubro contiene "lanas", sin distinguir mayúsculas ni acentos

#### Scenario: Filtro por documentación
- **WHEN** filtra por "Pendiente"
- **THEN** solo ve expositores con documentación pendiente, y el estado se indica con ícono y texto

#### Scenario: Ficha
- **WHEN** selecciona un expositor
- **THEN** ve nombre comercial, razón social, CUIT, rubro, descripción, contacto público y estado de documentación

### Requirement: Reservas y cobros pendiente

Mientras no existan `RES-01`/`PAY-01`, la sección MUST explicar la dependencia y MUST NOT mostrar reservas ni pagos simulados.

#### Scenario: Marcador
- **WHEN** el organizador abre Reservas y cobros
- **THEN** ve que la sección depende de `RES-01` y `PAY-01` y no ve ninguna reserva
