ALTER TABLE "events" DROP CONSTRAINT "events_publisher_id_required";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_publisher_id_required" CHECK (publisher_id IS NOT NULL OR status IN ('pending_scan', 'deleted'));
