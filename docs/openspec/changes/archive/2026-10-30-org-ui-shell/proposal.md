# Proposal: Shell del organizador, Panel (P03) y Expositores (P11)

- **Change ID:** `org-ui-shell`
- **Estado:** `ARCHIVED` (2026-10-30)
- **Fecha:** 2026-10-30
- **Pantallas:** P03 Dashboard, P11 Feriantes (consulta), navegación del organizador (§8); P10 solo como marcador
- **Épicas:** EP09 Reportes (lectura de KPIs), EP05 Feriantes (consulta)

## Por qué

El mockup de escritorio (`docs/juntta-feria-mock/App de escritorio …png`) muestra una app del organizador con menú lateral: Panel, Editor de plano, Reservas y cobros y Expositores. Hoy solo existe el editor (`lay-ui-floor-plan-editor`) y la raíz redirige a él: no hay navegación ni las otras pantallas.

Igual que con el editor, construir desde el frontend con puertos y adaptadores en memoria permite validar la UX y **fijar contratos de lectura** antes del backend, sin bloquearse por `CORE-*`, `EVT-01` o `EXH-01`.

Las pantallas no tienen el mismo riesgo:

- **Panel y Expositores** son de consulta: su contrato es un modelo de lectura simple (KPIs agregados, listado). Fijarlo ahora es barato y el backend lo implementa después.
- **Reservas y cobros** depende de holds, concurrencia, idempotencia y estados de Mercado Pago (§6, §7, R1, R2): es el riesgo central del producto. Inventar ese contrato en el frontend obligaría a reescribirlo con `RES-01`/`PAY-01`. Queda como marcador explícito.

## Qué cambia

- **ADDED** capacidad `organizer-shell`: layout con navegación lateral (escritorio) / superior (móvil), rutas lazy bajo `/organizador` y el editor existente integrado.
- **ADDED** Panel del evento (P03) en solo lectura: KPIs (stands comercializables, ocupación, GMV aprobado, reservas en curso) y GMV por mes con tabla alternativa accesible. Puerto `EventMetricsRepository` ↔ `GET /api/v1/events/:id/metrics` (§5).
- **ADDED** Expositores (P11, consulta): listado con búsqueda y filtros por rubro y estado de documentación, y ficha con datos privados visibles solo para el organizador (INV-08). Puerto `ExhibitorRepository` ↔ `GET /api/v1/exhibitors` (endpoint nuevo en §5).
- **ADDED** "Reservas y cobros" como marcador que explica la dependencia de `RES-01`/`PAY-01`, sin datos.
- Todo dato de demostración se rotula como tal en la UI ("Datos de demostración").

## Fuera de alcance

- Reservas, pagos, conciliación y webhooks (P10, P12; `RES-01`, `PAY-01`). Sin datos simulados.
- "Últimas operaciones" y "Estado de cobros" del Panel: tarjetas marcador hasta `RES-01`/`PAY-01`.
- "Ocupación por sector": `sector` no existe en el modelo (§3.1). Requiere decisión de spec.
- Selector "Ver como" Feriante/Visitante y vistas públicas/móviles (P14–P20, `PUB-01`).
- Acciones de verificación de documentos (aprobar/rechazar) y edición de expositores (`EXH-01`).
- Autenticación, organizaciones y selector de evento reales (`CORE-*`, `EVT-01`): se usa un evento y una organización de demostración.

## Impacto

- **Código:** `apps/web` (features `organizer-shell`, `dashboard`, `exhibitors`; ajuste de altura del editor para vivir dentro del shell). Sin cambios en `apps/api`.
- **Spec:** §5 suma `GET /api/v1/exhibitors` (operator); §10.1 suma `ORG-01..07`; se registra el hueco de `sector`.
- **Dependencias nuevas:** ninguna.
- **Riesgos:** ver `design.md` §Riesgos.
