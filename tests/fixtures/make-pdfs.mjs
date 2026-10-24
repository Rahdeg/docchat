// Writes the PDF fixtures used by the indexing integration test. No dependencies: it builds the
// objects by hand and computes the cross-reference offsets. Run: node tests/fixtures/make-pdfs.mjs
import { writeFileSync } from "node:fs";

function pdf(pageContents) {
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

// One line of text per entry, top to bottom.
function textPage(lines) {
  const body = lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line}) Tj ET`);
  return body.join("\n");
}

const dir = new URL(".", import.meta.url);

writeFileSync(
  new URL("two-pages.pdf", dir),
  pdf([
    textPage([
      "Tenancy agreement.",
      "The rent is 950 pounds a month, paid on the first day of each month.",
      "The landlord may increase the rent once a year with one month's written notice.",
    ]),
    textPage([
      "Repairs and notice.",
      "The landlord keeps the structure and exterior of the property in repair.",
      "Either party may end the tenancy by giving two months' notice in writing.",
    ]),
  ]),
);

// Like a scanned page: graphics only, no text objects.
writeFileSync(new URL("no-text.pdf", dir), pdf(["0.8 g 72 72 468 648 re f"]));
