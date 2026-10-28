import "server-only";

import { generateText } from "ai";
import { z } from "zod";

import { callChatModel, SHORT_CALL_TIMEOUT_MS } from "./answer";
import { chatConfig } from "./models";
import { JUDGE_SYSTEM_PROMPT, judgePrompt } from "./prompts";
import { recordGeneration } from "./usage";

// LLM-as-judge for the answer eval (tests/evals/answers.ts): does a passage support a claim?

const verdictSchema = z.object({
  supported: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

export type Verdict = z.infer<typeof verdictSchema>;

const FORMAT = `Reply with JSON only: {"supported": true or false, "reason": "one line"}.`;

// The judge's reply as a verdict: JSON, possibly in a code fence or with text around it. Throws
// when there's no valid verdict in it.
export function parseVerdict(text: string): Verdict {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`The judge didn't reply with JSON: ${text.slice(0, 200)}`);
  return verdictSchema.parse(JSON.parse(json));
}

// Plain JSON in text rather than structured output: the Gemini free tier's judge is an open
// model (Gemma), and its JSON mode is enough; the reply is validated here either way.
export async function judgeClaim(userId: string, claim: string, passage: string): Promise<Verdict> {
  const { id, model, providerOptions } = chatConfig.models.judge;
  const prompt = `${judgePrompt(claim, passage)}\n\n${FORMAT}`;
  // The open model sometimes replies with nothing, or stops mid-JSON: ask again.
  for (let attempt = 1; ; attempt += 1) {
    const result = await callChatModel(() =>
      generateText({
        model,
        instructions: JUDGE_SYSTEM_PROMPT,
        prompt,
        providerOptions,
        // Room for the model's own reasoning before the short JSON.
        maxOutputTokens: 2_000,
        maxRetries: 0,
        timeout: SHORT_CALL_TIMEOUT_MS * 2,
      }),
    );
    await recordGeneration({
      userId,
      kind: "judge",
      model: id,
      usage: result.totalUsage,
      prompt: JUDGE_SYSTEM_PROMPT + prompt,
      output: result.text,
    });
    try {
      return parseVerdict(result.text);
    } catch (error) {
      if (attempt >= JUDGE_ATTEMPTS) throw error;
    }
  }
}

const JUDGE_ATTEMPTS = 3;
