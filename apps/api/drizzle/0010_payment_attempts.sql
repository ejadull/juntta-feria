CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"preference_id" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_attempts_idempotency_unique" UNIQUE("tenant_id","reservation_id","idempotency_key"),
	CONSTRAINT "payment_attempts_status_check" CHECK ("payment_attempts"."status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
	CONSTRAINT "payment_attempts_amount_check" CHECK ("payment_attempts"."amount_cents" >= 0),
	CONSTRAINT "payment_attempts_checkout_check" CHECK (("payment_attempts"."preference_id" IS NULL) = ("payment_attempts"."checkout_url" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_pending_per_reservation" ON "payment_attempts" USING btree ("reservation_id") WHERE "payment_attempts"."status" = 'PENDING';--> statement-breakpoint
-- PAY-02: tenant isolation by RLS, same pattern as CORE-03.
ALTER TABLE "payment_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_attempts_tenant_isolation" ON "payment_attempts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
