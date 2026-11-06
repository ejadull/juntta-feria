CREATE TABLE "platform_subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"provider_subscription_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_subscriptions_status_check" CHECK ("platform_subscriptions"."status" IN ('ACTIVE', 'PAST_DUE', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"event_stand_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'HELD' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"price_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"terms_version" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "reservations_idempotency_unique" UNIQUE("tenant_id","user_id","idempotency_key"),
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" IN ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED')),
	CONSTRAINT "reservations_hold_check" CHECK ("reservations"."status" <> 'HELD' OR "reservations"."hold_expires_at" IS NOT NULL),
	CONSTRAINT "reservations_price_check" CHECK ("reservations"."price_cents" >= 0),
	CONSTRAINT "reservations_terms_check" CHECK (btrim("reservations"."terms_version") <> '')
);
--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_event_stand_fk" FOREIGN KEY ("tenant_id","event_stand_id") REFERENCES "public"."event_stands"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_exhibitor_fk" FOREIGN KEY ("tenant_id","exhibitor_id") REFERENCES "public"."exhibitors"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_active_per_stand" ON "reservations" USING btree ("event_stand_id") WHERE "reservations"."status" IN ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'REFUND_PENDING');--> statement-breakpoint
CREATE INDEX "reservations_exhibitor_idx" ON "reservations" USING btree ("exhibitor_id");--> statement-breakpoint
-- RES-01: tenant isolation by RLS, same pattern as CORE-03. platform_subscriptions is global per
-- user (paid to the platform, valid in every organization), like users: no tenant, no RLS.
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "reservations_tenant_isolation" ON "reservations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);