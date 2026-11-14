CREATE TYPE "public"."usage_counter_kind" AS ENUM('question', 'agent-run', 'mcp-search');--> statement-breakpoint
ALTER TYPE "public"."rate_limit_bucket" ADD VALUE 'question';--> statement-breakpoint
ALTER TYPE "public"."rate_limit_bucket" ADD VALUE 'reindex';--> statement-breakpoint
CREATE TABLE "usage_counter" (
	"user_id" text NOT NULL,
	"kind" "usage_counter_kind" NOT NULL,
	"day" date NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "usage_counter_user_id_kind_day_pk" PRIMARY KEY("user_id","kind","day")
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "usage_counter_user_id_idx" ON "usage_counter" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_user_id_content_hash_idx" ON "document" USING btree ("user_id","content_hash");