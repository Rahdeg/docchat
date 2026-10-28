import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "./constants";
import { EMBEDDING_CONFIGS, EMBEDDING_MODEL, EMBEDDING_PROVIDER } from "./models";

describe("embedding models", () => {
  it.each(Object.entries(EMBEDDING_CONFIGS))(
    "%s outputs vectors the size of the chunk.embedding column",
    (_provider, config) => {
      expect(config.dimensions).toBe(EMBEDDING_DIMENSIONS);
      expect(EMBEDDING_DIMENSIONS).toBe(1536);
    },
  );

  it("asks Gemini for 1536 dimensions, with retrieval task types", () => {
    const { google } = EMBEDDING_CONFIGS;

    expect(google.id).toBe("google/gemini-embedding-001");
    expect(google.providerOptions("document")).toEqual({
      google: { outputDimensionality: 1536, taskType: "RETRIEVAL_DOCUMENT" },
    });
    expect(google.providerOptions("query")).toEqual({
      google: { outputDimensionality: 1536, taskType: "RETRIEVAL_QUERY" },
    });
  });

  it("uses text-embedding-3-small through the gateway", () => {
    expect(EMBEDDING_CONFIGS.gateway.id).toBe("openai/text-embedding-3-small");
  });

  it("names every model differently, so stored vectors can be told apart", () => {
    const ids = Object.values(EMBEDDING_CONFIGS).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the configured provider's model", () => {
    expect(EMBEDDING_MODEL).toBe(EMBEDDING_CONFIGS[EMBEDDING_PROVIDER].id);
  });
});
