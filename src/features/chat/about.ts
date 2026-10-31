// Questions about DocChat itself and small talk ("who are you?", "what can you do?",
// "thanks"). They get one canned line instead of an answer from the documents: no search, no
// model call, no citations (docs/adr/0006). Shared by POST /api/chat, the answer eval and the
// browser, which hides the passages of an answer that turned out to be this line.

export const ABOUT_ANSWER =
  "I'm DocChat: I answer questions from the documents in your Library and show where each answer comes from. Try asking me something about your documents.";

const ABOUT_PREFIX = "I'm DocChat";

// The whole question, lowercased, without punctuation or a "DocChat," in front.
function normalize(question: string): string {
  return question
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey |hi |ok |so )?docchat /, "");
}

// Each pattern matches the whole question, so a question that goes on to mention a document
// ("what can you do with my lease?") is searched as usual.
const ABOUT_QUESTIONS = [
  // Greetings, thanks, goodbyes.
  /^(hi|hello|hey|hiya|howdy|yo|good (morning|afternoon|evening)|thanks|thank you|thx|cheers|bye|goodbye|ok|okay|cool|nice|great)( (there|again|a lot|so much|very much|docchat))*$/,
  /^how (are|r) (you|u)( doing| today)?$/,
  // Who or what DocChat is.
  /^(who|what) (are|r) (you|u)$/,
  /^(who|what) is docchat$/,
  /^what's (docchat|your name)$/,
  /^what is your name$/,
  /^(tell me about|introduce) (yourself|docchat)$/,
  /^are (you|u) (a |an )?(real )?(bot|robot|ai|human|person|real|legit|safe|alive|chatgpt|gpt|claude|gemini|fraud\w*|scam\w*)$/,
  // What it can do.
  /^what (can|do|does) (you|u|docchat) do$/,
  /^how (can|do|does) (you|u|docchat) (help( me)?|work)$/,
];

export function isAboutDocChat(question: string): boolean {
  const text = normalize(question);
  return ABOUT_QUESTIONS.some((pattern) => pattern.test(text));
}

// The canned line, whether the route sent it or the model wrote it (the system prompt tells it
// to, for the ones isAboutDocChat misses).
export function isAboutAnswer(text: string): boolean {
  return text.trimStart().replace(/[‘’]/g, "'").startsWith(ABOUT_PREFIX);
}
