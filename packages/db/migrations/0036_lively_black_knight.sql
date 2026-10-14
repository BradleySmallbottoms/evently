CREATE TABLE "user_area_tags" (
	"area_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_area_tags_area_id_tag_id_pk" PRIMARY KEY("area_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "user_area_tags" ADD CONSTRAINT "user_area_tags_area_id_user_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."user_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_area_tags" ADD CONSTRAINT "user_area_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_area_tags_area_id_idx" ON "user_area_tags" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "user_area_tags_tag_id_idx" ON "user_area_tags" USING btree ("tag_id");--> statement-breakpoint
-- Existing areas start with the user's notification interests so switching place keeps a filter.
INSERT INTO "user_area_tags" ("area_id", "tag_id")
SELECT ua."id", ui."tag_id"
FROM "user_areas" ua
INNER JOIN "user_interests" ui ON ui."user_id" = ua."user_id";