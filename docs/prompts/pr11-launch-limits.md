PR: Launch limits. New branch from main: feat/launch-limits.

Context: DocChat goes public on LinkedIn and X this week. Strangers will sign up and try to break it or run up the Gemini bill. I want sensible free-tier limits that are enforced on the server, explained clearly in the UI, and easy to change later.

Before changing anything, read how uploads, indexing, chat, the agent and the MCP tools work today, and find every place that already does rate limiting. Then show me a plan as a checklist, including the current limits you found and the numbers you propose, and wait for my approval. Don't run migrations against the main Neon branch; use a dev branch.

1. ONE PLACE FOR LIMITS

- Create lib/limits.ts holding every limit, each overridable by an env var, with these defaults:
  - MAX_DOCUMENTS_PER_USER = 3
  - MAX_FILE_MB = 10 (lower it if the current limit is lower)
  - MAX_PAGES_PER_DOCUMENT = 50
  - QUESTIONS_PER_MINUTE = 5 and QUESTIONS_PER_DAY = 30 per user
  - AGENT_RUNS_PER_DAY = 5 per user
  - MAX_QUESTION_CHARS = 1000
  - MAX_OUTPUT_TOKENS for chat answers (pick a value that fits our longest good eval answer, and tell me)
  - GLOBAL_QUESTIONS_PER_DAY = 2000 across all users (a circuit breaker for the bill)
- UNLIMITED_USER_IDS env var: a comma-separated list of Clerk user ids that skip per-user limits (my account, for demos). The global circuit breaker still applies to everyone.
- Add the new env vars to .env.example with comments. Write an ADR in docs/adr/ explaining the limits and why.

2. DOCUMENT LIMIT (3 per user)

- Enforce it on the server before any work or cost: before issuing the Vercel Blob upload token (onBeforeGenerateToken or equivalent) AND again when the document row is created. Someone calling the upload endpoint directly must not get around it.
- Count documents in every state (uploading, reading, ready, problem). Deleting a document frees a slot.
- Make it safe against races: two uploads at the same moment when the user has 2 documents must not end with 4. Use a transaction or lock, and add a test that proves it.
- Existing users who already have more than 3 keep their documents; they just can't add more until they're under the limit.
- Check the page count after text extraction and before embedding. Over MAX_PAGES_PER_DOCUMENT: stop, set the document to the problem state with a clear reason ("This PDF has 120 pages. The free limit is 50."), and embed nothing.
- Skip re-embedding when the same user uploads an identical file again (content hash): tell them they already have it.

3. ERRORS THE USER UNDERSTANDS

- Server actions and route handlers return typed results for limits, not thrown generic errors, e.g. { ok: false, code: "DOCUMENT_LIMIT", limit: 3 }. One client helper maps each code to a message.
- Show a toast (use the toast component the app already uses; add sonner through shadcn only if there isn't one) in our design system's problem colours, with a plain message and, where useful, an action:
  - Document limit: "You've reached the free limit of 3 documents. Delete one to upload another." Action: "Open library".
  - File too large or too many pages: say the limit and the file's actual size or pages.
  - Questions per minute: "You're asking quickly. Try again in 40 seconds." (the real wait time)
  - Questions per day: "You've used today's 30 questions. They reset at midnight UK time." (or whenever your window resets, stated correctly)
  - Agent runs: the same pattern.
  - Global circuit breaker: "DocChat is very busy today, so new questions are paused until tomorrow. Your documents are safe."
- Prevent the error before it happens where you can: the library shows "2 of 3 documents", and the upload button is disabled at 3 with a short note explaining why (keep it accessible: not only a greyed-out button). The chat composer shows the questions left today once it's 10 or fewer, and enforces MAX_QUESTION_CHARS with a counter.

4. RATE LIMITS THAT ACTUALLY WORK ON VERCEL

- Check how the existing rate limiter stores its counts. In-memory counters don't work across serverless instances. If that's what we have, move it to Postgres (a small table with an atomic upsert and a time window), unless you find a better fit already in the stack. No new paid service without asking me.
- Apply the same limits to the MCP tools, so Claude can't be used to get around them.
- Rate-limit re-indexing, retry and any other endpoint that triggers embeddings or model calls.
- Cap what we send to the model: only the last N messages of a conversation (choose N and tell me), plus MAX_OUTPUT_TOKENS on every model call.

5. TELL PEOPLE UP FRONT

- On the landing page near the sign-up button, add one short line: "Free: up to 3 documents and 30 questions a day." Read the numbers from lib/limits.ts so they can't drift.
- Mention the limits in the README's "What it does" section.

6. TESTS

- Unit tests for the limiter (window boundaries, the unlimited list, the global breaker).
- Playwright e2e with the fake providers: a user with 3 documents tries a 4th and sees the toast; the upload button is disabled at 3; asking past the per-minute limit shows the wait time. Keep the existing suites green, including the evals.

DONE MEANS
Every limit is enforced on the server, can't be bypassed through the upload endpoint or MCP, and shows a friendly message in the UI. Tests pass. Commit in logical steps, push, and open the PR with gh. Finish with a short summary listing every limit and its env var, the env vars I need to add in Vercel (including UNLIMITED_USER_IDS with my user id, which you can find in the dev database or tell me where to look), and anything you chose differently from this prompt and why.

---

Decided after the plan was approved:

1. MCP keeps its own allowance (30 searches and 60 tool calls a minute, MCP_SEARCHES_PER_DAY = 200), and the global breaker also pauses MCP search.
2. MAX_QUESTION_CHARS stays at 500 (env-overridable), with the toast and counter copy to match.
3. Before running any migration, print only the hostname from DATABASE_URL in .env.local, and wait for confirmation that it's the Neon dev branch.
