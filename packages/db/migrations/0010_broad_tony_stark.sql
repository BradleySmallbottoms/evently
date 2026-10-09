CREATE TYPE "public"."notification_push_state" AS ENUM('pending', 'sent', 'aggregated');--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_state" "notification_push_state" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_push_state_idx" ON "notifications" USING btree ("push_state","sent_at");