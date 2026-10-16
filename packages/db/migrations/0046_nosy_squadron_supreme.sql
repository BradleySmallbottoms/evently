CREATE TYPE "public"."event_language" AS ENUM('sv', 'en');--> statement-breakpoint
CREATE TABLE "event_translations" (
	"event_id" uuid NOT NULL,
	"language" "event_language" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "event_translations_event_id_language_pk" PRIMARY KEY("event_id","language")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "language" "event_language" DEFAULT 'sv' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_translations_language_idx" ON "event_translations" USING btree ("language");