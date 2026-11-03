import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarDaySchema,
  dueLabel,
  groupOf,
  groupTasks,
  localDay,
  summaryLine,
  type TaskItem,
} from "./task-rules";

const today = "2026-11-03";

function task(id: string, dueDate: string | null, extra: Partial<TaskItem> = {}): TaskItem {
  return {
    id,
    title: id,
    dueDate,
    dueNote: null,
    done: false,
    completedAt: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    createdBy: "user",
    source: null,
    ...extra,
  };
}

describe("calendar days", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("formats a local date without shifting it to UTC", () => {
    expect(localDay(new Date(2026, 10, 3, 23, 59))).toBe("2026-11-03");
  });

  it("accepts only real calendar days", () => {
    expect(calendarDaySchema.safeParse("2026-11-08").success).toBe(true);
    expect(calendarDaySchema.safeParse("2026-02-31").success).toBe(false);
    expect(calendarDaySchema.safeParse("8 Nov").success).toBe(false);
  });
});

describe("groupOf", () => {
  it.each([
    ["2026-11-01", "overdue"],
    ["2026-11-03", "week"],
    ["2026-11-09", "week"],
    ["2026-11-10", "later"],
    [null, "none"],
  ] as const)("puts %s in %s", (dueDate, group) => {
    expect(groupOf({ dueDate }, today)).toBe(group);
  });
});

describe("groupTasks", () => {
  it("orders groups and sorts each by due date, skipping empty ones", () => {
    const groups = groupTasks(
      [
        task("later", "2026-12-12"),
        task("b", "2026-11-08"),
        task("a", "2026-11-07"),
        task("none", null),
      ],
      today,
    );
    expect(groups.map((g) => [g.group, g.tasks.map((t) => t.id)])).toEqual([
      ["week", ["a", "b"]],
      ["later", ["later"]],
      ["none", ["none"]],
    ]);
  });
});

describe("dueLabel", () => {
  it("says when an open task was due", () => {
    expect(dueLabel("2026-11-01", today)).toBe("Was due 1 Nov");
  });

  it("doesn't call a done task overdue", () => {
    expect(dueLabel("2026-11-01", today, true)).toBe("Sun 1 Nov");
  });

  it("names today and tomorrow, then weekday and date", () => {
    expect(dueLabel("2026-11-03", today)).toBe("Today");
    expect(dueLabel("2026-11-04", today)).toBe("Tomorrow");
    expect(dueLabel("2026-11-07", today)).toBe("Sat 7 Nov");
  });

  it("adds the year outside this year", () => {
    expect(dueLabel("2027-01-15", today)).toBe("15 Jan 2027");
  });
});

describe("summaryLine", () => {
  it("counts open and overdue tasks", () => {
    expect(summaryLine([], today)).toBe("Nothing to do.");
    expect(summaryLine([task("a", "2026-11-08")], today)).toBe("1 to do.");
    expect(
      summaryLine([task("a", "2026-11-01"), task("b", null), task("c", "2026-11-09")], today),
    ).toBe("3 to do, and 1 is overdue.");
    expect(summaryLine([task("a", "2026-11-01"), task("b", "2026-10-01")], today)).toBe(
      "2 to do, and all are overdue.",
    );
  });
});
