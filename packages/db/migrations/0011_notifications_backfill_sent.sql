-- Rows created before push_state existed were already delivered; mark them sent.
UPDATE "notifications"
SET "push_state" = 'sent', "pushed_at" = "sent_at"
WHERE "push_state" = 'pending' AND "pushed_at" IS NULL;
