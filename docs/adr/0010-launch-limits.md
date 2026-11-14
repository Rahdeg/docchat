# ADR 0010: Free-tier limits for launch

- Status: Accepted
- Date: 2026-11-14

## Context

DocChat goes public this week on LinkedIn and X. Anyone can sign up, and every answer is paid
for from a small prepaid Gemini balance (`docs/adr/0006`, amendment). Some visitors will try to
break it; a few will try to run up the bill. Before this PR the limits were:

- 20 documents per user, 10 MB per file, and no page limit.
- 25 **model calls** per user per UTC day (`CHAT_DAILY_LIMIT`), counted from `ai_usage` rows
  written after each call. Concurrent requests could all get in before any of them was counted,
  and one task request used up to 5 of the 25.
- Sliding-window rate limits in Postgres (`docs/adr/0008`): 30 searches a minute, 60 MCP calls a
  minute, 20 upload tokens an hour.
- No cap on re-reading a document ("Try again" re-embeds it), no duplicate check, and nothing
  across all users.
- The document limit was checked by counting and then inserting, so two uploads at once could
  both take the last slot.
- A refused request was a plain string, shown as is.

We want limits that are enforced on the server, explained in the UI, and easy to change.

## Decision

### 1. One place, one env var per limit

`src/lib/limits.ts` holds every number. Each has an env var, parsed with Zod (positive whole
numbers; anything else fails env validation at build and start):

| Limit                          | Env var                    | Default           |
| ------------------------------ | -------------------------- | ----------------- |
| Documents per user, any state  | `MAX_DOCUMENTS_PER_USER`   | 3                 |
| File size                      | `MAX_FILE_MB`              | 10                |
| Pages per PDF                  | `MAX_PAGES_PER_DOCUMENT`   | 50                |
| Questions per user per minute  | `QUESTIONS_PER_MINUTE`     | 5 (sliding 60 s)  |
| Questions per user per day     | `QUESTIONS_PER_DAY`        | 30 (UTC day)      |
| Task requests per user per day | `AGENT_RUNS_PER_DAY`       | 5 (UTC day)       |
| Question length                | `MAX_QUESTION_CHARS`       | 500               |
| Output tokens per answer       | `MAX_OUTPUT_TOKENS`        | 1,500             |
| Output tokens per agent step   | `AGENT_MAX_OUTPUT_TOKENS`  | 4,000             |
| Earlier messages sent          | `HISTORY_MESSAGES`         | 6                 |
| Questions, all users, per day  | `GLOBAL_QUESTIONS_PER_DAY` | 2,000 (UTC day)   |
| MCP searches per user per day  | `MCP_SEARCHES_PER_DAY`     | 200 (UTC day)     |
| Re-reads per user per hour     | `REINDEX_PER_HOUR`         | 10 (sliding hour) |
| Users who skip per-user limits | `UNLIMITED_USER_IDS`       | none              |

Fixed in code, because they protect the providers rather than the bill: 60 MCP calls and
30 searches a minute, 20 upload tokens an hour, 120 output tokens for a query rewrite and
2,000 characters per earlier message.

`limits.ts` is server-only (it reads `env`). Client components get the numbers they show as
props, and every refusal carries its own numbers, so nothing in the browser reads env. The
landing page is static, so it reads the numbers at build time; changing one on Vercel takes a
redeploy, which Vercel does when an env var changes.

**Why these numbers.** A typical answer costs about $0.003 on `gemini-3.6-flash` ($0.007 from
2027-01-01). 30 questions plus 5 task requests (up to 5 calls each) is at most about 55 calls,
roughly $0.20 a user a day, $0.40 at the 2027 prices. 2,000 questions a day across everyone is
about $6–14 a day in the worst case, which the prepaid balance can absorb for a launch week.
3 documents of 50 pages bound what one user can embed (about 300 chunks) and keep one
document well inside the indexing run's 300 s.

**Output tokens.** The longest good answer in the answer eval is about 170 tokens of text
(745 characters). Gemini counts thinking and the `<citations>` block as output too: chat calls
in the dev database run p50 222 and p95 1,179 output tokens. 1,500 (unchanged) leaves room
without letting one answer run away; lower would start cutting off the citations block. Agent
steps keep 4,000 for a proposal of eight tasks with quotes.

**History.** The last 6 messages (3 exchanges, each cut to 2,000 characters), unchanged: enough
for "and the deposit?" to resolve, and it keeps the prompt and its cost flat as a chat grows.
The prompts don't change, so the evals' results stand.

**Unlimited users.** `UNLIMITED_USER_IDS` (Clerk ids, comma-separated) skip every per-user count:
documents, questions, task requests, MCP calls and searches, uploads and re-reads. Input limits
(file size, pages, question length) still apply, because they protect the pipeline rather than
the bill, and so does the global breaker. Clerk ids differ per instance, so production needs the
production instance's id.

`CHAT_DAILY_LIMIT` is retired. It counted model calls, which users can't see or predict;
`QUESTIONS_PER_DAY` counts what they do, and `AGENT_RUNS_PER_DAY` bounds the expensive kind.

### 2. Counting in Postgres

The existing limiter already kept its counts in Postgres, so it works across serverless
instances; we kept it and added to it rather than adding Redis or a paid service.

- **Sliding windows** (`rate_limit_event`, one row per counted request, a per-user per-bucket
  advisory lock): per minute and per hour. New buckets: `question` and `reindex`. A refusal says
  exactly when the oldest request leaves the window ("Try again in 40 seconds").
- **Daily counters** (`usage_counter`, new): one row per user, kind and UTC day, counted with an
  atomic `insert … on conflict do update set count = count + 1 where count < max returning`.
  No lock to take, one row per user per day, and the global breaker is just a row with
  user id `*`. Old days are deleted as the user's new ones are written.
- **One transaction per request.** A question checks its minute, its day, a task request's day
  and the global breaker in that order; the first refusal rolls back everything counted before
  it. So a question refused by the user's own limit never uses up everyone's, and a question
  refused by the breaker doesn't use up the user's day.
- **Held up front, kept once the answer starts.** A question is counted before anything is
  saved, searched or sent to a model, which closes the old race where usage was written after
  the answer. If the search or the model fails or times out before the answer starts streaming
  (its first text, or the agent's first tool call), `releaseReservation` gives back exactly what
  it counted: its window event, and one off each daily counter on the day it was counted. Once
  the answer has started it counts, however it ends, including when the user presses Stop.

What counts as a question: every new question and every "Try again" on `/chat`, including a
task request (which also counts as an agent run) and a question about DocChat itself. Approving
or cancelling a proposal doesn't count: it makes no model call.

Daily limits reset at midnight UTC, and the messages say "midnight UTC". In winter that's UK
midnight too; in summer it's 1 am UK time, so naming the UK would be wrong half the year.

### 3. Documents

- The document limit is checked when the Blob upload token is issued (and in the local-store
  route), so a refused upload costs nothing, and again in `createDocument`, which counts and
  inserts under a per-user advisory lock. The second check is the one that holds: at 2 of 3,
  two simultaneous registrations end with exactly 3 documents, and the loser's file is
  deleted. Every state counts (uploading, reading, ready, problem); deleting frees a slot.
  Users already over the limit keep their documents and can't add more.
- **Pages:** checked as soon as a PDF opens, before any text is extracted (earlier than the
  spec asked, and cheaper). Over the limit, the document goes to the problem state with "This
  PDF has 120 pages. The free limit is 50." and nothing is embedded.
- **Duplicates:** the browser hashes the file (SHA-256) and asks first, so a file the user
  already has is never uploaded ("You already have this file as …"). The check that holds is in
  `indexDocument`: it hashes the stored bytes and records `document.content_hash` under a
  per-user lock on the hash, so of two copies read at once the second always sees the first and
  stops, before any embedding. Documents from before this change have no hash and aren't
  matched.
- "Try again" counts against `REINDEX_PER_HOUR`.

### 4. Refusals the user understands

Every refusal is a `LimitFailure` (`src/lib/limit-messages.ts`): a code plus the numbers its
message needs, for example `{ code: "DOCUMENT_LIMIT", max: 3 }`. Server Actions return it as
`limit` on a failed `ActionResult` (thrown as `LimitError`); route handlers answer
`{ error, limit }` as JSON (429, or 400 and 413 for input limits). `limitMessage` is the one
place that words them, used by the browser's toast, the server's `error` text, MCP results and
a document's problem message. `showLimitToast` shows them in the problem colours with an "Open
library" action where it helps. The Library shows "2 of 3 documents" and, at the limit, a
disabled (still focusable) upload button described by a visible note; the composer counts
characters and shows the questions left once there are 10 or fewer.

### 5. MCP

A connected AI app gets no more than our own pages: every call counts against 60 a minute, and
`search_documents` also against 30 searches a minute and `MCP_SEARCHES_PER_DAY`, and stops
while the global breaker is tripped. MCP searches have their own daily allowance rather than
using the 30 questions: a search is one embedding (a fraction of a cent), not a chat call, and
apps like Claude run several per answer. They don't count towards the global breaker for the
same reason. MCP can't upload or call our chat model, so it can't get around the document or
question limits.

## Consequences

- One file to read, one env var to change. Changing a limit doesn't need a migration.
- `usage_counter` is user data: `deleteUserRows` deletes it, and `schema.test.ts` lists it.
- Two kinds of limiter instead of one. The sliding window stays where an exact wait time
  matters; daily counters are cheaper and say "resets at midnight UTC" truthfully.
- A burst at the turn of a UTC day can use two days' allowance in a few minutes. Acceptable for
  a free tier.
- The global breaker pauses questions for everyone, including us. Raising
  `GLOBAL_QUESTIONS_PER_DAY` and redeploying lifts it.
- Duplicate detection only covers documents read after this change.
