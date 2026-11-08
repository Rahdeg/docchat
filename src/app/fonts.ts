import { GeistSans } from "geist/font/sans";
import { Newsreader } from "next/font/google";

// Serif for document names and document text (font-serif), and the public pages' headings.
// opsz keeps the 10px previews and the large headings each in their optical size. No italic:
// nothing uses it, and each style is another preloaded file on every page.
const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-newsreader",
});

// The font variables for <html>: the root layout and global-error (which has its own <html>).
// Geist Mono is set in the (app) layout instead, so only signed-in pages preload it.
export const fontVariables = `${GeistSans.variable} ${newsreader.variable}`;
