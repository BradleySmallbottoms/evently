CREATE TABLE "import_suppressions" (
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_suppressions_source_id_external_id_pk" PRIMARY KEY("source_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "import_suppressions" ADD CONSTRAINT "import_suppressions_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;