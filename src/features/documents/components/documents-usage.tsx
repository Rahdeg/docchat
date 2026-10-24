import { MeterBar } from "@/components/meter-bar";
import { requireUserId } from "@/server/auth";

import { countDocuments } from "../queries";
import { MAX_DOCUMENTS } from "../upload-rules";

// "Documents 6 of 20" with a thin bar, above the user button. Reads the session, so render it
// inside <Suspense>.
export async function DocumentsUsage() {
  const userId = await requireUserId();
  const count = await countDocuments(userId);

  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-surface-sunken p-3">
      <div className="flex justify-between text-xs">
        <span className="font-medium">Documents</span>
        <span className="text-muted-foreground">
          {count} of {MAX_DOCUMENTS}
        </span>
      </div>
      <MeterBar
        value={count}
        max={MAX_DOCUMENTS}
        label="Documents used"
        valueText={`${count} of ${MAX_DOCUMENTS}`}
        className="h-1"
      />
    </div>
  );
}
