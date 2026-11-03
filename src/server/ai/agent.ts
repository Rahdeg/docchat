import "server-only";

import {
  isStepCount,
  streamText,
  tool,
  wrapLanguageModel,
  type LanguageModelMiddleware,
  type TextStreamPart,
  type ToolSet,
} from "ai";

import {
  proposeTasksInput,
  proposeTasksOutput,
  searchDocumentsInput,
  searchDocumentsOutput,
  type ProposeTasksInput,
  type Proposal,
} from "@/features/chat/agent-parts";
import { messageText, type ChatUIMessage, type PassageData } from "@/features/chat/message";

import { callChatModel, findAnswerPassages, rewriteQuery } from "./answer";
import { CitationFilter, parseCitationBlock, resolveCitations, type Resolved } from "./citations";
import { checkDailyLimit } from "./limits";
import { chatConfig, MIN_SIMILARITY } from "./models";
import { AGENT_SYSTEM_PROMPT, agentMessages, searchResultText } from "./prompts";
import { checkProposal } from "./proposal";
import { searchPassages } from "./retrieve";
import { recordGeneration } from "./usage";

// Task mode (docs/adr/0007): when the user asks for tasks, the answer model gets two tools.
// searchDocuments finds more passages; proposeTasks shows the tasks to the user and needs their
// approval. proposeTasks has no execute: the SDK can only ask for approval, and the only way a
// task is saved is the approve request (createAgentTasks), after the user clicks "Add".

// Model calls per run. Each one counts towards the daily limit.
export const AGENT_MAX_STEPS = 5;
// Passages read before the first step: a checklist needs more than one answer does.
export const AGENT_PASSAGES = 8;
const SEARCH_PASSAGES = 5;
// Sources one run can number.
const RUN_MAX_PASSAGES = 24;
const AGENT_MAX_OUTPUT_TOKENS = 4_000;
const AGENT_TIMEOUT = { firstChunkMs: 75_000, stepMs: 60_000, totalMs: 105_000 };

const pacedStream: LanguageModelMiddleware = {
  wrapStream: ({ doStream }) => callChatModel(doStream),
};

export type AgentRun = {
  // Numbered from 1: the passages read first, then what searchDocuments added.
  passages: PassageData[];
  // The proposeTasks call the run ended with, if any, and its approval request's id.
  proposal: { toolCallId: string; input: ProposeTasksInput; approvalId?: string } | null;
};

type ToolOptions = {
  userId: string;
  // The documents the user chose for this question. The tools never search outside them.
  scope?: readonly string[];
  run: AgentRun;
  // The run's passages changed (a search added some).
  onPassages?: (passages: readonly PassageData[]) => void;
};

// The tools, built per request: the user comes from the session, never from the model.
export function agentTools({ userId, scope, run, onPassages }: ToolOptions) {
  return {
    searchDocuments: tool({
      description:
        "Search the user's documents for passages about something the sources you have don't cover. Returns new numbered sources.",
      inputSchema: searchDocumentsInput,
      outputSchema: searchDocumentsOutput,
      execute: async ({ query, documentIds }) => {
        const within = narrow(scope, documentIds);
        const found =
          within && within.length === 0
            ? []
            : await searchPassages({
                userId,
                query,
                documentIds: within,
                limit: SEARCH_PASSAGES,
                minSimilarity: MIN_SIMILARITY,
              });
        const added: number[] = [];
        const repeated: number[] = [];
        for (const passage of found) {
          const index = run.passages.findIndex((p) => p.chunkId === passage.chunkId);
          if (index !== -1) repeated.push(index + 1);
          else if (run.passages.length < RUN_MAX_PASSAGES) {
            run.passages.push(passage);
            added.push(run.passages.length);
          }
        }
        if (added.length > 0) onPassages?.(run.passages);
        return { added, repeated };
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: searchResultText(
          output.added.map((n) => run.passages[n - 1]!),
          output.added[0] ?? run.passages.length + 1,
          output.repeated,
        ),
      }),
    }),
    proposeTasks: tool({
      description:
        "Show the user the tasks you found in their documents, each with the source it comes from. The user checks them and decides which to add; nothing is saved until they approve.",
      inputSchema: proposeTasksInput,
      outputSchema: proposeTasksOutput,
    }),
  } satisfies ToolSet;
}

export type AgentTools = ReturnType<typeof agentTools>;

// The documents a search may cover: those the model asked for, within those the user chose.
// Undefined means all of the user's documents.
function narrow(
  scope: readonly string[] | undefined,
  asked: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!asked) return scope;
  if (!scope) return asked;
  return asked.filter((id) => scope.includes(id));
}

type AgentOptions = {
  userId: string;
  question: string;
  history: readonly ChatUIMessage[];
  // Read before the first step.
  passages: readonly PassageData[];
  // Ready documents the tools may search, for the prompt.
  documents: readonly { id: string; name: string }[];
  scope?: readonly string[];
  abortSignal?: AbortSignal;
  onCite?: (order: readonly number[]) => void;
  onPassages?: (passages: readonly PassageData[]) => void;
};

export type AgentStream = {
  result: ReturnType<typeof streamText<AgentTools>>;
  filter: CitationFilter;
  run: AgentRun;
  // After the stream ends: the text's citations, then the proposal checked against the run's
  // passages (its chips numbered after the citations).
  finish: () => Resolved & { proposal: Proposal | null };
};

export function streamAgent({
  userId,
  question,
  history,
  passages,
  documents,
  scope,
  abortSignal,
  onCite,
  onPassages,
}: AgentOptions): AgentStream {
  const run: AgentRun = { passages: [...passages], proposal: null };
  const filter = new CitationFilter({ sourceCount: () => run.passages.length, onCite });
  const messages = agentMessages(history, question, passages, documents);
  const tools = agentTools({ userId, scope, run, onPassages });
  const { id, model, providerOptions } = chatConfig.models.answer;
  const prompt = AGENT_SYSTEM_PROMPT + messages.map((m) => JSON.stringify(m.content)).join("\n");

  // Usage: one `chat` row per model call, so each step counts towards the daily limit.
  let stepOutput = "";
  let stepOpen = false;
  async function record(usage?: Parameters<typeof recordGeneration>[0]["usage"]) {
    stepOpen = false;
    const output = stepOutput;
    stepOutput = "";
    await recordGeneration({ userId, kind: "chat", model: id, usage, prompt, output });
  }

  const result = streamText({
    model: wrapLanguageModel({ model, middleware: pacedStream }),
    maxRetries: 0,
    instructions: AGENT_SYSTEM_PROMPT,
    messages,
    tools,
    toolApproval: { proposeTasks: "user-approval" },
    // Stops after AGENT_MAX_STEPS model calls, or as soon as the user's daily limit is used up.
    stopWhen: [isStepCount(AGENT_MAX_STEPS), async () => !(await checkDailyLimit(userId)).ok],
    // The last step can only propose: no more searching.
    prepareStep: ({ stepNumber }) =>
      stepNumber === AGENT_MAX_STEPS - 1 ? { activeTools: ["proposeTasks"] } : {},
    providerOptions,
    maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
    abortSignal,
    timeout: AGENT_TIMEOUT,
    experimental_transform: agentTransform(filter, run, {
      onStepOutput: (text) => {
        stepOpen = true;
        stepOutput += text;
      },
    }),
    onStepEnd: ({ usage }) => record(usage),
    onAbort: () => {
      if (stepOpen) void record();
    },
    // A step that failed before writing anything costs nothing and isn't counted.
    onError: ({ error }) => {
      console.error("Agent generation failed", error);
      if (stepOpen) void record();
    },
  });

  const userTexts = [...history.filter((m) => m.role === "user").map(messageText), question];

  return {
    result,
    filter,
    run,
    finish: () => {
      const resolved = resolveCitations({
        order: filter.order,
        quotes: parseCitationBlock(filter.block),
        passages: run.passages,
      });
      const proposal = run.proposal
        ? checkProposal({
            toolCallId: run.proposal.toolCallId,
            input: run.proposal.input,
            passages: run.passages,
            userTexts,
            firstCitation: resolved.citations.length + 1,
          })
        : null;
      return { ...resolved, proposal };
    },
  };
}

// Runs the model's text through the citation filter, and notes the proposeTasks call.
function agentTransform(
  filter: CitationFilter,
  run: AgentRun,
  { onStepOutput }: { onStepOutput: (text: string) => void },
) {
  return () =>
    new TransformStream<TextStreamPart<AgentTools>, TextStreamPart<AgentTools>>({
      transform(part, controller) {
        if (part.type === "text-delta") {
          onStepOutput(part.text);
          const text = filter.push(part.text);
          if (text) controller.enqueue({ ...part, text });
          return;
        }
        if (part.type === "text-end") {
          const rest = filter.flush();
          if (rest) controller.enqueue({ type: "text-delta", id: part.id, text: rest });
        }
        if (part.type === "tool-call") {
          onStepOutput(JSON.stringify(part.input ?? null));
          if (part.toolName === "proposeTasks" && !run.proposal) {
            const input = proposeTasksInput.safeParse(part.input);
            if (input.success) run.proposal = { toolCallId: part.toolCallId, input: input.data };
          }
        }
        if (part.type === "tool-approval-request" && run.proposal) {
          if (part.toolCall.toolCallId === run.proposal.toolCallId) {
            run.proposal.approvalId = part.approvalId;
          }
        }
        controller.enqueue(part);
      },
    });
}

export type AgentResult = {
  query: string;
  // Every passage the run read, numbered from 1.
  passages: PassageData[];
  text: string;
  // What the model proposed, before the server's checks.
  proposed: ProposeTasksInput | null;
  // What the approval card would show.
  proposal: Proposal | null;
  // Model calls made.
  steps: number;
};

type RunOptions = {
  userId: string;
  question: string;
  documentIds?: readonly string[];
  documents: readonly { id: string; name: string }[];
  history?: readonly ChatUIMessage[];
};

// A task request to completion, without streaming to anyone: for the agent eval. Proposes
// only; nothing is ever approved or saved here.
export async function runAgent({
  userId,
  question,
  documentIds,
  documents,
  history = [],
}: RunOptions): Promise<AgentResult> {
  const query = await rewriteQuery(userId, history, question);
  const passages = await findAnswerPassages({
    userId,
    query,
    documentIds,
    limit: AGENT_PASSAGES,
  });
  const agent = streamAgent({
    userId,
    question,
    history,
    passages,
    documents,
    scope: documentIds,
  });
  let failure: unknown = null;
  await agent.result.consumeStream({ onError: (error) => (failure = error) });
  if (failure) throw failure;
  const { proposal } = agent.finish();
  return {
    query,
    passages: agent.run.passages,
    text: agent.filter.text,
    proposed: agent.run.proposal?.input ?? null,
    proposal,
    steps: (await agent.result.steps).length,
  };
}
