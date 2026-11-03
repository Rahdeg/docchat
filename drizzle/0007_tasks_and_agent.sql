CREATE TYPE "public"."task_created_by" AS ENUM('user', 'agent');--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "due_note" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "created_by" "task_created_by" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "chat_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "source_quote" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "source_start_offset" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "source_end_offset" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_document_id_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_user_id_done_due_date_idx" ON "task" USING btree ("user_id","done","due_date");--> statement-breakpoint
CREATE INDEX "task_source_document_id_idx" ON "task" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "task_chat_id_idx" ON "task" USING btree ("chat_id");