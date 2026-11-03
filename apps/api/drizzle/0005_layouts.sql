CREATE TABLE "layout_objects" (
	"id" uuid NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"layout_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"geometry" geometry(Polygon,0) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "layout_objects_pk" PRIMARY KEY("layout_version_id","id"),
	CONSTRAINT "layout_objects_tenant_version_id_unique" UNIQUE("tenant_id","layout_version_id","id"),
	CONSTRAINT "layout_objects_kind_check" CHECK ("layout_objects"."kind" IN ('STAND', 'AISLE', 'ENTRY', 'EXIT', 'UTILITY', 'OBSTACLE', 'EMERGENCY')),
	CONSTRAINT "layout_objects_metadata_check" CHECK (jsonb_typeof("layout_objects"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "layout_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"venue_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_templates_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "layout_templates_name_check" CHECK (btrim("layout_templates"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "layout_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"width_m" numeric(10, 2) NOT NULL,
	"height_m" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_versions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "layout_versions_template_version_unique" UNIQUE("template_id","version"),
	CONSTRAINT "layout_versions_status_check" CHECK ("layout_versions"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
	CONSTRAINT "layout_versions_published_at_check" CHECK (("layout_versions"."status" = 'DRAFT') = ("layout_versions"."published_at" IS NULL)),
	CONSTRAINT "layout_versions_version_check" CHECK ("layout_versions"."version" > 0),
	CONSTRAINT "layout_versions_size_check" CHECK ("layout_versions"."width_m" > 0 AND "layout_versions"."height_m" > 0)
);
--> statement-breakpoint
ALTER TABLE "layout_objects" ADD CONSTRAINT "layout_objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_objects" ADD CONSTRAINT "layout_objects_version_fk" FOREIGN KEY ("tenant_id","layout_version_id") REFERENCES "public"."layout_versions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_templates" ADD CONSTRAINT "layout_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_templates" ADD CONSTRAINT "layout_templates_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "public"."venues"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_versions" ADD CONSTRAINT "layout_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_versions" ADD CONSTRAINT "layout_versions_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."layout_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "layout_templates_tenant_name_unique" ON "layout_templates" USING btree ("tenant_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "layout_versions_one_draft" ON "layout_versions" USING btree ("template_id") WHERE "layout_versions"."status" = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "layout_versions_one_published" ON "layout_versions" USING btree ("template_id") WHERE "layout_versions"."status" = 'PUBLISHED';--> statement-breakpoint
-- LAY-01: spatial index for the publish validation (§3.4).
CREATE INDEX "layout_objects_geometry_idx" ON "layout_objects" USING gist ("geometry");--> statement-breakpoint
-- Tenant isolation by RLS, same pattern as CORE-03.
ALTER TABLE "layout_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layout_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "layout_templates_tenant_isolation" ON "layout_templates"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "layout_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layout_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "layout_versions_tenant_isolation" ON "layout_versions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "layout_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layout_objects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "layout_objects_tenant_isolation" ON "layout_objects"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- INV-06 in the database: a published version is frozen; it may only move to ARCHIVED.
CREATE FUNCTION layout_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'layout version % is not a draft', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PUBLISHED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status = 'ARCHIVED'
     AND (NEW.tenant_id, NEW.template_id, NEW.version, NEW.width_m, NEW.height_m, NEW.published_at)
         IS NOT DISTINCT FROM
         (OLD.tenant_id, OLD.template_id, OLD.version, OLD.width_m, OLD.height_m, OLD.published_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'layout version % cannot change from % to %', OLD.id, OLD.status, NEW.status
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "layout_versions_guard" BEFORE UPDATE OR DELETE ON "layout_versions"
  FOR EACH ROW EXECUTE FUNCTION layout_versions_guard();--> statement-breakpoint
-- Objects only change while their version is a draft.
CREATE FUNCTION layout_objects_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.layout_version_id ELSE NEW.layout_version_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.layout_version_id <> OLD.layout_version_id THEN
    RAISE EXCEPTION 'layout objects cannot move between versions' USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM layout_versions v WHERE v.id = target AND v.status <> 'DRAFT') THEN
    RAISE EXCEPTION 'layout version % is not a draft', target USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "layout_objects_draft_only" BEFORE INSERT OR UPDATE OR DELETE ON "layout_objects"
  FOR EACH ROW EXECUTE FUNCTION layout_objects_draft_only();