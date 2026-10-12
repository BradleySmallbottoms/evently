CREATE TYPE "public"."push_delivery_status" AS ENUM('pending', 'deferred', 'sent');--> statement-breakpoint
CREATE TYPE "public"."push_message_status" AS ENUM('pending', 'approved', 'sending', 'sent', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "push_message_deliveries" (
	"push_message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "push_delivery_status" DEFAULT 'pending' NOT NULL,
	"deferred_until_message_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_message_deliveries_push_message_id_user_id_pk" PRIMARY KEY("push_message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "push_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "push_message_status" DEFAULT 'pending' NOT NULL,
	"title_sv" text NOT NULL,
	"body_sv" text NOT NULL,
	"title_en" text NOT NULL,
	"body_en" text NOT NULL,
	"send_at" timestamp with time zone,
	"copy_edited" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_admin_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "notifications_user_event_reason_idx";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_message_id" uuid;--> statement-breakpoint
ALTER TABLE "push_message_deliveries" ADD CONSTRAINT "push_message_deliveries_push_message_id_push_messages_id_fk" FOREIGN KEY ("push_message_id") REFERENCES "public"."push_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_message_deliveries" ADD CONSTRAINT "push_message_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_message_deliveries" ADD CONSTRAINT "push_message_deliveries_deferred_until_message_id_push_messages_id_fk" FOREIGN KEY ("deferred_until_message_id") REFERENCES "public"."push_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_approved_by_admin_id_admin_users_id_fk" FOREIGN KEY ("approved_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_message_deliveries_user_status_idx" ON "push_message_deliveries" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "push_message_deliveries_deferred_idx" ON "push_message_deliveries" USING btree ("deferred_until_message_id");--> statement-breakpoint
CREATE INDEX "push_messages_event_id_idx" ON "push_messages" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "push_messages_status_send_at_idx" ON "push_messages" USING btree ("status","send_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_push_message_id_push_messages_id_fk" FOREIGN KEY ("push_message_id") REFERENCES "public"."push_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_push_message_reason_idx" ON "notifications" USING btree ("user_id","push_message_id","reason");--> statement-breakpoint
CREATE INDEX "notifications_event_id_idx" ON "notifications" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_messages_one_open_per_event_idx" ON "push_messages" ("event_id") WHERE "status" IN ('pending', 'approved', 'sending', 'rejected');