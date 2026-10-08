CREATE TYPE "public"."event_mode" AS ENUM('physical', 'digital');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'awaiting_verification', 'in_review', 'published', 'cancelled', 'ended');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('native', 'imported');--> statement-breakpoint
CREATE TYPE "public"."publisher_type" AS ENUM('org', 'person');--> statement-breakpoint
CREATE TYPE "public"."session_subject" AS ENUM('user', 'publisher_account', 'admin');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('api', 'feed', 'scraper');--> statement-breakpoint
CREATE TYPE "public"."source_trust" AS ENUM('auto_publish', 'review');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"name_sv" text NOT NULL,
	"name_en" text NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"schedule" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trust" "source_trust" DEFAULT 'review' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"expo_push_token" text,
	"platform" text NOT NULL,
	"locale" text DEFAULT 'sv' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"event_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "event_categories_event_id_category_id_pk" PRIMARY KEY("event_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"mode" "event_mode" NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"origin" "origin" DEFAULT 'native' NOT NULL,
	"source_url" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/Stockholm' NOT NULL,
	"venue_name" text,
	"location" "geography",
	"geofence" "geography",
	"geofence_radius_m" integer DEFAULT 100,
	"online_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_refs_source_id_external_id_pk" PRIMARY KEY("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "publisher_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publisher_aliases" (
	"source_id" uuid NOT NULL,
	"external_organizer_key" text NOT NULL,
	"publisher_id" uuid NOT NULL,
	"mapped_by" uuid,
	"mapped_at" timestamp with time zone,
	CONSTRAINT "publisher_aliases_source_id_external_organizer_key_pk" PRIMARY KEY("source_id","external_organizer_key")
);
--> statement-breakpoint
CREATE TABLE "publisher_members" (
	"publisher_id" uuid NOT NULL,
	"publisher_account_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publisher_members_publisher_id_publisher_account_id_pk" PRIMARY KEY("publisher_id","publisher_account_id")
);
--> statement-breakpoint
CREATE TABLE "publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "publisher_type" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"origin" "origin" DEFAULT 'native' NOT NULL,
	"is_temporary" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "session_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"client" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"recovery_email" text,
	"recovery_email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "web_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" text DEFAULT 'web_login' NOT NULL,
	"browser_label" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_aliases" ADD CONSTRAINT "publisher_aliases_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_aliases" ADD CONSTRAINT "publisher_aliases_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_members" ADD CONSTRAINT "publisher_members_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_members" ADD CONSTRAINT "publisher_members_publisher_account_id_publisher_accounts_id_fk" FOREIGN KEY ("publisher_account_id") REFERENCES "public"."publisher_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_login_codes" ADD CONSTRAINT "web_login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_credential_hash_idx" ON "devices" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "events_location_gist" ON "events" USING gist ("location");--> statement-breakpoint
CREATE INDEX "events_status_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "publisher_accounts_email_idx" ON "publisher_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "publishers_slug_idx" ON "publishers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");