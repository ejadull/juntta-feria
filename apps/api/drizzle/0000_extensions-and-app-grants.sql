-- CORE-01 (ADR 0005, §2.2). Runs as the owner/migration role, never as juntta_app.
-- juntta_app itself is created by scripts/db-setup.mjs before migrations: creating roles needs
-- CREATEROLE and a password from the environment, which do not belong in a versioned migration.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
-- The app role only reads and writes data: no DDL in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO juntta_app;
--> statement-breakpoint
-- Every table/sequence the owner creates from now on is usable (DML only) by juntta_app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO juntta_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO juntta_app;
