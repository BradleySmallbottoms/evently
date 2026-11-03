ALTER TYPE "public"."push_audience" ADD VALUE 'user';--> statement-breakpoint
ALTER TYPE "public"."push_message_kind" ADD VALUE 'tip';--> statement-breakpoint
ALTER TABLE "push_messages" ADD COLUMN "audience_user_id" uuid;--> statement-breakpoint
ALTER TABLE "push_messages" ADD COLUMN "tip_id" uuid;--> statement-breakpoint
ALTER TABLE "push_messages" ADD COLUMN "tip_status" text;--> statement-breakpoint
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_audience_user_id_users_id_fk" FOREIGN KEY ("audience_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_tip_id_event_tips_id_fk" FOREIGN KEY ("tip_id") REFERENCES "public"."event_tips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_messages_audience_user_id_idx" ON "push_messages" USING btree ("audience_user_id");--> statement-breakpoint
CREATE INDEX "push_messages_tip_id_idx" ON "push_messages" USING btree ("tip_id");