ALTER TYPE "public"."event_status" ADD VALUE 'pending_scan' BEFORE 'in_review';--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "publisher_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "scan_claimed_until" timestamp with time zone;