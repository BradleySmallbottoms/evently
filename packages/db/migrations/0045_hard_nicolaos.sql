CREATE TYPE "public"."content_verdict" AS ENUM('safe', 'harmful', 'spam', 'unknown');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "content_verdict" "content_verdict" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "llm_output" jsonb;