import path from "node:path";
import { loadWorkbench } from "@/lib/coop/workbench";
import Workbench from "./workbench";
import { submissionWorkbench } from "@/lib/coop/submission-evidence";
export const dynamic = "force-dynamic";
export default async function CoopPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; source?: string }>;
}) {
  const params = await searchParams;
  const source = (["agent", "replay", "rehearsal"] as const).find(
    (s) => s === params.source,
  );
  const period =
    params.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period)
      ? params.period
      : "2026-06";
  const saved =
    params.source === "evidence"
      ? null
      : loadWorkbench(path.join(process.cwd(), "runs"), period, source);
  const snapshot =
    period === "2026-06" &&
    (params.source === "evidence" || (!saved && !source));
  const initial = snapshot ? submissionWorkbench() : saved;
  const writable =
    !snapshot &&
    (process.env.NODE_ENV !== "production" ||
      process.env.ALLOW_COOP_DESK_DECISIONS === "true");
  return (
    <Workbench initial={initial} writable={writable} snapshot={snapshot} />
  );
}
