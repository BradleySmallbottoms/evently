CREATE TYPE "public"."user_area_kind" AS ENUM('manual', 'region');--> statement-breakpoint
CREATE TYPE "public"."user_area_origin" AS ENUM('manual', 'suggested');--> statement-breakpoint
CREATE TABLE "user_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "user_area_kind" DEFAULT 'manual' NOT NULL,
	"origin" "user_area_origin" DEFAULT 'manual' NOT NULL,
	"region_id" uuid,
	"area" "geography",
	"center" "geography",
	"radius_m" integer,
	"notify" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_interests_user_id_category_id_pk" PRIMARY KEY("user_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_areas_user_id_idx" ON "user_areas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_areas_center_gist" ON "user_areas" USING gist ("center");--> statement-breakpoint
CREATE INDEX "user_areas_area_gist" ON "user_areas" USING gist ("area");--> statement-breakpoint
CREATE INDEX "user_interests_user_id_idx" ON "user_interests" USING btree ("user_id");