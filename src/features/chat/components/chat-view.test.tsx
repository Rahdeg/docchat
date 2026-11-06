// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Proposal } from "../agent-parts";
import type { ChatUIMessage } from "../message";
import { asksForTasks, TURN_INTO_TASKS } from "../task-request";

// The browser's side of the agent: "Turn this into tasks" sends an explicit task request, and
// the approval card sends nothing until "Add" or "Cancel" is clicked.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../actions", () => ({ rateAnswer: vi.fn() }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ChatView } = await import("./chat-view");

const chatId = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const questionId = "0b6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const answerId = "0c6f3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5c";
const documents = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Tenancy agreement.pdf",
    mimeType: "application/pdf",
  },
];
const passage = {
  chunkId: "00000000-0000-4000-8000-000000000001",
  documentId: documents[0]!.id,
  name: "Tenancy agreement.pdf",
  mimeType: "application/pdf",
  hasFile: true,
  page: 2,
  content: "13.2 The Tenant has seven days from the start date to return the Inventory signed.",
  startOffset: 0,
  endOffset: 84,
  similarity: 0.8,
};

const question: ChatUIMessage = {
  id: questionId,
  role: "user",
  parts: [{ type: "text", text: "When do I return the inventory?" }],
};

let requests: Record<string, unknown>[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const sse = [{ type: "start" }, { type: "finish" }]
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("");
      return new Response(`${sse}data: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderChat(messages: ChatUIMessage[]) {
  return render(
    <ChatView chatId={chatId} title="Inventory" initialMessages={messages} documents={documents} />,
  );
}

describe("Turn this into tasks", () => {
  const answer: ChatUIMessage = {
    id: answerId,
    role: "assistant",
    metadata: { status: "complete" },
    parts: [
      { type: "data-passages", id: "passages", data: { query: "inventory", passages: [passage] } },
      { type: "text", text: "You **must** return it within seven days of the start date [1]." },
      {
        type: "data-citations",
        id: "citations",
        data: {
          final: true,
          citations: [{ number: 1, source: 1, quote: null, start: 0, end: 84, matched: false }],
        },
      },
    ],
  };

  it("sends the explicit task request, the only words that turn the tools on", async () => {
    renderChat([question, answer]);

    fireEvent.click(screen.getByRole("button", { name: "Turn this into tasks" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const sent = requests[0] as { message: { parts: { text: string }[] } };
    expect(sent.message.parts[0]!.text).toBe(TURN_INTO_TASKS);
    expect(asksForTasks(sent.message.parts[0]!.text)).toBe(true);
  });

  it("isn't offered under an answer without duties or dates", () => {
    renderChat([
      question,
      { ...answer, parts: [{ type: "text", text: "The deposit is 1,326 pounds." }] },
    ]);
    expect(screen.queryByRole("button", { name: "Turn this into tasks" })).toBeNull();
  });
});

describe("the approval card", () => {
  const proposal: Proposal = {
    toolCallId: "call_1",
    rejected: 0,
    tasks: [
      {
        title: "Return the signed inventory",
        dueDate: "2026-03-08",
        dueNote: "within seven days of the start date",
        dateDropped: false,
        optional: false,
        source: 1,
        citation: 1,
        quote: "The Tenant has seven days",
        start: 5,
        end: 30,
        matched: true,
        label: "clause 13.2",
      },
      {
        title: "Take meter readings",
        dueDate: null,
        dueNote: null,
        dateDropped: false,
        optional: false,
        source: 1,
        citation: 2,
        quote: "meter",
        start: 0,
        end: 84,
        matched: false,
        label: null,
      },
      {
        title: "Set up contents insurance",
        dueDate: null,
        dueNote: null,
        dateDropped: false,
        optional: true,
        source: 1,
        citation: 3,
        quote: "insurance",
        start: 0,
        end: 84,
        matched: false,
        label: "clause 10.1",
      },
    ],
  };
  const waiting: ChatUIMessage = {
    id: answerId,
    role: "assistant",
    metadata: { status: "complete" },
    parts: [
      { type: "data-passages", id: "passages", data: { query: "checklist", passages: [passage] } },
      { type: "step-start" },
      {
        type: "tool-proposeTasks",
        toolCallId: "call_1",
        state: "approval-requested",
        input: {
          tasks: proposal.tasks.map((t) => ({
            title: t.title,
            source: { number: 1, quote: t.quote },
          })),
        },
        approval: { id: "approval_1" },
      },
      { type: "data-proposal", id: "proposal", data: proposal },
    ],
  };

  it("sends nothing until a button is clicked, and starts optional tasks unticked", () => {
    renderChat([question, waiting]);

    expect(screen.getByText("Waiting for you to check them")).toBeDefined();
    expect(screen.getByRole("button", { name: "Add 2 tasks" })).toBeDefined();
    expect(
      screen
        .getByRole("checkbox", { name: "Include: Set up contents insurance" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(requests).toEqual([]);
  });

  it("sends only the ticked tasks, with an edited title, when Add is clicked", async () => {
    renderChat([question, waiting]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include: Take meter readings" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit the title: Return the signed inventory" }),
    );
    const input = screen.getByRole("textbox", { name: "Task title" });
    fireEvent.change(input, { target: { value: "Sign and return the inventory" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add 1 task" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      chatId,
      trigger: "submit-message",
      approval: {
        messageId: answerId,
        approvalId: "approval_1",
        approved: true,
        tasks: [{ index: 0, title: "Sign and return the inventory", dueDate: "2026-03-08" }],
      },
    });
    // Sent once, even though this reply didn't settle the proposal.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toHaveLength(1);
  });

  it("sends a cancel with no tasks", async () => {
    renderChat([question, waiting]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ approval: { approved: false } });
    expect((requests[0] as { approval: { tasks?: unknown } }).approval.tasks).toBeUndefined();
  });
});

describe("a chat opened from Ask about this", () => {
  const lease = documents[0]!;
  const contract = { id: "22222222-2222-4222-8222-222222222222", name: "Work contract.pdf" };

  beforeEach(() => {
    toast.mockClear();
    window.history.replaceState(null, "", `/chat/${chatId}?documentId=${lease.id}`);
  });

  function renderLinked(props: { initialDocumentIds: string[]; notice?: string | null }) {
    return render(
      <ChatView
        chatId={chatId}
        title={null}
        initialMessages={[]}
        documents={[lease, contract]}
        fromLink
        {...props}
      />,
    );
  }

  it("starts with the document chosen, its name in the composer, focused", () => {
    renderLinked({ initialDocumentIds: [lease.id] });

    const composer = screen.getByRole("textbox", { name: "Ask about Tenancy agreement" });
    expect(composer.getAttribute("placeholder")).toBe("Ask about Tenancy agreement");
    expect(document.activeElement).toBe(composer);
    expect(screen.getByRole("button", { name: /Tenancy agreement/ })).toBeTruthy();
    expect(screen.getByText("Searching Tenancy agreement")).toBeTruthy();
  });

  it("drops the query from the URL, so a refresh doesn't reapply it", () => {
    renderLinked({ initialDocumentIds: [lease.id] });

    expect(window.location.pathname).toBe(`/chat/${chatId}`);
    expect(window.location.search).toBe("");
  });

  it("sends the chosen document with the first question", async () => {
    renderLinked({ initialDocumentIds: [lease.id] });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "When is rent due?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ chatId, documentIds: [lease.id] });
  });

  it("shows why the document wasn't chosen, and searches everything", () => {
    renderLinked({ initialDocumentIds: [], notice: "That document isn't ready yet" });

    expect(toast).toHaveBeenCalledWith("That document isn't ready yet", expect.anything());
    expect(screen.getByText("Searching all documents")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Ask about your documents" })).toBeTruthy();
  });
});

describe("a saved chat reopened (reload or Recent chats)", () => {
  it("keeps its saved scope and sends it with the next question", async () => {
    render(
      <ChatView
        chatId={chatId}
        title="Inventory"
        initialMessages={[question]}
        documents={documents}
        initialDocumentIds={[documents[0]!.id]}
      />,
    );

    expect(screen.getByText("Searching Tenancy agreement")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "And the deposit?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ documentIds: [documents[0]!.id] });
  });
});
