CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_action_check" CHECK (btrim("audit_logs"."action") <> '')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- CORE-03 (§2.2): tenant isolation by RLS; FORCE also applies it to a non-superuser owner.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Append-only for the application: the default privileges of 0000 granted UPDATE/DELETE.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM juntta_app;