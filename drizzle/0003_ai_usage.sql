CREATE TYPE "public"."ai_usage_kind" AS ENUM('embed-index', 'embed-query');--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "ai_usage_kind" NOT NULL,
	"model" text NOT NULL,
	"tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_usage_user_id_idx" ON "ai_usage" USING btree ("user_id");