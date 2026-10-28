# Juntta Feria Sprint 0 Foundation Design

## Intent

Convert the current Angular and NestJS scaffolding into a runnable, testable local foundation for implementing the FeriaOS OpenSpec through vertical, independently verifiable increments. This delivery is **Sprint 0A: Foundation**; it does not replace the broader Sprint 0 scope already defined by the OpenSpec.

The first increment must make configuration, infrastructure and application startup reliable before business modules are added. The OpenSpec remains the source of truth and will be extended with trackable subtasks instead of creating a disconnected backlog.

## Goals

- Keep the existing npm workspaces, Angular 22, NestJS 12 and Fastify stack.
- Define a complete environment-variable contract without committing usable secrets.
- Generate a local-only `.env` with unique development secrets while preserving `.env.example` as a safe template.
- Validate required configuration at API startup and fail with actionable errors.
- Make PostgreSQL/PostGIS, Redis, MinIO, API and Web runnable through Docker Compose.
- Add health/readiness endpoints and a stable `/api/v1` API prefix.
- Establish the configuration contract and interfaces for JWT access authentication with refresh tokens delivered only through an HttpOnly cookie; functional authentication is delivered by `CORE-02`.
- Record implementation work as OpenSpec subtasks with dependencies and acceptance evidence.
- Leave a verified base for the first Core SaaS vertical slice.

## Non-goals

- Implement all ten MVP epics in Sprint 0.
- Implement tenants, memberships, complete RBAC or RLS policies before the foundation is validated.
- Integrate live Mercado Pago credentials or make real payments.
- Add Nx, pnpm, microservices or a separate worker application.
- Deploy, push, publish or modify remote infrastructure.

## Anti-goals

- Do not place real or reusable credentials in `.env.example`, Compose, source code or documentation.
- Do not treat Docker startup alone as proof that tenancy, reservations or payments are implemented.
- Do not add environment variables without a documented consumer and validation rule.
- Do not mark an OpenSpec subtask complete without recording verification evidence.
- Do not build authentication around browser-readable refresh tokens.

## Current State

- The repository is clean and contains npm workspaces for `apps/api` and `apps/web`.
- API and Web scaffolds build and their starter tests pass.
- The API currently exposes only the NestJS starter response.
- The Web app still contains the Angular starter screen.
- Root `docker-compose.yml` references missing application Dockerfiles.
- `.env.example` safely uses placeholders but is not yet a complete, validated runtime contract.
- The OpenSpec defines the MVP and epics but has no task identifiers, dependency graph or execution status.
- The README contains an aspirational Nx/pnpm structure that conflicts with the implemented npm workspace.

## Constraints

- Follow root `AGENT.md`, including human review, no hardcoded secrets, minimal changes and evidence-backed completion claims.
- Store money as integer cents and backend timestamps in UTC.
- Bind development host ports to `127.0.0.1`.
- Keep `.env` untracked and never print its secret values.
- Use the database as the future source of truth for reservation concurrency; Redis locks will not replace database constraints.
- No local commit without separate explicit user approval; no push, deployment or remote mutation.

## Approaches Considered

### 1. Vertical increments with a foundation first — selected

Build a small platform foundation, then implement end-to-end capabilities in dependency order. Each increment owns its schema, API, UI and tests where applicable.

Trade-off: initial foundation work precedes visible business screens, but every later slice is deployable and testable without a large integration phase.

### 2. Complete infrastructure before product capabilities

Finish CI/CD, observability, backups and all shared services before business modules.

Trade-off: stronger operations early, but it delays product learning and would implement facilities whose exact consumers are not yet known.

### 3. Complete backend before frontend

Implement all domain modules and APIs, then build Angular experiences.

Trade-off: stable API contracts, but UX and accessibility risks would be discovered late and vertical acceptance criteria would remain untested.

## Selected Architecture

### Repository and runtime

- Retain the root npm workspace and current `apps/api` and `apps/web` applications.
- Keep Compose at the repository root to match the existing implementation; update the OpenSpec text that currently references `infra/docker-compose.yml`.
- Add development Dockerfiles next to each application, but build them from the repository root so the single workspace `package-lock.json` is available to reproducible `npm ci` installs.
- Run asynchronous jobs inside the modular NestJS process initially; introduce `apps/worker` only when measured isolation or scaling requires it.
- Use Drizzle ORM for typed relational access and versioned migrations. Keep PostGIS constraints and spatial queries in explicit SQL where ORM abstractions would hide database behavior.

### Configuration contract

Configuration is grouped by responsibility and every consumed variable has:

- a documented purpose in `.env.example`;
- an explicit required, optional or defaulted classification;
- startup validation in the API when it affects the API;
- a safe local value or an unmistakable replacement marker;
- no production credential or reusable shared secret.

The initial groups are application URLs and ports, PostgreSQL, Redis, S3/MinIO, JWT/cookies, reservation timing, Mercado Pago feature configuration and optional observability. Variables reserved for a later feature remain documented as inactive and are not validated until that feature consumes them.

`.env.example` remains safe to commit. The ignored `.env` receives locally generated unique secrets and consistent MinIO/S3 values. Secret contents are never included in reports or command output.

### API foundation

- Use a global `/api/v1` prefix.
- Add typed configuration access and schema validation.
- Expose liveness and readiness separately. Readiness performs PostgreSQL `SELECT 1`, Redis `PING` and an S3 `HeadBucket` check so a missing or inaccessible local bucket cannot report ready.
- Return RFC 9457-style `application/problem+json` errors with a correlation/trace identifier.
- Configure CORS from the validated allowlist and secure cookie settings by environment.
- Keep OpenAPI enabled only under an explicit development configuration.

### Authentication direction

- Use short-lived JWT access tokens.
- Deliver refresh tokens only in a `Secure`/environment-aware, HttpOnly, SameSite cookie.
- Store only a refresh-token hash server-side and rotate refresh tokens on use.
- Use Argon2id for local passwords.
- Tenant membership and authorization remain server-side checks; a host or token claim alone is not authorization evidence.

Sprint 0A defines only the authentication configuration and interfaces. It does not add functional login or token issuance. User persistence, login, refresh, logout, token rotation and membership authorization are implemented and tested in `CORE-02`.

### OpenSpec task tracking

Add a new execution section to `docs/openspec/specification.md`. Each task uses a stable identifier and includes:

- status: `PENDING`, `IN_PROGRESS`, `BLOCKED` or `VERIFIED`;
- dependency identifiers, using `none` for independent work;
- exact deliverable and acceptance criteria;
- verification command or evidence required;
- checkbox subtasks small enough to review independently.

Tasks are ordered in two groups:

1. Independent foundation tasks that can be implemented without an unfinished domain feature.
2. Dependent vertical slices whose prerequisites are listed explicitly.

The initial dependency graph is:

```text
FND-01 Architecture records
  ├─ FND-02 Environment contract and validation
  ├─ FND-03 Local containers and Compose
  └─ FND-04 API operational baseline
       └─ CORE-01 Database and migrations
            └─ CORE-02 Users, JWT sessions and memberships
                 └─ CORE-03 Tenant isolation and audit
                      ├─ VEN-01 Venues
                      │    └─ LAY-01 Layout versioning and geometry
                      │         └─ EVT-01 Events, stands and pricing
                      └─ EXH-01 Exhibitors
                           └─ RES-01 Reservation holds and concurrency
                                └─ PAY-01 Mercado Pago and reconciliation
                                     ├─ PUB-01 Public catalog and map
                                     └─ REP-01 Reports and exports
```

Cross-cutting accessibility, security, observability and test requirements are attached to the slice that introduces the behavior, rather than postponed to a final cleanup phase.

## First Delivery Boundary

Sprint 0A is complete only when:

- `.env.example` and ignored `.env` have a consistent, documented local contract;
- invalid required configuration prevents API startup with a sanitized message;
- Docker Compose validates and starts all declared services;
- API liveness and dependency readiness checks behave distinctly;
- Web can reach the versioned API through local configuration;
- lint, unit tests, relevant integration tests and production builds pass;
- the OpenSpec contains the independent/dependent task graph and evidence fields;
- README instructions match the actual npm workspace and Compose paths.

The remaining original Sprint 0 work is preserved as later tracked tasks: CI automation, UX foundations and detailed RLS design. Those tasks may begin independently where their interfaces are stable, but they are not silently marked complete by Sprint 0A.

## Verification Strategy

- Unit-test configuration parsing without reading developer secrets.
- Test missing, malformed and environment-incompatible values.
- Validate Compose rendering without printing resolved secret values.
- Start the stack and inspect service health, loopback bindings and restart counts.
- Exercise liveness and readiness before and after dependency interruption where safe.
- Run workspace lint, tests and builds.
- Recheck `git status` and inspect the diff for secrets and unrelated changes.

## Risks and Mitigations

- **Configuration sprawl:** add variables only with a named consumer and validation rule.
- **False completeness:** keep future integrations inactive until their slice includes tests.
- **Cookie behavior differs locally and in production:** derive `Secure`, domain and SameSite policy from explicit environment settings and test both profiles.
- **Compose hides dependency failures:** readiness must probe dependencies rather than merely returning HTTP 200.
- **OpenSpec becomes stale:** completion requires evidence in the same OpenSpec task that was implemented.
- **JWT revocation ambiguity:** rotating hashed refresh sessions provide server-side revocation; access tokens remain short-lived.

## Human Review Points

- Review all generated local environment names and defaults before accepting them.
- Review authentication and cookie policy before the Core SaaS slice is merged.
- Review every OpenSpec status change against the cited test or runtime evidence.
- Approve any local commit separately after receiving the required delivery report.
