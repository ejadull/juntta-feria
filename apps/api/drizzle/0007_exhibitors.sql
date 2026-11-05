CREATE TABLE "exhibitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text NOT NULL,
	"tax_id" text,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo_key" text,
	"public_contact_opt_in" boolean DEFAULT false NOT NULL,
	"public_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibitors_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "exhibitors_tenant_user_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "exhibitors_names_check" CHECK (btrim("exhibitors"."legal_name") <> '' AND btrim("exhibitors"."trade_name") <> ''),
	CONSTRAINT "exhibitors_category_check" CHECK (btrim("exhibitors"."category") <> ''),
	CONSTRAINT "exhibitors_tax_id_check" CHECK ("exhibitors"."tax_id" IS NULL OR "exhibitors"."tax_id" ~ '^[0-9]{11}$'),
	CONSTRAINT "exhibitors_consent_check" CHECK ("exhibitors"."public_contact_opt_in" = ("exhibitors"."public_consent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "exhibitors" ADD CONSTRAINT "exhibitors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitors" ADD CONSTRAINT "exhibitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- EXH-01: tenant isolation by RLS, same pattern as CORE-03.
ALTER TABLE "exhibitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exhibitors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exhibitors_tenant_isolation" ON "exhibitors"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);