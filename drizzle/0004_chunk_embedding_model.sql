-- Existing chunks keep NULL: their model is unknown (the seed used fake vectors), so
-- `pnpm db:backfill-embeddings` re-embeds them with the current model.
ALTER TABLE "chunk" ADD COLUMN "embedding_model" text;
