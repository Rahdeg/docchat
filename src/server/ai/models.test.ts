import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "./constants";
import { EMBEDDING_MODEL, EMBEDDING_MODEL_DIMENSIONS } from "./models";

describe("embedding model", () => {
  it("outputs vectors the size of the chunk.embedding column", () => {
    expect(EMBEDDING_MODEL).toBe("openai/text-embedding-3-small");
    expect(EMBEDDING_MODEL_DIMENSIONS[EMBEDDING_MODEL]).toBe(EMBEDDING_DIMENSIONS);
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });
});
