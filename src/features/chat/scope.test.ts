import { describe, expect, it } from "vitest";

import { askAboutUrl } from "@/lib/routes";

import { DOCUMENT_NOT_FOUND, DOCUMENT_NOT_READY, readyScope, startingScope } from "./scope";

const lease = { id: "11111111-1111-4111-8111-111111111111", name: "Tenancy agreement.pdf" };
const contract = { id: "22222222-2222-4222-8222-222222222222", name: "Work contract.pdf" };
const ready = [lease, contract];
// Another user's document, or one that doesn't exist: not in this user's ready list.
const othersId = "33333333-3333-4333-8333-333333333333";

describe("askAboutUrl", () => {
  it("opens a new chat with the document's id", () => {
    expect(askAboutUrl(lease.id)).toBe(`/chat?documentId=${lease.id}`);
  });
});

describe("readyScope", () => {
  it("keeps only the user's ready documents, once each", () => {
    expect(readyScope(ready, [contract.id, othersId, contract.id])).toEqual([contract.id]);
  });

  it("is empty (all documents) when none of them are", () => {
    expect(readyScope(ready, [othersId])).toEqual([]);
  });
});

describe("startingScope", () => {
  const none = { saved: null, linkedId: null, linkedExists: false };

  it("starts a linked new chat on that document", () => {
    expect(startingScope({ ...none, ready, linkedId: lease.id, linkedExists: true })).toEqual({
      documentIds: [lease.id],
      notice: null,
    });
  });

  it("falls back to all documents when the linked one isn't ready yet", () => {
    expect(
      startingScope({ ...none, ready: [contract], linkedId: lease.id, linkedExists: true }),
    ).toEqual({ documentIds: [], notice: DOCUMENT_NOT_READY });
  });

  it("falls back to all documents for another user's document, or a made-up id", () => {
    for (const linkedId of [othersId, "not-a-uuid"]) {
      expect(startingScope({ ...none, ready, linkedId })).toEqual({
        documentIds: [],
        notice: DOCUMENT_NOT_FOUND,
      });
    }
  });

  it("reopens a saved chat with its own scope, ignoring a link", () => {
    expect(
      startingScope({ ready, saved: [contract.id], linkedId: lease.id, linkedExists: true }),
    ).toEqual({ documentIds: [contract.id], notice: null });
  });

  it("drops saved documents that are no longer ready", () => {
    expect(startingScope({ ...none, ready: [lease], saved: [lease.id, contract.id] })).toEqual({
      documentIds: [lease.id],
      notice: null,
    });
  });

  it("starts with all documents otherwise", () => {
    expect(startingScope({ ...none, ready })).toEqual({ documentIds: [], notice: null });
    expect(startingScope({ ...none, ready, saved: [] })).toEqual({ documentIds: [], notice: null });
  });
});
