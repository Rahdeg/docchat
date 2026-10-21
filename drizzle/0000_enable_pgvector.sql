-- pgvector must exist before 0001 creates chunk.embedding (vector) and its HNSW index.
-- Drizzle can't express CREATE EXTENSION, so this is a custom migration.
CREATE EXTENSION IF NOT EXISTS vector;
