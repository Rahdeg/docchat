"use client";

import { ErrorView } from "@/components/error-view";
import { fontVariables } from "./fonts";
import "./globals.css";

// The root layout itself failed, so this replaces it: its own <html> and <body>, styles and fonts.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <title>Something went wrong | DocChat</title>
        <ErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}
