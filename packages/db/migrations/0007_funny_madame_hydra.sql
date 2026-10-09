CREATE TYPE "public"."notification_reason" AS ENUM('nearby', 'publisher', 'event');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"reason" "notification_reason" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text DEFAULT 'Europe/Stockholm' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours_start_min" integer DEFAULT 1320 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours_end_min" integer DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_event_reason_idx" ON "notifications" USING btree ("user_id","event_id","reason");--> statement-breakpoint
CREATE INDEX "notifications_user_sent_at_idx" ON "notifications" USING btree ("user_id","sent_at");