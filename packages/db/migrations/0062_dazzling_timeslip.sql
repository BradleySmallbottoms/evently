ALTER TABLE "event_tags" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "event_tags" AS et
SET "position" = ranked.pos
FROM (
  SELECT "event_id", "tag_id",
         (row_number() OVER (PARTITION BY "event_id" ORDER BY "tag_id") - 1)::integer AS pos
  FROM "event_tags"
) AS ranked
WHERE et."event_id" = ranked."event_id"
  AND et."tag_id" = ranked."tag_id";--> statement-breakpoint
CREATE INDEX "event_tags_event_position_idx" ON "event_tags" USING btree ("event_id","position");