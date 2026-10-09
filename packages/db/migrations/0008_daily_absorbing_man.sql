CREATE TYPE "public"."subscription_target" AS ENUM('publisher', 'event');--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" uuid NOT NULL,
	"target_type" "subscription_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_target_type_target_id_pk" PRIMARY KEY("user_id","target_type","target_id")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_target_idx" ON "subscriptions" USING btree ("target_type","target_id");