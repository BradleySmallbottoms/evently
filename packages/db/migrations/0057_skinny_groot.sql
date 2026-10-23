CREATE TABLE "event_occasions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"venue_name" text,
	"location" "geography",
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "event_occasions" ("event_id", "starts_at", "ends_at", "venue_name", "location", "source_key")
SELECT
  e."id",
  e."starts_at",
  e."ends_at",
  e."venue_name",
  e."location",
  concat_ws(':', to_char(e."starts_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(e."ends_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
FROM "events" e
WHERE e."starts_at" IS NOT NULL
  AND e."ends_at" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "event_occasions" eo
USING "events" e
WHERE eo."event_id" = e."id"
  AND coalesce((e."meta"->>'collapsed')::boolean, false) = true;
--> statement-breakpoint
INSERT INTO "event_occasions" ("event_id", "starts_at", "ends_at", "venue_name", "location", "source_key")
SELECT
  e."id",
  (o->>'startsAt')::timestamptz,
  coalesce((o->>'endsAt')::timestamptz, (o->>'startsAt')::timestamptz),
  nullif(o->>'venueName', ''),
  CASE
    WHEN (o->'location'->>'lat') IS NOT NULL AND (o->'location'->>'lng') IS NOT NULL
      THEN ST_SetSRID(
        ST_MakePoint(
          (o->'location'->>'lng')::double precision,
          (o->'location'->>'lat')::double precision
        ),
        4326
      )::geography
    ELSE NULL
  END,
  concat_ws(':', o->>'startsAt', o->>'endsAt')
FROM "events" e
CROSS JOIN LATERAL jsonb_array_elements(coalesce(e."meta"->'occasions', '[]'::jsonb)) o
WHERE coalesce((e."meta"->>'collapsed')::boolean, false) = true
  AND o ? 'startsAt';
--> statement-breakpoint
CREATE TEMP TABLE "_occasion_group_merge" (
  "group_id" text NOT NULL,
  "host_event_id" uuid NOT NULL,
  "child_event_id" uuid NOT NULL
);
--> statement-breakpoint
INSERT INTO "_occasion_group_merge" ("group_id", "host_event_id", "child_event_id")
WITH grouped AS (
  SELECT
    e."id",
    e."created_at",
    e."status",
    e."meta"->>'occasionGroupId' AS "group_id",
    row_number() OVER (
      PARTITION BY e."meta"->>'occasionGroupId'
      ORDER BY (e."status" = 'published') DESC, e."created_at" ASC, e."id" ASC
    ) AS "rank_in_group"
  FROM "events" e
  WHERE coalesce(e."meta"->>'occasionGroupId', '') <> ''
)
SELECT
  child."group_id",
  host."id" AS "host_event_id",
  child."id" AS "child_event_id"
FROM grouped child
JOIN grouped host
  ON host."group_id" = child."group_id"
 AND host."rank_in_group" = 1
WHERE child."rank_in_group" > 1;
--> statement-breakpoint
DELETE FROM "event_occasions" child
USING "event_occasions" host_occ, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_occ."event_id" = map."host_event_id"
  AND child."source_key" IS NOT NULL
  AND child."source_key" = host_occ."source_key";
--> statement-breakpoint
UPDATE "event_occasions" eo
SET "event_id" = map."host_event_id",
    "updated_at" = now()
FROM "_occasion_group_merge" map
WHERE eo."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "saved_events" child
USING "saved_events" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."user_id" = host_row."user_id";
--> statement-breakpoint
UPDATE "saved_events" s
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE s."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "coming_events" child
USING "coming_events" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."user_id" = host_row."user_id";
--> statement-breakpoint
UPDATE "coming_events" c
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE c."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "event_list_items" child
USING "event_list_items" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."list_id" = host_row."list_id";
--> statement-breakpoint
UPDATE "event_list_items" li
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE li."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "check_ins" child
USING "check_ins" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."user_id" = host_row."user_id";
--> statement-breakpoint
UPDATE "check_ins" ci
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE ci."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "ratings" child
USING "ratings" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."user_id" = host_row."user_id";
--> statement-breakpoint
UPDATE "ratings" r
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE r."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "event_reports" child
USING "event_reports" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."user_id" = host_row."user_id";
--> statement-breakpoint
UPDATE "event_reports" er
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE er."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "event_tags" child
USING "event_tags" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."tag_id" = host_row."tag_id";
--> statement-breakpoint
UPDATE "event_tags" et
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE et."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "event_translations" child
USING "event_translations" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."language" = host_row."language";
--> statement-breakpoint
UPDATE "event_translations" tr
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE tr."event_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "subscriptions" child
USING "subscriptions" host_row, "_occasion_group_merge" map
WHERE child."target_type" = 'event'
  AND host_row."target_type" = 'event'
  AND child."target_id" = map."child_event_id"
  AND host_row."target_id" = map."host_event_id"
  AND child."user_id" = host_row."user_id";
--> statement-breakpoint
UPDATE "subscriptions" s
SET "target_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE s."target_type" = 'event'
  AND s."target_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "event_images" child
USING "event_images" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."role" = host_row."role";
--> statement-breakpoint
UPDATE "event_images" ei
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE ei."event_id" = map."child_event_id";
--> statement-breakpoint
UPDATE "event_links" el
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE el."event_id" = map."child_event_id";
--> statement-breakpoint
UPDATE "event_content" ec
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE ec."event_id" = map."child_event_id";
--> statement-breakpoint
UPDATE "push_messages" pm
SET "event_id" = map."host_event_id",
    "updated_at" = now()
FROM "_occasion_group_merge" map
WHERE pm."event_id" = map."child_event_id";
--> statement-breakpoint
UPDATE "notifications" n
SET "event_id" = map."host_event_id"
FROM "_occasion_group_merge" map
WHERE n."event_id" = map."child_event_id";
--> statement-breakpoint
UPDATE "event_tips" t
SET "event_id" = map."host_event_id",
    "updated_at" = now()
FROM "_occasion_group_merge" map
WHERE t."event_id" = map."child_event_id";
--> statement-breakpoint
INSERT INTO "stats" ("source_type", "source_id", "key", "value", "created_at", "updated_at")
SELECT
  s."source_type",
  map."host_event_id",
  s."key",
  s."value",
  s."created_at",
  s."updated_at"
FROM "stats" s
JOIN "_occasion_group_merge" map
  ON s."source_type" = 'event'
 AND s."source_id" = map."child_event_id"
ON CONFLICT ("source_type", "source_id", "key")
DO UPDATE SET
  "value" = "stats"."value" + EXCLUDED."value",
  "updated_at" = GREATEST("stats"."updated_at", EXCLUDED."updated_at");
--> statement-breakpoint
DELETE FROM "stats" s
USING "_occasion_group_merge" map
WHERE s."source_type" = 'event'
  AND s."source_id" = map."child_event_id";
--> statement-breakpoint
DELETE FROM "external_refs" child
USING "external_refs" host_row, "_occasion_group_merge" map
WHERE child."event_id" = map."child_event_id"
  AND host_row."event_id" = map."host_event_id"
  AND child."source_id" = host_row."source_id"
  AND child."external_id" = host_row."external_id";
--> statement-breakpoint
INSERT INTO "external_refs" ("source_id", "external_id", "event_id", "content_hash", "last_seen_at")
SELECT
  er."source_id",
  map."group_id",
  map."host_event_id",
  er."content_hash",
  er."last_seen_at"
FROM "external_refs" er
JOIN "_occasion_group_merge" map
  ON er."event_id" = map."child_event_id"
ON CONFLICT ("source_id", "external_id")
DO UPDATE SET
  "event_id" = EXCLUDED."event_id",
  "content_hash" = EXCLUDED."content_hash",
  "last_seen_at" = GREATEST("external_refs"."last_seen_at", EXCLUDED."last_seen_at");
--> statement-breakpoint
UPDATE "external_refs" er
SET "event_id" = map."host_event_id",
    "last_seen_at" = now()
FROM "_occasion_group_merge" map
WHERE er."event_id" = map."child_event_id";
--> statement-breakpoint
UPDATE "events" e
SET "meta" = e."meta" - 'occasionGroupId' - 'collapsed' - 'occasions',
    "updated_at" = now()
FROM (
  SELECT DISTINCT "host_event_id" FROM "_occasion_group_merge"
) hosts
WHERE e."id" = hosts."host_event_id";
--> statement-breakpoint
DELETE FROM "events" e
USING "_occasion_group_merge" map
WHERE e."id" = map."child_event_id";
--> statement-breakpoint
DROP INDEX "events_location_gist";--> statement-breakpoint
DROP INDEX "events_status_starts_idx";--> statement-breakpoint
DROP INDEX "events_occasion_group_idx";--> statement-breakpoint
ALTER TABLE "event_occasions" ADD CONSTRAINT "event_occasions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_occasions_event_starts_idx" ON "event_occasions" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_occasions_location_gist" ON "event_occasions" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "event_occasions_event_source_key_idx" ON "event_occasions" USING btree ("event_id","source_key") WHERE "event_occasions"."source_key" is not null;--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "starts_at";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "ends_at";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "venue_name";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "location";