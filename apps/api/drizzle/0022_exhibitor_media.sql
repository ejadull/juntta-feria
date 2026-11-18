ALTER TABLE "exhibitor_photos" DROP CONSTRAINT "exhibitor_photos_status_check";--> statement-breakpoint
ALTER TABLE "exhibitor_photos" DROP CONSTRAINT "exhibitor_photos_content_type_check";--> statement-breakpoint
ALTER TABLE "exhibitor_photos" DROP CONSTRAINT "exhibitor_photos_size_check";--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD COLUMN "kind" text DEFAULT 'IMAGE' NOT NULL;--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD COLUMN "duration_s" integer;--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exhibitor_photos_event_idx" ON "exhibitor_photos" USING btree ("tenant_id","event_id");--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_kind_check" CHECK ("exhibitor_photos"."kind" IN ('IMAGE', 'VIDEO'));--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_caption_check" CHECK ("exhibitor_photos"."caption" IS NULL OR char_length("exhibitor_photos"."caption") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_publication_event_check" CHECK (("exhibitor_photos"."caption" IS NULL AND "exhibitor_photos"."kind" = 'IMAGE') OR "exhibitor_photos"."event_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_duration_check" CHECK (("exhibitor_photos"."kind" = 'IMAGE' AND "exhibitor_photos"."duration_s" IS NULL)
        OR ("exhibitor_photos"."kind" = 'VIDEO' AND "exhibitor_photos"."duration_s" BETWEEN 1 AND 60 AND "exhibitor_photos"."event_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_status_check" CHECK ("exhibitor_photos"."status" IN ('PENDING', 'READY', 'HIDDEN'));--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_content_type_check" CHECK (("exhibitor_photos"."kind" = 'IMAGE' AND "exhibitor_photos"."content_type" IN ('image/jpeg', 'image/png', 'image/webp'))
        OR ("exhibitor_photos"."kind" = 'VIDEO' AND "exhibitor_photos"."content_type" IN ('video/mp4', 'video/webm')));--> statement-breakpoint
ALTER TABLE "exhibitor_photos" ADD CONSTRAINT "exhibitor_photos_size_check" CHECK ("exhibitor_photos"."size_bytes" > 0 AND (
        ("exhibitor_photos"."kind" = 'IMAGE' AND "exhibitor_photos"."size_bytes" <= 5242880)
        OR ("exhibitor_photos"."kind" = 'VIDEO' AND "exhibitor_photos"."size_bytes" <= 52428800)));