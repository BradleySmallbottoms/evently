CREATE TABLE "event_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_reports_user_event_idx" ON "event_reports" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "event_reports_event_id_idx" ON "event_reports" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_reports_created_at_idx" ON "event_reports" USING btree ("created_at");