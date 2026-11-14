import { MeterBar } from "@/components/meter-bar";
import { documentLimitFor } from "@/lib/limits";
import { requireUserId } from "@/server/auth";

import { countDocuments } from "../queries";

// "Documents 2 of 3" with a thin bar, above the user button. Reads the session, so render it
// inside <Suspense>. Unlimited users see just the count.
export async function DocumentsUsage() {
  const userId = await requireUserId();
  const count = await countDocuments(userId);
  const max = documentLimitFor(userId);

  if (max === null) {
    return (
      <div className="flex justify-between rounded-[10px] bg-surface-sunken p-3 text-xs">
        <span className="font-medium">Documents</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-surface-sunken p-3">
      <div className="flex justify-between text-xs">
        <span className="font-medium">Documents</span>
        <span className="text-muted-foreground">
          {count} of {max}
        </span>
      </div>
      <MeterBar
        value={count}
        max={max}
        label="Documents used"
        valueText={`${count} of ${max}`}
        className="h-1"
      />
    </div>
  );
}
