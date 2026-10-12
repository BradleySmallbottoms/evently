ALTER TABLE "event_stats" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "publisher_stats" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_stats" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "event_stats" CASCADE;--> statement-breakpoint
DROP TABLE "publisher_stats" CASCADE;--> statement-breakpoint
DROP TABLE "user_stats" CASCADE;--> statement-breakpoint
CREATE TYPE "public"."stats_source_type" AS ENUM('user', 'event', 'publisher');--> statement-breakpoint
CREATE TABLE "stats" (
	"source_type" "stats_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stats_source_type_source_id_key_pk" PRIMARY KEY("source_type","source_id","key")
);
--> statement-breakpoint
CREATE INDEX "stats_source_idx" ON "stats" USING btree ("source_type","source_id");
