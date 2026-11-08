import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Newsreader } from "next/font/google";

// Serif for document names and document text (font-serif), and the public pages' headings.
// opsz keeps the 10px previews and the large headings each in their optical size.
const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

// The font variables for <html>: the root layout and global-error (which has its own <html>).
export const fontVariables = `${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable}`;
