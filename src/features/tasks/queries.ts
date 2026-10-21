import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { task, type Task } from "@/server/db/schema";

// Open tasks first, then newest first.
export async function listTasks(userId: string): Promise<Task[]> {
  return db
    .select()
    .from(task)
    .where(eq(task.userId, userId))
    .orderBy(asc(task.done), desc(task.createdAt));
}
