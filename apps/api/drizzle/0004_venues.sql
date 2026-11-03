CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"timezone" text NOT NULL,
	"width_m" numeric(10, 2) NOT NULL,
	"height_m" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "venues_type_check" CHECK ("venues"."type" IN ('FIXED', 'TEMPORARY')),
	CONSTRAINT "venues_name_check" CHECK (btrim("venues"."name") <> ''),
	CONSTRAINT "venues_size_check" CHECK ("venues"."width_m" > 0 AND "venues"."height_m" > 0)
);
--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venues_tenant_name_unique" ON "venues" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint
-- VEN-01: tenant isolation by RLS, same pattern as audit_logs (CORE-03).
ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "venues_tenant_isolation" ON "venues"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);