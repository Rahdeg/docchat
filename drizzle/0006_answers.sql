CREATE TYPE "public"."message_feedback" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('complete', 'stopped', 'failed');--> statement-breakpoint
ALTER TYPE "public"."ai_usage_kind" ADD VALUE 'chat';--> statement-breakpoint
ALTER TYPE "public"."ai_usage_kind" ADD VALUE 'rewrite';--> statement-breakpoint
ALTER TYPE "public"."ai_usage_kind" ADD VALUE 'judge';--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "status" "message_status" DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "feedback" "message_feedback";--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_usage_user_id_kind_created_at_idx" ON "ai_usage" USING btree ("user_id","kind","created_at");