// Limits for questions, shared by the composer and POST /api/chat. The longest question is a
// free-tier limit (MAX_QUESTION_CHARS, src/lib/limits.ts), passed to the composer as a prop.

export const QUERY_MIN_CHARS = 3;

// Passages shown per question.
export const PASSAGE_LIMIT = 5;
