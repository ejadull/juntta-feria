ALTER TABLE "platform_subscriptions" DROP CONSTRAINT "platform_subscriptions_status_check";--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ALTER COLUMN "current_period_end" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN "init_point" text;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN "payer_email" text;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_subscriptions_provider_unique" ON "platform_subscriptions" USING btree ("provider_subscription_id");--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_status_check" CHECK ("platform_subscriptions"."status" IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED'));