ALTER TABLE "events" ADD CONSTRAINT "events_publisher_id_required" CHECK (publisher_id IS NOT NULL OR status = 'pending_scan');--> statement-breakpoint
CREATE INDEX "events_pending_scan_created_at_idx" ON "events" ("created_at") WHERE status = 'pending_scan';
