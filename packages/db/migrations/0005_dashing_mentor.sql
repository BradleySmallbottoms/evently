CREATE TYPE "public"."region_kind" AS ENUM('municipality', 'county');--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "region_kind" NOT NULL,
	"code" text NOT NULL,
	"boundary" "geography" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "regions_code_idx" ON "regions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "regions_boundary_gist" ON "regions" USING gist ("boundary");--> statement-breakpoint
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;