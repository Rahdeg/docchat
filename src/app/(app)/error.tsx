"use client";

import { ErrorView } from "@/components/error-view";

// A signed-in page failed: the message on the page, with the sidebar still there.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <title>Something went wrong | DocChat</title>
      <ErrorView error={error} retry={retry} inset />
    </>
  );
}
