CREATE TABLE "seller_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"seller_id" text NOT NULL,
	"live_mode" boolean NOT NULL,
	"access_token_sealed" text NOT NULL,
	"refresh_token_sealed" text NOT NULL,
	"key_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone,
	CONSTRAINT "seller_accounts_tenant_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "seller_accounts" ADD CONSTRAINT "seller_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_accounts" ADD CONSTRAINT "seller_accounts_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- PAY-07: tenant isolation by RLS, same pattern as CORE-03.
ALTER TABLE "seller_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seller_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "seller_accounts_tenant_isolation" ON "seller_accounts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
