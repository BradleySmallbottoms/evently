CREATE TABLE "digital_codes" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"revealed_at" timestamp with time zone,
	"rotation_s" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digital_codes" ADD CONSTRAINT "digital_codes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;