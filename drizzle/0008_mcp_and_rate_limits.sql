CREATE TYPE "public"."rate_limit_bucket" AS ENUM('mcp', 'search', 'upload');--> statement-breakpoint
ALTER TYPE "public"."ai_usage_kind" ADD VALUE 'mcp-search';--> statement-breakpoint
ALTER TYPE "public"."task_created_by" ADD VALUE 'mcp';--> statement-breakpoint
CREATE TABLE "rate_limit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"bucket" "rate_limit_bucket" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_event_user_id_idx" ON "rate_limit_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_limit_event_user_id_bucket_created_at_idx" ON "rate_limit_event" USING btree ("user_id","bucket","created_at");