import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cacheLife } from "next/cache";

// Colours for next/og images, which can't read CSS variables. The same values as the theme
// tokens in src/app/globals.css.
export const brand = {
  desk: "#e8ebee",
  paper: "#ffffff",
  ink: "#1d2433",
  secondaryText: "#3b4250",
  muted: "#5a6272",
  border: "#c7ced7",
  sunken: "#f4f6f8",
  borderSoft: "#d5dae0",
  highlight: "#ffe45c",
} as const;

// A copy of the file's bytes as a plain ArrayBuffer (cached values must be serializable).
function arrayBuffer(file: Buffer): ArrayBuffer {
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

// Satori reads TrueType, not woff2: Geist from the geist package, Newsreader (OFL) committed
// next to this file. Cached (Cache Components counts file reads as uncached data), so the
// image is still prerendered at build time.
export async function ogFonts() {
  "use cache";
  cacheLife("max");
  // Literal paths, so the build traces just these files.
  const files = await Promise.all([
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-Medium.ttf")),
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf")),
    readFile(join(process.cwd(), "src/app/_og/Newsreader-Medium.ttf")),
  ]);
  const [geist, geistSemiBold, newsreader] = files.map(arrayBuffer) as [
    ArrayBuffer,
    ArrayBuffer,
    ArrayBuffer,
  ];
  return [
    { name: "Geist", data: geist, weight: 500 as const, style: "normal" as const },
    { name: "Geist", data: geistSemiBold, weight: 600 as const, style: "normal" as const },
    { name: "Newsreader", data: newsreader, weight: 500 as const, style: "normal" as const },
  ];
}
