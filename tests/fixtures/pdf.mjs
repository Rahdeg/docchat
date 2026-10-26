// A minimal PDF writer for test fixtures. No dependencies: it builds the objects by hand and
// computes the cross-reference offsets. Text is Helvetica and must be plain ASCII.

// A PDF with one page per entry; each entry is that page's content stream.
export function pdf(pageContents) {
  const objects = [];
  const pageIds = pageContents.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageContents.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageContents.forEach((content, i) => {
    const pageId = pageIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

// Backslashes and parentheses are special inside a PDF string.
function escape(line) {
  return line.replace(/[\\()]/g, (c) => `\\${c}`);
}

// One line of text per entry, top to bottom.
export function textPage(lines, { size = 12, leading = 18, top = 720 } = {}) {
  const body = lines.map(
    (line, i) => `BT /F1 ${size} Tf 72 ${top - i * leading} Td (${escape(line)}) Tj ET`,
  );
  return body.join("\n");
}

// Wraps a paragraph at word boundaries to lines of at most `width` characters.
export function wrap(paragraph, width) {
  const lines = [];
  let line = "";
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
