ALTER TABLE "event_interests" RENAME TO "coming_events";--> statement-breakpoint
ALTER TABLE "coming_events" RENAME CONSTRAINT "event_interests_user_id_event_id_pk" TO "coming_events_user_id_event_id_pk";--> statement-breakpoint
ALTER TABLE "coming_events" RENAME CONSTRAINT "event_interests_user_id_users_id_fk" TO "coming_events_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "coming_events" RENAME CONSTRAINT "event_interests_event_id_events_id_fk" TO "coming_events_event_id_events_id_fk";--> statement-breakpoint
ALTER INDEX "event_interests_user_id_idx" RENAME TO "coming_events_user_id_idx";--> statement-breakpoint
ALTER INDEX "event_interests_event_id_idx" RENAME TO "coming_events_event_id_idx";--> statement-breakpoint
UPDATE "stats" SET "key" = 'numComing' || substring("key" from 14) WHERE "key" LIKE 'numInterested%';
