CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"payment_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" uuid NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_idempotency_unique" UNIQUE("tenant_id","reservation_id","idempotency_key","payment_id"),
	CONSTRAINT "payment_refunds_kind_check" CHECK ("payment_refunds"."kind" IN ('REFUND', 'CANCEL')),
	CONSTRAINT "payment_refunds_status_check" CHECK ("payment_refunds"."status" IN ('PENDING', 'SUCCEEDED')),
	CONSTRAINT "payment_refunds_amount_check" CHECK ("payment_refunds"."amount_cents" IS NULL OR ("payment_refunds"."kind" = 'REFUND' AND "payment_refunds"."amount_cents" > 0))
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_attempt_fk" FOREIGN KEY ("tenant_id","attempt_id") REFERENCES "public"."payment_attempts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_refunds_reservation_idx" ON "payment_refunds" USING btree ("reservation_id");--> statement-breakpoint
-- PAY-06: tenant isolation by RLS, same pattern as CORE-03.
ALTER TABLE "payment_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_refunds_tenant_isolation" ON "payment_refunds"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
