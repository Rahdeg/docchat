-- Fails while any chunk has no embedding or no model. Run `pnpm db:backfill-embeddings` on
-- the branch first (--dry-run shows what is left), then migrate.
ALTER TABLE "chunk" ALTER COLUMN "embedding" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chunk" ALTER COLUMN "embedding_model" SET NOT NULL;