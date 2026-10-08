-- Extensions must exist before any table uses them. RDS for PostgreSQL supports all three.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
