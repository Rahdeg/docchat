import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), del: vi.fn(), get: vi.fn() }));

vi.mock("@vercel/blob", () => mocks);
vi.mock("@/lib/env", () => ({ env: { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test" } }));

const { deleteBlobsWithPrefix } = await import("./blob");

const blob = (pathname: string) => ({ pathname, url: `https://x.private.blob/${pathname}` });

beforeEach(() => vi.clearAllMocks());

describe("deleteBlobsWithPrefix", () => {
  it("deletes every page of files under the folder", async () => {
    mocks.list
      .mockResolvedValueOnce({
        blobs: [blob("users/u/a.pdf"), blob("users/u/b.md")],
        hasMore: true,
        cursor: "c1",
      })
      .mockResolvedValueOnce({ blobs: [blob("users/u/c.txt")], hasMore: false });

    expect(await deleteBlobsWithPrefix("users/u/")).toBe(3);
    expect(mocks.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ prefix: "users/u/", cursor: "c1" }),
    );
    expect(mocks.del).toHaveBeenCalledWith(["users/u/a.pdf", "users/u/b.md"], {
      token: "vercel_blob_rw_test",
    });
    expect(mocks.del).toHaveBeenCalledWith(["users/u/c.txt"], { token: "vercel_blob_rw_test" });
  });

  it("does nothing when the folder is empty", async () => {
    mocks.list.mockResolvedValue({ blobs: [], hasMore: false });

    expect(await deleteBlobsWithPrefix("users/u/")).toBe(0);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("refuses a prefix that isn't a folder", async () => {
    await expect(deleteBlobsWithPrefix("users/u")).rejects.toThrow();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
