import "server-only";

// Must match the output size of the embedding model (and any `dimensions` option passed to it).
// Changing it means a migration for chunk.embedding and its index, and re-embedding every chunk.
export const EMBEDDING_DIMENSIONS = 1536;
