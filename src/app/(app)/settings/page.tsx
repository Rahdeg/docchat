import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountCard } from "@/features/settings/components/account-card";
import { ConnectCard } from "@/features/settings/components/connect-card";
import { MCP_URL } from "@/lib/app-url";
import { env } from "@/lib/env";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Settings · DocChat" };

export default function SettingsPage() {
  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Settings</h1>
        <Suspense fallback={<SettingsSkeleton />}>
          <Settings />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function Settings() {
  // Nothing here is the user's data, but every (app) page checks the session itself.
  await requireUserId();
  return (
    <>
      <ConnectCard mcpUrl={MCP_URL} enabled={env.MCP_ENABLED} />
      <AccountCard />
    </>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-[420px] w-full rounded-xl" />
      <Skeleton className="h-[140px] w-full rounded-xl" />
    </div>
  );
}
