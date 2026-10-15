ALTER TABLE "events" ADD COLUMN "ref_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "worker_id" text;--> statement-breakpoint
CREATE INDEX "events_worker_ref_idx" ON "events" USING btree ("worker_id","ref_id");