CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"external_id" text,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tags_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "event_tags" (
	"event_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "event_tags_event_id_tag_id_pk" PRIMARY KEY("event_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_tags_tag_id_idx" ON "event_tags" USING btree ("tag_id");--> statement-breakpoint
DELETE FROM "user_interests";--> statement-breakpoint
ALTER TABLE "user_interests" DROP CONSTRAINT "user_interests_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "user_interests" DROP CONSTRAINT "user_interests_user_id_category_id_pk";--> statement-breakpoint
ALTER TABLE "user_interests" DROP COLUMN "category_id";--> statement-breakpoint
ALTER TABLE "user_interests" ADD COLUMN "tag_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_tag_id_pk" PRIMARY KEY("user_id","tag_id");--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP TABLE "event_categories";--> statement-breakpoint
DROP TABLE "categories";--> statement-breakpoint
INSERT INTO "tags" ("id", "slug", "name", "external_id") VALUES
  ('a0000000-0000-4000-8000-000000030182', 'hogtider', 'Högtider', 'visit-soderhamn:30182'),
  ('a0000000-0000-4000-8000-000000030184', 'jul-nyar', 'Jul & Nyår', 'visit-soderhamn:30184'),
  ('a0000000-0000-4000-8000-000000030192', 'idrott-tavlingar', 'Idrott & Tävlingar', 'visit-soderhamn:30192'),
  ('a0000000-0000-4000-8000-000000030194', 'bandy-innebandy', 'Bandy & Innebandy', 'visit-soderhamn:30194'),
  ('a0000000-0000-4000-8000-000000030203', 'tavlingar', 'Tävlingar', 'visit-soderhamn:30203'),
  ('a0000000-0000-4000-8000-000000030216', 'massor-utstallningar', 'Mässor & Utställningar', 'visit-soderhamn:30216'),
  ('a0000000-0000-4000-8000-000000030224', 'utstallning', 'Utställning', 'visit-soderhamn:30224')
ON CONFLICT ("external_id") DO NOTHING;
