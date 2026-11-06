CREATE TABLE "exhibitor_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"phone" text,
	"name" text,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibitor_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "exhibitor_invitations_final_state_check" CHECK ("exhibitor_invitations"."accepted_at" IS NULL OR "exhibitor_invitations"."revoked_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exhibitor_invitations" ADD CONSTRAINT "exhibitor_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_invitations" ADD CONSTRAINT "exhibitor_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_invitations" ADD CONSTRAINT "exhibitor_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exhibitor_invitations_tenant_created_idx" ON "exhibitor_invitations" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- EXH-04: tenant isolation by RLS for the application role. Not FORCEd on purpose: the lookup
-- below runs as the table owner, because a public invitation link carries no tenant.
ALTER TABLE "exhibitor_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exhibitor_invitations_tenant_isolation" ON "exhibitor_invitations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- The only cross-tenant read: from the hash of a 256-bit token to (id, tenant) of a usable
-- invitation. Everything else (details, acceptance) then runs inside withTenant under RLS.
CREATE FUNCTION exhibitor_invitation_lookup(p_token_hash text)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id FROM exhibitor_invitations i
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION exhibitor_invitation_lookup(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION exhibitor_invitation_lookup(text) TO juntta_app;