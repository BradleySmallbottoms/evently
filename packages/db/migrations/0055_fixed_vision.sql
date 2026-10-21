CREATE TYPE "public"."tip_image_status" AS ENUM('scanning', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tip_path" AS ENUM('photo', 'text');--> statement-breakpoint
CREATE TYPE "public"."tip_status" AS ENUM('collecting', 'needs_input', 'submitted', 'scanned', 'failed');--> statement-breakpoint
ALTER TYPE "public"."notification_reason" ADD VALUE 'tip';--> statement-breakpoint
CREATE TABLE "event_tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path" "tip_path" NOT NULL,
	"status" "tip_status" DEFAULT 'collecting' NOT NULL,
	"locale" "event_language" DEFAULT 'sv' NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_text" text,
	"event_id" uuid,
	"scan_status" text,
	"submitted_at" timestamp with time zone,
	"analyzed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tip_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tip_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"content_type" text NOT NULL,
	"status" "tip_image_status" DEFAULT 'scanning' NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tip_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tip_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_tips" ADD CONSTRAINT "event_tips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tips" ADD CONSTRAINT "event_tips_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tip_images" ADD CONSTRAINT "tip_images_tip_id_event_tips_id_fk" FOREIGN KEY ("tip_id") REFERENCES "public"."event_tips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tip_messages" ADD CONSTRAINT "tip_messages_tip_id_event_tips_id_fk" FOREIGN KEY ("tip_id") REFERENCES "public"."event_tips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_tips_user_id_idx" ON "event_tips" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_tips_event_id_idx" ON "event_tips" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_tips_user_submitted_idx" ON "event_tips" USING btree ("user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "tip_images_tip_id_idx" ON "tip_images" USING btree ("tip_id");--> statement-breakpoint
CREATE INDEX "tip_messages_tip_id_idx" ON "tip_messages" USING btree ("tip_id");--> statement-breakpoint
-- User tips are not fetched on a schedule. The scan job still claims their events.
INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333310',
  'user-tips',
  'api',
  '0 */6 * * *',
  '{}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;