// Upload rules shared by the browser (fast feedback) and the server (the real checks in the
// token route and registerDocument). No server-only imports: this file ships to the client.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS = 20;

// How many leading bytes the type sniffer needs.
export const SNIFF_BYTES = 8 * 1024;

export const fileKinds = {
  pdf: { mimeType: "application/pdf", label: "PDF", noun: "PDF" },
  md: { mimeType: "text/markdown", label: "MD", noun: "Markdown file" },
  txt: { mimeType: "text/plain", label: "TXT", noun: "text file" },
} as const;

export type FileKind = keyof typeof fileKinds;

const extensions: Record<string, FileKind> = {
  pdf: "pdf",
  md: "md",
  markdown: "md",
  txt: "txt",
};

// For <input type="file" accept>.
export const ACCEPTED_FILE_TYPES = [
  ...Object.keys(extensions).map((ext) => `.${ext}`),
  ...Object.values(fileKinds).map((kind) => kind.mimeType),
].join(",");

export function fileKindOf(fileName: string): FileKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return (ext && extensions[ext]) || null;
}

export function fileKindOfMimeType(mimeType: string): FileKind | null {
  const entry = Object.entries(fileKinds).find(([, kind]) => kind.mimeType === mimeType);
  return entry ? (entry[0] as FileKind) : null;
}

// "Tenancy agreement.pdf" -> "Tenancy agreement".
export function displayName(fileName: string): string {
  return fileKindOf(fileName) ? fileName.replace(/\.[^.]+$/, "") : fileName;
}

export type RuleCheck = { ok: true; kind: FileKind } | { ok: false; error: string };

export const limitReachedMessage = `You can keep up to ${MAX_DOCUMENTS} documents. Remove one to add another.`;

// Name, size and the per-user limit. `documentCount` is how many the user already has,
// including uploads in progress.
export function checkFile(file: { name: string; size: number }, documentCount: number): RuleCheck {
  const kind = fileKindOf(file.name);
  if (!kind) return { ok: false, error: `${file.name} isn't a PDF, Markdown or text file.` };
  if (file.size === 0) return { ok: false, error: `${file.name} is empty.` };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: `${file.name} is larger than 10 MB.` };
  if (documentCount >= MAX_DOCUMENTS) return { ok: false, error: limitReachedMessage };
  return { ok: true, kind };
}

// Checks the file's leading bytes, not its extension: a PDF must start with the %PDF- marker
// (within the first 1 KB, as the spec allows), and Markdown or text must be UTF-8 with no NUL
// bytes. Pass at least SNIFF_BYTES bytes, or the whole file if it's smaller.
export function contentMatchesKind(kind: FileKind, head: Uint8Array): boolean {
  if (kind === "pdf") {
    const start = new TextDecoder("latin1").decode(head.subarray(0, 1024));
    return start.includes("%PDF-");
  }
  if (head.includes(0)) return false;
  try {
    // stream: true tolerates a multi-byte character cut off at the end of `head`.
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

export function contentMismatchMessage(fileName: string, kind: FileKind): string {
  return `${fileName} doesn't look like a real ${fileKinds[kind].noun}.`;
}

// Blob paths: users/<userId>/<uuid>-<safe file name>. The uuid keeps paths unique and
// unguessable; the server checks the userId segment against the signed-in user.
const pathnamePattern =
  /^users\/([A-Za-z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([^/]+)$/;

export function buildBlobPathname(userId: string, fileName: string, id: string): string {
  return `users/${userId}/${id}-${safeFileName(fileName)}`;
}

export function parseBlobPathname(
  pathname: string,
): { userId: string; id: string; fileName: string } | null {
  const match = pathnamePattern.exec(pathname);
  if (!match) return null;
  const [, userId, id, fileName] = match;
  return { userId: userId!, id: id!, fileName: fileName! };
}

// Keeps letters, digits, spaces, dots, dashes and underscores, and the extension.
export function safeFileName(fileName: string): string {
  const ext = /\.[A-Za-z0-9]+$/.exec(fileName)?.[0] ?? "";
  const base = fileName.slice(0, fileName.length - ext.length);
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w .-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .trim()
    .slice(0, 100);
  return `${cleaned || "document"}${ext.toLowerCase()}`;
}
