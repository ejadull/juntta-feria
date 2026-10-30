# ADR 0004 — Contrato de entorno y autenticación

- **Estado:** aceptado
- **Fecha:** 2026-10-30
- **Tarea:** `FND-01` (implementación de configuración en `FND-02`; autenticación funcional en `CORE-02`)
- **Resuelve:** la decisión pendiente de §13.1 entre "JWT o sesión HttpOnly".

## Contexto

La API necesita configuración distinta por entorno (desarrollo, prueba, producción) sin secretos en el repositorio (`AGENT.md` §5). §13.1 dejaba abierto el mecanismo de autenticación. El frontend es una SPA en el mismo dominio que la API (proxy `/api` en desarrollo, reverse proxy en producción).

## Decisión

### Configuración

- Las variables se **parsean una sola vez al arrancar** con Zod (`parseEnvironment`) y se exponen tipadas por `@nestjs/config`. Una variable requerida ausente o inválida **detiene el arranque** con un mensaje que nombra la variable y la regla, **nunca su valor**.
- Dos grupos:
  - **Activas en Sprint 0A:** `NODE_ENV`, `API_HOST`, `PORT`, `API_PREFIX`, `CORS_ORIGINS`, `LOG_LEVEL`, `DATABASE_URL`, `DB_POOL_MAX`, `REDIS_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `SWAGGER_ENABLED`, más las de Compose/Web (`POSTGRES_*`, `WEB_PORT`, `API_PROXY_TARGET`) y observabilidad opcional (`SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`).
  - **Reservadas** (documentadas, no requeridas hasta su tarea): `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_REFRESH_TOKEN_SECRET`, `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_COOKIE_NAME`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAME_SITE`, `RESERVATION_HOLD_TTL_SECONDS`, `MP_ENVIRONMENT`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`.
- Política de producción: `NODE_ENV=production` **rechaza** `CORS_ORIGINS=*` y `SWAGGER_ENABLED=true`.
- S3 en desarrollo es **LocalStack** (no MinIO): no hay variables `MINIO_*`.
- `.env.example` es una plantilla sin secretos usables (marcadores como `GENERATE_LOCAL_HEX_64`); `.env` es local, ignorado y se completa con `scripts/init-local-env.mjs`, que genera secretos con `node:crypto` y solo informa nombres de variables.

### Autenticación (dirección para `CORE-02`)

- **Access token JWT de vida corta** (minutos) enviado en `Authorization: Bearer`, guardado **solo en memoria** del navegador.
- **Refresh token opaco y rotativo** en **cookie `HttpOnly`, `Secure`, `SameSite=Strict`** con `Path` limitado al endpoint de refresh; en base se guarda **solo su hash**, con detección de reutilización (si un refresh ya usado aparece, se revoca la familia de sesiones).
- Como la cookie solo sirve para `/auth/refresh`, el riesgo CSRF queda acotado a ese endpoint, que además valida `Origin` contra `CORS_ORIGINS`.

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| Sesión de servidor con cookie en cada request | Exige protección CSRF en toda la API y estado de sesión compartido (Redis) para cada request. |
| JWT largo en `localStorage` | Robable por XSS y no revocable. |
| Variables sin validación (leer `process.env` donde se necesite) | Errores tarde y difusos; riesgo de imprimir valores en logs. |

## Consecuencias

- Agregar una variable implica tocar el schema, `.env.example` y la tabla de §13.1 en el mismo cambio.
- Las variables reservadas no se validan hasta que su tarea las consuma: no bloquean flujos ajenos (§13.1).
- `CORE-02` implementa login, refresh rotativo, logout y revocación siguiendo esta dirección.
