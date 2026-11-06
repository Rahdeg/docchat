// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryDocument } from "../library-document";

// "Ask about this" opens a new chat scoped to the document, from the desktop sheet and from
// the phone row's "…" menu.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../actions", () => ({ deleteDocument: vi.fn(), retryDocument: vi.fn() }));

const { DocumentCard } = await import("./document-card");
const { DocumentRow } = await import("./document-row");

const doc: LibraryDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Tenancy agreement.pdf",
  mimeType: "application/pdf",
  sizeBytes: 120_000,
  status: "ready",
  error: null,
  pageCount: 4,
  pagesRead: 4,
  passageCount: 12,
  preview: "This agreement is made between",
  hasFile: true,
  stuck: false,
  createdAt: new Date("2026-10-01T10:00:00Z"),
};

const href = `/chat?documentId=${doc.id}`;

afterEach(cleanup);

describe("Ask about this", () => {
  it("links the desktop sheet to a chat scoped to the document", () => {
    render(<DocumentCard doc={doc} />);

    // A Button rendered as a link (role="button"), so found by its text.
    expect(screen.getByText("Ask about this").closest("a")?.getAttribute("href")).toBe(href);
  });

  it("links the phone row's menu item to a chat scoped to the document", async () => {
    render(
      <ul>
        <DocumentRow doc={doc} />
      </ul>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions for Tenancy agreement" }));

    const item = await screen.findByRole("menuitem", { name: "Ask about this" });
    expect(item.getAttribute("href")).toBe(href);
  });

  it("isn't offered while the document is still being read", () => {
    render(<DocumentCard doc={{ ...doc, status: "indexing", pagesRead: 1 }} />);

    expect(screen.queryByText("Ask about this")).toBeNull();
  });
});
