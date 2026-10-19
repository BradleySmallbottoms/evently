CREATE TYPE "public"."publisher_status" AS ENUM('pending_scan', 'in_review', 'published');--> statement-breakpoint
ALTER TABLE "publishers" ADD COLUMN "status" "publisher_status";--> statement-breakpoint
ALTER TABLE "publishers" ADD COLUMN "scan_claimed_until" timestamp with time zone;--> statement-breakpoint
UPDATE "publishers" SET "status" = 'published' WHERE "verified" = true;--> statement-breakpoint
UPDATE "publishers" SET "status" = 'pending_scan' WHERE "verified" = false AND "is_temporary" = true AND (meta->'lookup') IS NULL;--> statement-breakpoint
UPDATE "publishers" SET "status" = 'in_review' WHERE "status" IS NULL;--> statement-breakpoint
ALTER TABLE "publishers" ALTER COLUMN "status" SET DEFAULT 'in_review';--> statement-breakpoint
ALTER TABLE "publishers" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "publishers" DROP COLUMN "verified";--> statement-breakpoint
CREATE INDEX "publishers_status_created_at_idx" ON "publishers" USING btree ("status","created_at");
