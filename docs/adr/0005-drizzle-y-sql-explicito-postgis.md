# ADR 0005 — Drizzle ORM con SQL explícito para PostGIS, RLS y restricciones críticas

- **Estado:** aceptado
- **Fecha:** 2026-10-30
- **Tarea:** `FND-01` (implementación en `CORE-01`)

## Contexto

La persistencia es PostgreSQL 16 + PostGIS (§2). Las garantías más importantes del producto viven en la base, no en el código: no doble adjudicación (índice único parcial de reservas activas, INV-01), aislamiento de tenants (RLS y FKs compuestas, INV-02/INV-09), geometría válida y sin solapamientos (INV-04, §3.4). Un ORM que oculte o no soporte esas construcciones las empujaría a la aplicación, donde son más débiles.

## Decisión

- **Drizzle ORM** para el acceso relacional tipado y las **migraciones versionadas** (`drizzle-kit`).
- **SQL explícito** (migraciones SQL escritas a mano o `sql` de Drizzle) para lo que el ORM no modela bien o no debe esconder:
  - columnas e índices `geometry(Polygon,0)` / GiST y consultas `ST_*`;
  - políticas **RLS** y `SET LOCAL app.tenant_id` dentro de transacciones (§2.2);
  - **índices únicos parciales** (p. ej. `uq_one_active_reservation_per_event_stand`) y por expresión (p. ej. `lower(btrim(name))` de ADR 0002);
  - **FKs compuestas** con `tenant_id` y acciones como `ON DELETE SET NULL (col)`;
  - restricciones de concurrencia (`SELECT … FOR UPDATE`, `CHECK`, exclusión).
- Driver **`pg`** (node-postgres) con pool (`DB_POOL_MAX`).
- Roles separados: la aplicación nunca usa un rol con `BYPASSRLS`; el rol de migraciones es otro (§2.2).

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| Prisma | Soporte de PostGIS y RLS limitado (geometría como `Unsupported`), migraciones propias menos flexibles para SQL manual, runtime adicional. |
| TypeORM | Decoradores y sincronización implícita propensos a sorpresas; menor tipado de consultas. |
| Solo SQL (query builder mínimo) | Máximo control, pero sin tipos derivados del schema ni migraciones integradas. |

## Consecuencias

- Cada invariante de base se acompaña de una prueba de integración contra PostgreSQL real (como la verificación de ADR 0002), no solo de tests unitarios.
- Las migraciones con SQL manual se revisan como código: `up`/`down` probados (§14).
- El tipado de Drizzle cubre lo relacional; lo espacial se tipa en los repositorios.
