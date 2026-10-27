# juntta-feria
Construir una plataforma web que permita administrar ferias permanentes e itinerantes, diseñar planos de predios con dimensiones reales, comercializar stands, gestionar expositores, cobrar reservas mediante Mercado Pago y ofrecer un directorio interactivo a los visitantes.

# Juntta Feria

**Juntta Feria** es una plataforma SaaS multiempresa para organizar ferias, gestionar predios fijos e itinerantes, diseñar planos reutilizables a escala, comercializar stands y brindar un mapa público de expositores.

> Estado: fase de especificación. Este repositorio aún no debe considerarse una aplicación operativa.

## Objetivos

- Organizar ferias y eventos desde una cuenta multiempresa con roles y permisos.
- Dibujar planos a escala en metros, versionarlos y reutilizarlos entre eventos.
- Publicar stands con dimensiones, superficie, ubicación, precios, servicios y disponibilidad.
- Permitir reservas de stands con retención temporal, concurrencia segura y pago por Mercado Pago.
- Mostrar a visitantes un mapa interactivo de expositores y productos.
- Registrar auditoría, pagos, ocupación y reportes operativos.

## Alcance del MVP

| Componente | Tecnología propuesta |
| --- | --- |
| Frontend responsive/PWA | Angular + TypeScript |
| Editor de planos | Konva.js o Fabric.js; coordenadas locales en metros |
| API | NestJS / REST / OpenAPI |
| Persistencia | PostgreSQL 16 + PostGIS |
| Jobs, cache y colas | Redis + BullMQ |
| Archivos | Almacenamiento compatible S3, MinIO para desarrollo |
| Pagos | Mercado Pago Checkout Pro + Webhooks |
| Entorno local | Docker Compose |

## Documentación

- [OpenSpec funcional y técnico](docs/openspec/specification.md): PRD, dominios, modelo de datos, API, seguridad, reglas de negocio, backlog, aceptación y roadmap.
- [Docker Compose de referencia](docker-compose.yml): plantilla para entorno de desarrollo, **no ejecutable completamente hasta crear las apps y Dockerfiles**.
- [Variables de entorno de ejemplo](.env.example): copiar a `.env` y definir credenciales propias. No versionar `.env`.

## Flujo principal

1. El organizador crea un predio y su plano reusable.
2. Publica un evento con una versión inmutable del plano y tarifas por stand.
3. El feriante elige un stand disponible y crea una reserva temporal.
4. Se inicia el checkout de Mercado Pago.
5. La API valida la notificación, consulta el pago y adjudica el stand si corresponde.
6. El visitante explora el mapa de expositores del evento.

## Desarrollo local

La especificación es el entregable inicial. Para iniciar el entorno integral, implementar `apps/api` y `apps/web`, los Dockerfiles de desarrollo y las migraciones. A continuación:

```bash
cp .env.example .env
# Completar credenciales seguras en .env

docker compose config
docker compose up --build -d
```

**Seguridad:** no publicar tokens de Mercado Pago, credenciales, secretos ni `.env` en Git. El código definitivo debe contemplar aislamiento por tenant, idempotencia, Webhooks verificados y restricciones de concurrencia.

## Roadmap

1. Core multi-tenant y autenticación.
2. Predios y editor de planos versionados.
3. Eventos, stands y tarifas.
4. Reservas y pagos Mercado Pago.
5. Perfil del feriante y portal público.
6. Reportes, hardening, pruebas E2E y piloto.

## Convenciones

- Rama objetivo de integración: `develop`.
- Las modificaciones de una plantilla no cambian automáticamente los planos ya publicados.
- El backend es la fuente de verdad para disponibilidad, precios, pagos y adjudicaciones.
