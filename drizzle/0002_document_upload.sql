CREATE TABLE "document_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunk" ALTER COLUMN "embedding" DROP NOT NULL;--> statement-breakpoint
-- Hand-edited: existing (seeded) chunks have no offsets, so add the columns with a temporary
-- default and drop it straight after. Re-run `pnpm db:seed` to get real offsets.
ALTER TABLE "chunk" ADD COLUMN "start_offset" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chunk" ADD COLUMN "end_offset" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chunk" ALTER COLUMN "start_offset" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chunk" ALTER COLUMN "end_offset" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "blob_pathname" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "pages_read" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_page" ADD CONSTRAINT "document_page_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_page_user_id_idx" ON "document_page" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_page_document_id_page_number_idx" ON "document_page" USING btree ("document_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_blob_pathname_idx" ON "document" USING btree ("blob_pathname");