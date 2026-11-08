"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";

// Tags browser error reports with the Clerk user id, and nothing else about the user
// (src/lib/monitoring.ts). Inside AuthProvider, so only where Clerk already runs. Does nothing
// without a DSN: Sentry's SDK isn't even loaded.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function MonitoringUser() {
  const { userId } = useAuth();
  useEffect(() => {
    if (!dsn) return;
    void import("@sentry/nextjs").then((Sentry) => Sentry.setUser(userId ? { id: userId } : null));
  }, [userId]);
  return null;
}
