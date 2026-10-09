CREATE TABLE "publisher_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publisher_invites" ADD CONSTRAINT "publisher_invites_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_invites" ADD CONSTRAINT "publisher_invites_invited_by_account_id_publisher_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."publisher_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publisher_invites_token_hash_idx" ON "publisher_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "publisher_invites_publisher_id_idx" ON "publisher_invites" USING btree ("publisher_id");