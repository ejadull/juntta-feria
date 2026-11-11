CREATE TABLE "exhibitor_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibitor_categories_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "exhibitor_categories_name_check" CHECK (btrim("exhibitor_categories"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "exhibitor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint,
	"uploaded_at" timestamp with time zone,
	"uploaded_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibitor_documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "exhibitor_documents_type_check" CHECK ("exhibitor_documents"."type" IN ('CONSTANCIA_AFIP', 'SEGURO', 'HABILITACION', 'OTRO')),
	CONSTRAINT "exhibitor_documents_status_check" CHECK ("exhibitor_documents"."status" IN ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "exhibitor_documents_review_check" CHECK (("exhibitor_documents"."status" = 'PENDING') = ("exhibitor_documents"."reviewed_at" IS NULL)),
	CONSTRAINT "exhibitor_documents_size_check" CHECK ("exhibitor_documents"."size_bytes" IS NULL OR "exhibitor_documents"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "exhibitors" DROP CONSTRAINT "exhibitors_category_check";--> statement-breakpoint
ALTER TABLE "exhibitors" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "exhibitor_categories" ADD CONSTRAINT "exhibitor_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_documents" ADD CONSTRAINT "exhibitor_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_documents" ADD CONSTRAINT "exhibitor_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_documents" ADD CONSTRAINT "exhibitor_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_documents" ADD CONSTRAINT "exhibitor_documents_exhibitor_fk" FOREIGN KEY ("tenant_id","exhibitor_id") REFERENCES "public"."exhibitors"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exhibitor_categories_name_unique" ON "exhibitor_categories" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "exhibitor_documents_exhibitor_idx" ON "exhibitor_documents" USING btree ("tenant_id","exhibitor_id");--> statement-breakpoint
ALTER TABLE "exhibitors" ADD CONSTRAINT "exhibitors_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."exhibitor_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- EXH-02: the free-text rubro becomes a per-organization table. Existing values are kept: one
-- category per tenant and per case/space-insensitive name, and every exhibitor is linked to it.
-- Runs per tenant so the FORCEd RLS policies apply to the owner role as well.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    INSERT INTO "exhibitor_categories" ("tenant_id", "name")
      SELECT DISTINCT ON (lower(btrim("category"))) t, btrim("category")
      FROM "exhibitors"
      WHERE "tenant_id" = t AND "category" IS NOT NULL AND btrim("category") <> ''
      ORDER BY lower(btrim("category")), btrim("category");
    UPDATE "exhibitors" e SET "category_id" = c."id"
      FROM "exhibitor_categories" c
      WHERE e."tenant_id" = t AND c."tenant_id" = t AND lower(btrim(c."name")) = lower(btrim(e."category"));
    IF EXISTS (SELECT 1 FROM "exhibitors" WHERE "tenant_id" = t AND "category_id" IS NULL AND "category" IS NOT NULL) THEN
      RAISE EXCEPTION 'exhibitors.category could not be migrated for tenant %', t;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;--> statement-breakpoint
-- The text column is dropped: every reader (organizer DTOs, public portal) joins the category name.
ALTER TABLE "exhibitors" DROP COLUMN "category";--> statement-breakpoint
-- EXH-02 / EXH-03: tenant isolation by RLS, same pattern as CORE-03.
ALTER TABLE "exhibitor_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exhibitor_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exhibitor_categories_tenant_isolation" ON "exhibitor_categories"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "exhibitor_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exhibitor_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exhibitor_documents_tenant_isolation" ON "exhibitor_documents"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
