"use client";

import { ErrorView } from "@/components/error-view";

// Errors below the root layout. (app)/error.tsx catches the signed-in pages' own errors first,
// keeping the sidebar.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <title>Something went wrong | DocChat</title>
      <ErrorView error={error} retry={retry} />
    </>
  );
}
