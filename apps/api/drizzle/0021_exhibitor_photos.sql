CREATE TABLE "exhibitor_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"alt" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibitor_photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "exhibitor_photos_status_check" CHECK ("exhibitor_photos"."status" IN ('PENDING', 'READY')),
	CONSTRAINT "exhibitor_photos_content_type_check" CHECK ("exhibitor_photos"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "exhibitor_photos_size_check" CHECK ("exhibitor_photos"."size_bytes" > 0),
	CONSTRAINT "exhibitor_photos_alt_check" CHECK ("exhibitor_photos"."alt" IS NULL OR char_length("exhibitor_photos"."alt") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_exhibitor_fk" FOREIGN KEY ("tenant_id","exhibitor_id") REFERENCES "public"."exhibitors"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exhibitor_photos_exhibitor_idx" ON "exhibitor_photos" USING btree ("tenant_id","exhibitor_id");--> statement-breakpoint
-- Tenant isolation by RLS, same pattern as exhibitor_documents (CORE-03).
ALTER TABLE "exhibitor_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exhibitor_photos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exhibitor_photos_tenant_isolation" ON "exhibitor_photos"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
