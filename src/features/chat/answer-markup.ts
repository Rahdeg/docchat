// The little markup answers use (the system prompt asks for only this): paragraphs, "- " lists,
// **bold** and [n] citation markers. Parsed here rather than with a Markdown library: it's all
// answers need, it never renders HTML from the model, and half-streamed text stays readable.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "cite"; number: number };

export type Block = { type: "paragraph"; content: Inline[] } | { type: "list"; items: Inline[][] };

const LIST_ITEM = /^\s*[-*•]\s+/;

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    let paragraph: string[] = [];
    let items: string[] = [];
    const flushParagraph = () => {
      if (paragraph.length > 0)
        blocks.push({ type: "paragraph", content: inline(paragraph.join(" ")) });
      paragraph = [];
    };
    const flushList = () => {
      if (items.length > 0) blocks.push({ type: "list", items: items.map(inline) });
      items = [];
    };
    for (const line of lines) {
      if (LIST_ITEM.test(line)) {
        flushParagraph();
        items.push(line.replace(LIST_ITEM, ""));
      } else if (items.length > 0 && /^\s+/.test(line)) {
        // A wrapped list item.
        items[items.length - 1] += ` ${line.trim()}`;
      } else {
        flushList();
        paragraph.push(line.trim());
      }
    }
    flushParagraph();
    flushList();
  }
  return blocks;
}

const TOKEN = /\*\*([^*]+?)\*\*|\[(\d{1,3})\]/g;

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) out.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ type: "bold", text: match[1] });
    else out.push({ type: "cite", number: Number(match[2]) });
    last = match.index + match[0].length;
  }
  // A "**" still waiting for its closing pair while streaming isn't shown.
  const rest = text.slice(last).replace(/\*\*(?=[^*]*$)/, "");
  if (rest) out.push({ type: "text", text: rest });
  return out;
}

// The answer as plain text, for copying: markers become the source names they stand for.
export function plainAnswer(text: string, sourceLabel: (number: number) => string | null): string {
  return text
    .replace(/\*\*([^*]+?)\*\*/g, "$1")
    .replace(/ ?\[(\d{1,3})\]/g, (_match, n: string) => {
      const label = sourceLabel(Number(n));
      return label ? ` [${n}]` : "";
    })
    .trim();
}
