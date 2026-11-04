ALTER TABLE "publisher_accounts" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "publisher_accounts" ADD COLUMN "totp_pending_secret" text;