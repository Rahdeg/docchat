import "server-only";

// Whether a follow-up can be searched as asked, skipping the rewrite call that works out what
// it refers to (docs/adr/0006). Each request counts on the free tier. When in doubt it says no:
// an unneeded rewrite costs one request, while searching "And a dog?" as asked finds the wrong
// passages.

// Opens by leaning on the previous turn: "And a dog?", "What about the deposit?".
const LEANS_ON = /^(and|but|or|so|also|then|what about|how about|what if|why|how come)\b/;
// Words that point back at something said earlier. "That" and "there" are often harmless
// ("is there a…", "says that…"); the existential "there" is removed first, "that" stays.
const REFERS_BACK =
  /\b(it|its|it's|itself|this|that|these|those|they|them|their|theirs|he|him|his|she|her|hers|one|ones|other|others|another|same|former|latter|above|previous|earlier|instead|else|too|again|either|neither|both|there|here)\b/;
const EXISTENTIAL_THERE = /\b(is|are|was|were) there\b|\bthere (is|are|was|were|will be)\b/g;
// Shorter questions ("How much?", "The deposit?") nearly always need the conversation.
const MIN_WORDS = 4;

export function readsStandalone(question: string): boolean {
  const text = question.toLowerCase().replace(/[‘’]/g, "'").replace(EXISTENTIAL_THERE, " ");
  const words = text.match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < MIN_WORDS) return false;
  return !LEANS_ON.test(text.trim()) && !REFERS_BACK.test(text);
}
