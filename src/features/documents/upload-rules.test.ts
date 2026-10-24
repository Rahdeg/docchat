import { describe, expect, it } from "vitest";

import {
  ACCEPTED_FILE_TYPES,
  buildBlobPathname,
  checkFile,
  contentMatchesKind,
  displayName,
  fileKindOf,
  limitReachedMessage,
  MAX_DOCUMENTS,
  MAX_FILE_BYTES,
  parseBlobPathname,
  safeFileName,
} from "./upload-rules";

const bytes = (text: string) => new TextEncoder().encode(text);
const uuid = "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

describe("checkFile", () => {
  it.each([
    ["report.pdf", "pdf"],
    ["NOTES.MD", "md"],
    ["readme.markdown", "md"],
    ["minutes.txt", "txt"],
  ] as const)("accepts %s as %s", (name, kind) => {
    expect(checkFile({ name, size: 1000 }, 0)).toEqual({ ok: true, kind });
  });

  it.each(["photo.png", "contract.docx", "archive.pdf.zip", "no-extension"])(
    "rejects %s by type",
    (name) => {
      expect(checkFile({ name, size: 1000 }, 0)).toEqual({
        ok: false,
        error: `${name} isn't a PDF, Markdown or text file.`,
      });
    },
  );

  it("rejects files over 10 MB and accepts exactly 10 MB", () => {
    expect(checkFile({ name: "big.pdf", size: MAX_FILE_BYTES + 1 }, 0)).toEqual({
      ok: false,
      error: "big.pdf is larger than 10 MB.",
    });
    expect(checkFile({ name: "edge.pdf", size: MAX_FILE_BYTES }, 0).ok).toBe(true);
  });

  it("rejects empty files", () => {
    expect(checkFile({ name: "empty.txt", size: 0 }, 0)).toEqual({
      ok: false,
      error: "empty.txt is empty.",
    });
  });

  it("enforces the per-user document limit", () => {
    expect(checkFile({ name: "a.pdf", size: 10 }, MAX_DOCUMENTS - 1).ok).toBe(true);
    expect(checkFile({ name: "a.pdf", size: 10 }, MAX_DOCUMENTS)).toEqual({
      ok: false,
      error: limitReachedMessage,
    });
  });

  it("lists every accepted extension and type for the file picker", () => {
    expect(ACCEPTED_FILE_TYPES.split(",")).toEqual(
      expect.arrayContaining([".pdf", ".md", ".markdown", ".txt", "application/pdf", "text/plain"]),
    );
  });
});

describe("contentMatchesKind", () => {
  it("accepts a PDF by its %PDF- marker, even after leading junk", () => {
    expect(contentMatchesKind("pdf", bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toBe(true);
    expect(contentMatchesKind("pdf", bytes(`${" ".repeat(200)}%PDF-1.4`))).toBe(true);
  });

  it("rejects a file renamed to .pdf", () => {
    expect(contentMatchesKind("pdf", bytes("Just some text pretending to be a PDF."))).toBe(false);
    expect(contentMatchesKind("pdf", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it("accepts UTF-8 Markdown and text", () => {
    expect(contentMatchesKind("md", bytes("# Notes\n\nCafé, naïve, 日本語."))).toBe(true);
    expect(contentMatchesKind("txt", bytes("plain"))).toBe(true);
  });

  it("tolerates a multi-byte character cut off at the end of the sniffed bytes", () => {
    const full = bytes("abc日");
    expect(contentMatchesKind("txt", full.subarray(0, full.length - 1))).toBe(true);
  });

  it("rejects binary renamed to .md or .txt", () => {
    expect(contentMatchesKind("md", new Uint8Array([0x23, 0x00, 0x41]))).toBe(false);
    expect(contentMatchesKind("txt", new Uint8Array([0xff, 0xfe, 0xfd, 0x41]))).toBe(false);
  });
});

describe("blob pathnames", () => {
  it("builds paths in the user's folder and parses them back", () => {
    const pathname = buildBlobPathname("user_abc123", "Tenancy agreement.pdf", uuid);

    expect(pathname).toBe(`users/user_abc123/${uuid}-Tenancy agreement.pdf`);
    expect(parseBlobPathname(pathname)).toEqual({
      userId: "user_abc123",
      id: uuid,
      fileName: "Tenancy agreement.pdf",
    });
  });

  it("rejects paths outside the expected shape", () => {
    expect(parseBlobPathname(`users/user_abc/../user_xyz/${uuid}-a.pdf`)).toBeNull();
    expect(parseBlobPathname(`other/user_abc/${uuid}-a.pdf`)).toBeNull();
    expect(parseBlobPathname("users/user_abc/not-a-uuid-a.pdf")).toBeNull();
    expect(parseBlobPathname(`users/user_abc/${uuid}-nested/a.pdf`)).toBeNull();
  });

  it("makes file names safe for a path and keeps the extension", () => {
    expect(safeFileName("Q3 report (final).PDF")).toBe("Q3 report -final-.pdf");
    expect(safeFileName("../../etc/passwd.txt")).toBe("..-..-etc-passwd.txt");
    expect(safeFileName("???.md")).toBe("-.md");
    expect(safeFileName(".md")).toBe("document.md");
    expect(fileKindOf(safeFileName("Résumé.pdf"))).toBe("pdf");
  });
});

describe("displayName", () => {
  it("drops a known extension", () => {
    expect(displayName("Tenancy agreement.pdf")).toBe("Tenancy agreement");
    expect(displayName("notes.v2.md")).toBe("notes.v2");
    expect(displayName("archive.zip")).toBe("archive.zip");
  });
});
