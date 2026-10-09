CREATE TYPE "public"."event_content_kind" AS ENUM('map', 'schedule', 'info', 'file');--> statement-breakpoint
CREATE TYPE "public"."event_content_visibility" AS ENUM('public', 'attendees');--> statement-breakpoint
CREATE TABLE "event_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" "event_content_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"s3_key" text,
	"visibility" "event_content_visibility" DEFAULT 'attendees' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_content" ADD CONSTRAINT "event_content_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_content_event_id_idx" ON "event_content" USING btree ("event_id");