# Juntta Feria Sprint 0A Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reproducible local platform foundation and a verified OpenSpec task graph without implementing business-domain features prematurely.

**Architecture:** Keep the npm workspace, Angular application and modular NestJS/Fastify API. Configuration is parsed once into typed values; Compose builds from the repository root so the single lockfile remains authoritative. Liveness is process-only, while readiness verifies PostgreSQL, Redis and the configured S3 bucket.

**Tech Stack:** Node.js 22+, npm workspaces, NestJS 12, Fastify, Angular 22, Zod, PostgreSQL/PostGIS, Redis, MinIO/S3, Docker Compose, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-sprint-0-foundation-design.md`

## Global Constraints

- Root `AGENT.md` is mandatory; no secret, credential or environment-dependent URL may be committed.
- `.env.example` is safe and non-operational; ignored `.env` is initialized locally without printing values.
- All host ports bind explicitly to `127.0.0.1`.
- Keep npm workspaces and the single root `package-lock.json`; do not add Nx or pnpm.
- Use `/api/v1` as the API prefix and `application/problem+json` for HTTP problems.
- Liveness never depends on PostgreSQL, Redis or S3; readiness checks all three, including `HeadBucket`.
- JWT login, refresh and persistence are outside Sprint 0A; only their future environment contract is documented.
- Do not commit locally without a separate explicit approval after the required delivery report; never push or deploy.
- Update OpenSpec status only from executed evidence; `PENDING` is not failure and must not be changed optimistically.

## Environment Interface

Active Sprint 0A variables: `NODE_ENV`, `API_HOST`, `PORT`, `API_PREFIX`, `WEB_PORT`, `API_PROXY_TARGET`, `CORS_ORIGINS`, `LOG_LEVEL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `DATABASE_URL`, `DB_POOL_MAX`, `REDIS_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `SWAGGER_ENABLED`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

Reserved and documented but not consumed or required until their owning slice: `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_REFRESH_TOKEN_SECRET`, `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_TOKEN_TTL_SECONDS`, `AUTH_REFRESH_COOKIE_NAME`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAME_SITE`, `RESERVATION_HOLD_TTL_SECONDS`, `MP_ENVIRONMENT`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`.

## Review Focus

- A malformed or cross-field-inconsistent local configuration must fail without echoing secret values; pinned in FND-02 configuration tests.
- `NODE_ENV=production` must reject wildcard CORS and development Swagger; pinned in FND-02 production-policy tests.
- A reachable MinIO server without the configured bucket must keep readiness unhealthy; pinned in FND-04 health tests.
- An untrusted correlation header that is empty, oversized or contains invalid characters must be replaced, not reflected; pinned in FND-04 interceptor tests.
- An unavailable API through the Angular proxy must produce an explicit unavailable state without breaking application bootstrap; pinned in FND-05 client/component tests.

---

### Task 1: FND-01 Architecture Records and OpenSpec Traceability

**Files:**
- Create: `docs/architecture/adr/0001-modular-monolith-npm-workspaces.md`
- Create: `docs/architecture/adr/0002-environment-and-authentication-contract.md`
- Create: `docs/architecture/adr/0003-drizzle-postgis-persistence.md`
- Modify: `docs/openspec/specification.md`
- Test: documentation checks only

**Interfaces:**
- Consumes: approved foundation design and the existing OpenSpec.
- Produces: stable decisions and task IDs `FND-01` through `FND-06`, plus downstream IDs consumed by every later task.

- [ ] **Step 1: Verify the OpenSpec execution section has the approved fields**

Check every FND task has status, dependencies, delivery, acceptance, evidence and checkbox subtasks. Keep all statuses `PENDING` at planning time.

- [ ] **Step 2: Write ADR 0001**

Record npm workspaces, the modular NestJS monolith, Angular as a separate workspace, root Docker build context and the explicit decision not to add Nx/pnpm or a worker process yet.

- [ ] **Step 3: Write ADR 0002**

Record the active/reserved environment split, local-only secret generation, access JWT plus rotating hashed refresh session direction, HttpOnly cookie policy and the fact that functional auth belongs to `CORE-02`.

- [ ] **Step 4: Write ADR 0003**

Record Drizzle for typed relational access/migrations and explicit SQL for PostGIS, RLS, partial unique indexes, composite tenant FKs and concurrency constraints.

- [ ] **Step 5: Check links and whitespace**

Run: `rg -n "FND-0[1-6]|CORE-0[1-3]|VEN-01|LAY-01|EVT-01|EXH-01|RES-01|PAY-01|PUB-01|REP-01" docs/openspec/specification.md docs/architecture/adr`

Run: `git diff --check`

Expected: all identifiers are present; no whitespace errors.

- [ ] **Step 6: Prepare the task checkpoint**

Summarize documents and checks. Do not commit; propose `docs: formalize Sprint 0A architecture and task graph` only after the user receives the required report.

---

### Task 2: FND-02 Environment Contract and Typed Validation

**Files:**
- Create: `scripts/init-local-env.mjs`
- Create: `scripts/init-local-env.test.mjs`
- Create: `apps/api/src/config/env.schema.ts`
- Create: `apps/api/src/config/env.schema.spec.ts`
- Create: `apps/api/src/config/configuration.ts`
- Modify: `.env.example`
- Modify locally, never stage: `.env`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`
- Modify with npm only: `package-lock.json`

**Interfaces:**
- Consumes: the exact active/reserved variable lists in this plan.
- Produces: `parseEnvironment(input: NodeJS.ProcessEnv): AppEnvironment`; `configuration(): AppConfiguration`; validated values available through Nest `ConfigService`.

- [ ] **Step 1: Write failing environment parser tests**

In `env.schema.spec.ts`, assert:

- a complete local environment parses numbers, booleans, URLs and comma-separated CORS origins;
- missing `DATABASE_URL`, `REDIS_URL`, S3 credentials or bucket fails with the variable name but not its value;
- malformed URLs, ports outside `1..65535`, `DB_POOL_MAX < 1` and empty CORS entries fail;
- `NODE_ENV=production` rejects `SWAGGER_ENABLED=true` and `CORS_ORIGINS=*`;
- reserved JWT/MP variables may be absent during Sprint 0A.

- [ ] **Step 2: Run parser tests and confirm failure**

Run: `npm run test --workspace api -- env.schema.spec.ts`

Expected: FAIL because `parseEnvironment` does not exist.

- [ ] **Step 3: Add configuration dependencies**

Run: `npm install --workspace api @nestjs/config zod`

Expected: only `apps/api/package.json` and root `package-lock.json` change.

- [ ] **Step 4: Implement the environment parser**

Export these exact types/functions from `env.schema.ts`:

```ts
export type AppEnvironment = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  apiHost: string;
  port: number;
  apiPrefix: string;
  corsOrigins: readonly string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  databaseUrl: string;
  dbPoolMax: number;
  redisUrl: string;
  s3: Readonly<{ endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string; forcePathStyle: boolean }>;
  swaggerEnabled: boolean;
}>;

export function parseEnvironment(input: NodeJS.ProcessEnv): AppEnvironment;
```

Normalize `API_PREFIX` by removing leading/trailing slashes. Validation errors may name keys and rules but must not include received values.

- [ ] **Step 5: Implement Nest configuration**

Export `AppConfiguration` and `configuration()` from `configuration.ts`. Load it globally through `ConfigModule.forRoot({ isGlobal: true, validate: parseEnvironment, load: [configuration] })` in `AppModule`.

- [ ] **Step 6: Write failing local initializer tests**

Use temporary directories in `init-local-env.test.mjs`. Assert the script logic preserves existing non-placeholder values, generates distinct 64-character hexadecimal secrets, keeps S3/MinIO credentials consistent, constructs the localhost `DATABASE_URL`, never writes optional MP credentials and returns only changed key names to its caller.

- [ ] **Step 7: Implement the local initializer and safe template**

`scripts/init-local-env.mjs` must use `node:crypto`, read `.env.example`, preserve an existing `.env`, replace only documented generation markers and write atomically. It must print a summary of key names only. Update `.env.example` with all active/reserved variables, defaults and comments; use markers such as `GENERATE_LOCAL_HEX_64`, never usable shared credentials.

- [ ] **Step 8: Initialize local `.env` without exposing values**

Run: `node scripts/init-local-env.mjs`

Then compare key names only and confirm `.env` is ignored/tracked status remains absent.

- [ ] **Step 9: Run focused verification**

Run: `node --test scripts/init-local-env.test.mjs`

Run: `npm run test --workspace api -- env.schema.spec.ts`

Run: `git ls-files .env .env.example`

Expected: tests PASS; only `.env.example` is tracked.

- [ ] **Step 10: Prepare the task checkpoint**

Report environment groups and tests without values. Do not commit; propose `feat(config): validate and initialize local environment` after explicit approval.

---

### Task 3: FND-03 Reproducible Development Containers

**Files:**
- Create: `.dockerignore`
- Create: `apps/api/Dockerfile.dev`
- Create: `apps/web/Dockerfile.dev`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: root `package.json`, root `package-lock.json`, workspace manifests and the Environment Interface above.
- Produces: services `postgres`, `redis`, `minio`, `minio-init`, `api`, `web`; healthy dependencies and an existing `S3_BUCKET`.

- [ ] **Step 1: Make Compose validation the failing check**

Run: `docker compose config --quiet`

Expected before implementation: failure because application Dockerfiles are missing or the existing Compose contract is incomplete.

- [ ] **Step 2: Create the root-context development Dockerfiles**

Both Dockerfiles use Node 22, copy root/workspace manifests, run `npm ci`, then copy the owning workspace. API command is `npm run start:dev --workspace api`; Web command is `npm run start --workspace web -- --host 0.0.0.0 --port 4200`.

- [ ] **Step 3: Add a narrow `.dockerignore`**

Exclude `.git`, all `node_modules`, build/test output, `.env*` except `.env.example`, editor files and local logs. Do not exclude workspace manifests or source.

- [ ] **Step 4: Rework Compose without secret literals**

Use root build context with `dockerfile: apps/<app>/Dockerfile.dev`; loopback bindings for PostgreSQL, Redis, MinIO API/console, API and Web; persistent volumes; service healthchecks; and separate Node module volumes. Override container URLs with service DNS while local `.env` retains localhost URLs.

- [ ] **Step 5: Add idempotent bucket initialization**

Add `minio-init` using the official MinIO client image. It waits for MinIO, configures a temporary alias from environment variables and creates `S3_BUCKET` only if absent. Do not log credentials.

- [ ] **Step 6: Validate and build**

Run: `docker compose config --quiet`

Run: `docker compose build api web`

Expected: both commands succeed from the root lockfile.

- [ ] **Step 7: Start and inspect the stack**

Run: `docker compose up -d postgres redis minio minio-init api web`

Inspect `docker compose ps`, health states, restart counts and published `HostIp`. Expected: long-running services healthy/running, initializer exits 0, every published host binding is `127.0.0.1`.

- [ ] **Step 8: Prepare the task checkpoint**

Report images, service state and bindings without resolved environment output. Do not commit; propose `build: add reproducible local development stack` after explicit approval.

---

### Task 4: FND-04 API Operational Baseline

**Files:**
- Create: `apps/api/src/common/http/correlation-id.interceptor.ts`
- Create: `apps/api/src/common/http/correlation-id.interceptor.spec.ts`
- Create: `apps/api/src/common/http/problem-details.filter.ts`
- Create: `apps/api/src/common/http/problem-details.filter.spec.ts`
- Create: `apps/api/src/infrastructure/infrastructure.module.ts`
- Create: `apps/api/src/infrastructure/infrastructure.tokens.ts`
- Create: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.service.ts`
- Create: `apps/api/src/health/health.service.spec.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/app.e2e-spec.ts`
- Modify: `apps/api/package.json`
- Modify with npm only: `package-lock.json`

**Interfaces:**
- Consumes: validated `AppEnvironment`; configured PostgreSQL, Redis and S3 services.
- Produces: `GET /api/v1/health/live`, `GET /api/v1/health/ready`, correlation response header and RFC problem responses.

- [ ] **Step 1: Write failing correlation and problem tests**

Assert valid `x-correlation-id` values matching `[A-Za-z0-9._-]{1,128}` are propagated; missing/invalid values become UUIDs. Assert unmapped errors return `application/problem+json` fields `type`, `title`, `status`, `detail`, `code`, `traceId` without stack or secret content.

- [ ] **Step 2: Write failing health tests**

Mock dependency clients. Assert liveness always reports process status, readiness is 200 only when PostgreSQL query, Redis ping and S3 `HeadBucket` succeed, and each failure produces 503 with a sanitized dependency status.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npm run test --workspace api -- correlation-id.interceptor.spec.ts problem-details.filter.spec.ts health.service.spec.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Add operational dependencies**

Run: `npm install --workspace api @aws-sdk/client-s3 @nestjs/swagger ioredis pg`

Run: `npm install --workspace api --save-dev @types/pg`

- [ ] **Step 5: Implement infrastructure providers and health service**

Export symbols `POSTGRES_POOL`, `REDIS_CLIENT`, `S3_CLIENT`. Export methods:

```ts
checkLiveness(): { status: 'ok'; timestamp: string };
checkReadiness(): Promise<{ status: 'ok'; dependencies: Record<'postgres' | 'redis' | 's3', 'up'> }>;
```

Controller maps readiness failure to 503 without credentials, raw provider messages or stack traces.

- [ ] **Step 6: Implement HTTP cross-cutting behavior**

Register the correlation interceptor and problem filter globally. Preserve valid incoming IDs and attach the selected ID to request/response so the filter returns the same `traceId`.

- [ ] **Step 7: Configure bootstrap and development OpenAPI**

Read validated host, port, prefix and CORS origins from `ConfigService`. Enable Swagger only when `swaggerEnabled` is true and expose it below `/api/v1/docs`.

- [ ] **Step 8: Extend E2E tests**

Assert prefixed liveness, unknown-route problem response/content type, correlation propagation/replacement and readiness behavior with test doubles. Ensure the old unprefixed starter route is no longer the acceptance target.

- [ ] **Step 9: Run API verification**

Run: `npm run lint --workspace api`

Run: `npm run test --workspace api`

Run: `npm run test:e2e --workspace api`

Run: `npm run build --workspace api`

Expected: all PASS.

- [ ] **Step 10: Exercise the running stack**

Rebuild/recreate API, then request live and ready endpoints. Expected: both 200 with configured services; after a safe temporary dependency interruption, live remains 200 and ready becomes 503, then recovers.

- [ ] **Step 11: Prepare the task checkpoint**

Report endpoint evidence and dependency behavior. Do not commit; propose `feat(api): add validated operational baseline` after explicit approval.

---

### Task 5: FND-05 Web-to-API Connectivity

**Files:**
- Create: `apps/web/proxy.conf.cjs`
- Create: `apps/web/src/app/core/api/api-status.service.ts`
- Create: `apps/web/src/app/core/api/api-status.service.spec.ts`
- Modify: `apps/web/angular.json`
- Modify: `apps/web/src/app/app.config.ts`
- Modify: `apps/web/src/app/app.ts`
- Modify: `apps/web/src/app/app.html`
- Modify: `apps/web/src/app/app.spec.ts`

**Interfaces:**
- Consumes: relative endpoint `/api/v1/health/live`; `API_PROXY_TARGET` only in the development proxy process.
- Produces: `ApiStatusService.check(): Observable<'available' | 'unavailable'>` and a minimal accessible status indicator.

- [ ] **Step 1: Write failing client tests**

Using Angular HTTP testing utilities, assert `check()` calls exactly `/api/v1/health/live`, maps a valid 200 response to `available` and maps network/5xx failures to `unavailable` without throwing through application bootstrap.

- [ ] **Step 2: Write failing component tests**

Assert pending, available and unavailable text states are exposed through an element with `role="status"`; no final product navigation or visual design is introduced.

- [ ] **Step 3: Run focused Web tests and confirm failure**

Run: `npm run test --workspace web -- --watch=false`

Expected: FAIL because the service/status UI does not exist.

- [ ] **Step 4: Implement the relative API client**

Add `provideHttpClient()` and implement `ApiStatusService.check()` with the exact interface above. Do not place a host, port or environment URL in browser source.

- [ ] **Step 5: Add the configurable development proxy**

`proxy.conf.cjs` reads `process.env.API_PROXY_TARGET ?? 'http://localhost:3000'`, proxies `/api` and does not disable TLS verification. Reference it from the Angular serve target.

- [ ] **Step 6: Replace the Angular starter template minimally**

Show application name and API status only. Keep CSS minimal because the actual product UX is a later task.

- [ ] **Step 7: Run Web verification**

Run: `npm run test --workspace web -- --watch=false`

Run: `npm run build --workspace web`

Expected: all PASS.

- [ ] **Step 8: Verify both execution paths**

With local npm processes and then Compose, request the Web origin path `/api/v1/health/live`. Expected: proxy returns API 200 in both paths.

- [ ] **Step 9: Prepare the task checkpoint**

Report tests and proxy checks. Do not commit; propose `feat(web): connect application shell to versioned API` after explicit approval.

---

### Task 6: FND-06 Integrated Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/openspec/specification.md`
- Test: full workspace and running stack

**Interfaces:**
- Consumes: verified outputs from FND-01 through FND-05.
- Produces: accurate setup instructions and evidence-backed OpenSpec status changes.

- [ ] **Step 1: Rewrite development instructions to match reality**

Document npm workspaces, `node scripts/init-local-env.mjs`, local npm startup, Docker Compose startup, liveness/readiness URLs and the fact that Nx/pnpm remain non-selected. Never include generated values.

- [ ] **Step 2: Run full static and test verification**

Run: `npm run lint`

Run: `npm test -- --run` only if supported by every workspace; otherwise run the verified workspace-specific commands from Tasks 4 and 5.

Run: `npm run build`

Expected: all applicable checks PASS; document any genuinely unavailable check rather than hiding it.

- [ ] **Step 3: Run infrastructure verification**

Run: `docker compose config --quiet`

Run: `docker compose build`

Run: `docker compose up -d`

Inspect health, restart counts, loopback bindings, liveness, readiness and Web proxy behavior. Expected: all acceptance criteria from FND-03 through FND-05 pass.

- [ ] **Step 4: Audit security and scope**

Confirm `.env` is ignored, no secret markers were replaced in tracked files, no resolved Compose output is captured, dependency changes are justified and no unrelated files changed.

- [ ] **Step 5: Update OpenSpec evidence and status**

For each task whose criteria actually passed, set status to `VERIFIED`, check its completed subtasks and add a dated evidence line with commands/results. Leave any incomplete task `PENDING` or `BLOCKED` with the exact reason.

- [ ] **Step 6: Run final diff checks**

Run: `git diff --check`

Run: `git status --short`

Review the full diff and generated/untracked files. Expected: only planned files, no secrets.

- [ ] **Step 7: Deliver the mandatory report**

Report changes, affected files, all executed checks/results, unverified items, risks, pending human actions and confirmation that no push/deploy/merge/remote mutation occurred.

- [ ] **Step 8: Request separate commit authorization**

Propose one or more precise local commit messages based on the final diff. Do not run `git commit` unless the user explicitly approves after reading the report.
