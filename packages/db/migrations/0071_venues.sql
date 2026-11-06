CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"name_key" text NOT NULL,
	"city_key" text NOT NULL,
	"location" "geography" NOT NULL,
	"address" text,
	"zip_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_occasions" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "venues_name_city_idx" ON "venues" USING btree ("name_key","city_key");--> statement-breakpoint
CREATE INDEX "venues_location_gist" ON "venues" USING gist ("location");--> statement-breakpoint
ALTER TABLE "event_occasions" ADD CONSTRAINT "event_occasions_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_occasions_venue_idx" ON "event_occasions" USING btree ("venue_id");
--> statement-breakpoint
INSERT INTO "venues" ("name", "city", "name_key", "city_key", "location", "address", "zip_code")
SELECT DISTINCT ON (lower(btrim(o.venue_name)), lower(btrim(e.meta->'address'->>'city')))
  btrim(o.venue_name),
  btrim(e.meta->'address'->>'city'),
  lower(btrim(o.venue_name)),
  lower(btrim(e.meta->'address'->>'city')),
  o.location,
  NULLIF(btrim(e.meta->'address'->>'address'), ''),
  NULLIF(btrim(e.meta->'address'->>'zipCode'), '')
FROM "event_occasions" o
JOIN "events" e ON e.id = o.event_id
WHERE o.location IS NOT NULL
  AND NULLIF(btrim(o.venue_name), '') IS NOT NULL
  AND NULLIF(btrim(e.meta->'address'->>'city'), '') IS NOT NULL
  AND lower(btrim(o.venue_name)) <> lower(btrim(e.meta->'address'->>'city'))
ORDER BY lower(btrim(o.venue_name)), lower(btrim(e.meta->'address'->>'city')), o.updated_at DESC;
--> statement-breakpoint
UPDATE "event_occasions" o
SET "venue_id" = v.id,
    "location" = COALESCE(o.location, v.location),
    "updated_at" = now()
FROM "events" e, "venues" v
WHERE e.id = o.event_id
  AND o.venue_id IS NULL
  AND NULLIF(btrim(o.venue_name), '') IS NOT NULL
  AND lower(btrim(o.venue_name)) = v.name_key
  AND lower(btrim(e.meta->'address'->>'city')) = v.city_key;
