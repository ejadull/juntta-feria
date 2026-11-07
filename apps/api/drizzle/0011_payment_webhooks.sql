CREATE TABLE "payment_webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"topic" text NOT NULL,
	"data_id" text NOT NULL,
	"tenant_id" uuid,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"outcome" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_webhook_inbox_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "payment_webhook_inbox_status_check" CHECK ("payment_webhook_inbox"."status" IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "payment_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "payment_status" text;