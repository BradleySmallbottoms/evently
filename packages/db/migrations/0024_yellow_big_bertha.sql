CREATE TYPE "public"."event_link_audience" AS ENUM('public', 'attendees');--> statement-breakpoint
ALTER TABLE "event_links" ADD COLUMN "audience" "event_link_audience" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "check_in_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "attendee_text" text;