CREATE TYPE "public"."event_image_focal_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "event_images" ADD COLUMN "focal_x" double precision;--> statement-breakpoint
ALTER TABLE "event_images" ADD COLUMN "focal_y" double precision;--> statement-breakpoint
ALTER TABLE "event_images" ADD COLUMN "focal_status" "event_image_focal_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_images" ADD COLUMN "focal_claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_images" ADD COLUMN "focal_output" jsonb;--> statement-breakpoint
CREATE INDEX "event_images_focal_pending_idx" ON "event_images" USING btree ("created_at") WHERE "event_images"."focal_status" = 'pending' and "event_images"."role" <> 'poster';--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_focal_pair" CHECK (("event_images"."focal_x" is null and "event_images"."focal_y" is null) or ("event_images"."focal_x" >= 0 and "event_images"."focal_x" <= 1 and "event_images"."focal_y" >= 0 and "event_images"."focal_y" <= 1));