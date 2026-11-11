CREATE TYPE "public"."point_source" AS ENUM('scraped', 'scan', 'source', 'address', 'places', 'city');--> statement-breakpoint
CREATE TABLE "known_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"street" text,
	"zip_code" text,
	"city" text NOT NULL,
	"address_key" text NOT NULL,
	"location" "geography" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "known_cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city_key" text NOT NULL,
	"location" "geography" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_lookup_misses" (
	"lookup_key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "point_source" "point_source" DEFAULT 'address' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "known_addresses_key_idx" ON "known_addresses" USING btree ("address_key");--> statement-breakpoint
CREATE INDEX "known_addresses_location_gist" ON "known_addresses" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "known_cities_key_idx" ON "known_cities" USING btree ("city_key");--> statement-breakpoint
CREATE INDEX "known_cities_location_gist" ON "known_cities" USING gist ("location");