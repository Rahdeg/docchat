// When the chat may propose tasks (docs/adr/0007). The agent's tools are only offered when the
// user's own message asks for tasks, so text in a document can never start a proposal by
// itself. Shared by POST /api/chat and the browser ("Turn this into tasks").

// What the "Turn this into tasks" button under an answer sends.
export const TURN_INTO_TASKS = "Turn this into tasks";

const TASK_REQUEST = new RegExp(
  [
    // "tasks", "a task", "to-do", "todo list", "checklist", "action items/points"
    String.raw`\btasks?\b`,
    String.raw`\bto-?dos?\b`,
    String.raw`\bcheck-?list\b`,
    String.raw`\baction (?:items?|points?)\b`,
    // "deadlines", "next steps", "remind me", "make a list"
    String.raw`\bdeadlines?\b`,
    String.raw`\bnext steps?\b`,
    String.raw`\bremind me\b`,
    String.raw`\bmake (?:me )?a list\b`,
    // "what should I do", "what do I need to do", "what do I have to do"
    String.raw`\bwhat (?:should|must) i do\b`,
    String.raw`\bwhat do i (?:need|have) to do\b`,
    String.raw`\bthings (?:i need )?to do\b`,
  ].join("|"),
  "i",
);

// The user's message asks for tasks: a checklist, deadlines, reminders, next steps.
export function asksForTasks(question: string): boolean {
  return TASK_REQUEST.test(question.replace(/[‘’]/g, "'"));
}

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*`;

const DUTY = new RegExp(
  [
    // Obligations: "must", "is required to", "has to", "needs to", "shall"
    String.raw`\bmust\b`,
    String.raw`\b(?:required|obliged) to\b`,
    String.raw`\b(?:have|has|need|needs) to\b`,
    String.raw`\bshall\b`,
    // Deadlines: "deadline", "due", "no later than", "within 7 days", "notice"
    String.raw`\bdeadlines?\b`,
    String.raw`\bdue\b`,
    String.raw`\bno later than\b`,
    String.raw`\bwithin \w+ (?:working )?(?:days?|weeks?|months?)\b`,
    String.raw`\bnotice\b`,
    // Dates: "1 March", "March 1", "1/3/2026", "2026-03-01"
    String.raw`\b\d{1,2}(?:st|nd|rd|th)? ${MONTH}\b`,
    String.raw`\b${MONTH} \d{1,2}\b`,
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
  ].join("|"),
  "i",
);

// An answer worth offering "Turn this into tasks" under: it mentions duties, deadlines or
// dates. Costs nothing until it's clicked.
export function mentionsDuties(answer: string): boolean {
  return DUTY.test(answer);
}
