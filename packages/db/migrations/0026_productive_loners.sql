CREATE TYPE "public"."push_audience" AS ENUM('event_match', 'everyone', 'tag_interest');--> statement-breakpoint
CREATE TYPE "public"."push_message_kind" AS ENUM('event', 'broadcast');--> statement-breakpoint
ALTER TYPE "public"."notification_reason" ADD VALUE 'broadcast';--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_messages" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_messages" ADD COLUMN "kind" "push_message_kind" DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_messages" ADD COLUMN "audience" "push_audience" DEFAULT 'event_match' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_messages" ADD COLUMN "audience_tag_id" uuid;--> statement-breakpoint
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_audience_tag_id_tags_id_fk" FOREIGN KEY ("audience_tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_messages_kind_idx" ON "push_messages" USING btree ("kind");