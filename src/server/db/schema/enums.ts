import "server-only";

import { pgEnum } from "drizzle-orm/pg-core";

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "indexing",
  "ready",
  "failed",
]);

export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);
