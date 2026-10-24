import "server-only";

import { auth } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

type ActionContext = { userId: string };

// Throw from a handler to fail with a message the user should see. Any other error becomes the
// generic "Something went wrong".
export class ActionError extends Error {
  override name = "ActionError";
}

// Wraps a Server Action: auth first, then Zod validation, then the handler. Export the result
// from a "use server" file. Input is typed for callers, but it still arrives untrusted.
export function authedAction<Schema extends z.ZodType, Data>(
  schema: Schema,
  handler: (input: z.output<Schema>, ctx: ActionContext) => Promise<Data>,
): (input: z.input<Schema>) => Promise<ActionResult<Data>> {
  return async (input) => {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "You need to be signed in." };

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Check the highlighted fields.",
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      };
    }

    try {
      return { ok: true, data: await handler(parsed.data, { userId }) };
    } catch (error) {
      // Let redirect() and notFound() through to Next.
      unstable_rethrow(error);
      if (error instanceof ActionError) return { ok: false, error: error.message };
      console.error(error);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}
