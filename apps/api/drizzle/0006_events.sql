CREATE TABLE "event_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sectors_tenant_event_id_unique" UNIQUE("tenant_id","event_id","id"),
	CONSTRAINT "event_sectors_name_check" CHECK (btrim("event_sectors"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "event_stands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"layout_version_id" uuid NOT NULL,
	"layout_object_id" uuid NOT NULL,
	"sector_id" uuid,
	"code" text NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"price_cents" bigint,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_stands_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "event_stands_event_code_unique" UNIQUE("tenant_id","event_id","code"),
	CONSTRAINT "event_stands_event_object_unique" UNIQUE("event_id","layout_object_id"),
	CONSTRAINT "event_stands_status_check" CHECK ("event_stands"."status" IN ('AVAILABLE', 'BLOCKED', 'ASSIGNED', 'DISABLED')),
	CONSTRAINT "event_stands_price_check" CHECK ("event_stands"."price_cents" IS NULL OR "event_stands"."price_cents" >= 0),
	CONSTRAINT "event_stands_currency_check" CHECK ("event_stands"."currency" = 'ARS')
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"layout_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"sales_open_at" timestamp with time zone NOT NULL,
	"sales_close_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "events_tenant_id_layout_unique" UNIQUE("tenant_id","id","layout_version_id"),
	CONSTRAINT "events_status_check" CHECK ("events"."status" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'CLOSED', 'CANCELLED')),
	CONSTRAINT "events_name_check" CHECK (btrim("events"."name") <> ''),
	CONSTRAINT "events_slug_check" CHECK ("events"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "events_dates_check" CHECK ("events"."starts_at" < "events"."ends_at" AND "events"."sales_open_at" < "events"."sales_close_at" AND "events"."sales_close_at" <= "events"."ends_at"),
	CONSTRAINT "events_published_at_check" CHECK ("events"."status" = 'DRAFT' OR "events"."status" = 'CANCELLED' OR "events"."published_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "event_sectors" ADD CONSTRAINT "event_sectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sectors" ADD CONSTRAINT "event_sectors_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_stands" ADD CONSTRAINT "event_stands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_stands" ADD CONSTRAINT "event_stands_event_fk" FOREIGN KEY ("tenant_id","event_id","layout_version_id") REFERENCES "public"."events"("tenant_id","id","layout_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_stands" ADD CONSTRAINT "event_stands_layout_object_fk" FOREIGN KEY ("tenant_id","layout_version_id","layout_object_id") REFERENCES "public"."layout_objects"("tenant_id","layout_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_stands" ADD CONSTRAINT "event_stands_sector_fk" FOREIGN KEY ("tenant_id","event_id","sector_id") REFERENCES "public"."event_sectors"("tenant_id","event_id","id") ON DELETE SET NULL ("sector_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "public"."venues"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_layout_version_fk" FOREIGN KEY ("tenant_id","layout_version_id") REFERENCES "public"."layout_versions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_sectors_name_unique" ON "event_sectors" USING btree ("tenant_id","event_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "event_stands_event_idx" ON "event_stands" USING btree ("event_id");--> statement-breakpoint
-- EVT-01: tenant isolation by RLS, same pattern as CORE-03.
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "events_tenant_isolation" ON "events"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "event_sectors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_sectors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "event_sectors_tenant_isolation" ON "event_sectors"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "event_stands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_stands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "event_stands_tenant_isolation" ON "event_stands"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- INV-03 in the database: an event is created on a PUBLISHED layout version and never moves to
-- another layout or venue (its stands were generated from that layout).
CREATE FUNCTION events_layout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.layout_version_id <> OLD.layout_version_id OR NEW.venue_id <> OLD.venue_id THEN
      RAISE EXCEPTION 'event % cannot change its layout or venue', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM layout_versions v WHERE v.id = NEW.layout_version_id AND v.status = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'layout version % is not published', NEW.layout_version_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "events_layout_guard" BEFORE INSERT OR UPDATE ON "events"
  FOR EACH ROW EXECUTE FUNCTION events_layout_guard();