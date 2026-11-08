import type { Metadata } from "next";

import { ProblemPage } from "@/components/error-view";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <ProblemPage
      title="We couldn’t find that page"
      text="The link may be old, or the page may have been moved or deleted. If it was one of your chats or documents, it may have been removed."
      links
    />
  );
}
