"use client";

import { useSyncExternalStore } from "react";

import { localDay, utcDay, type CalendarDay } from "./task-rules";

const subscribe = () => () => {};

// Today in the viewer's time zone. The server renders with UTC's today; the browser switches
// to its own after hydrating, so "Overdue" and "This week" follow the viewer's calendar.
export function useToday(): CalendarDay {
  return useSyncExternalStore(
    subscribe,
    () => localDay(new Date()),
    () => utcDay(new Date()),
  );
}
