// Deterministic unit vector for seed data, so seeded chunks satisfy the NOT NULL vector column
// without calling an embedding model. Not semantically meaningful.
export function fakeEmbedding(seed: number, dimensions: number): number[] {
  const values = Array.from({ length: dimensions }, (_, i) => Math.sin(seed * 31 + i));
  const norm = Math.hypot(...values);
  return values.map((v) => v / norm);
}
