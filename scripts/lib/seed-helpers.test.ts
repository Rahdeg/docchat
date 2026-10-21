import { describe, expect, it } from "vitest";

import { assertDevelopment } from "./assert-development";
import { fakeEmbedding } from "./fake-embedding";

describe("assertDevelopment", () => {
  it("allows development", () => {
    expect(() => assertDevelopment("development")).not.toThrow();
  });

  it.each(["production", "test", undefined])("refuses %s", (nodeEnv) => {
    expect(() => assertDevelopment(nodeEnv)).toThrow(/Refusing to seed/);
  });
});

describe("fakeEmbedding", () => {
  it("returns a deterministic unit vector of the requested size", () => {
    const vector = fakeEmbedding(7, 1536);

    expect(vector).toHaveLength(1536);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 10);
    expect(fakeEmbedding(7, 1536)).toEqual(vector);
    expect(fakeEmbedding(8, 1536)).not.toEqual(vector);
  });
});
