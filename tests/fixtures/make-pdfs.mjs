// Writes the PDF fixtures used by the indexing integration test.
// Run: node tests/fixtures/make-pdfs.mjs
import { writeFileSync } from "node:fs";

import { pdf, textPage } from "./pdf.mjs";

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
