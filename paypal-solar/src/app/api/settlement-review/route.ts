import { loadMonthlyPlan } from "../../../lib/monthly-data";
import { runMonthlyRehearsal } from "../../../lib/monthly-rehearsal";
import { makeReviewPacket, renderReviewPacket } from "../../../lib/settlement-review";
import type { MonthReport } from "../../../lib/monthly-settlement";

/** Read-only, local prototype export. No payment/model calls, no tax filing. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const source = query.get("source") ?? "recorded", format = query.get("format") ?? "html";
  if ([...query.keys()].some((key) => !["source", "format"].includes(key)) || query.getAll("source").length > 1 || query.getAll("format").length > 1 || !["recorded", "simulation"].includes(source) || !["html", "json"].includes(format)) return Response.json({ error: "Choose recorded or simulation, and html or json" }, { status: 400 });
  const plan = loadMonthlyPlan();
  const report: MonthReport = source === "simulation" ? (await runMonthlyRehearsal("normal")).first : {
    ...plan, execution: "local_preview", finished: false, reviewRequired: plan.problems.length + plan.items.filter((item) => item.state === "needs_review").length,
    paidCount: 0, pendingCount: 0, events: [],
  };
  const packet = makeReviewPacket(report);
  return new Response(format === "html" ? renderReviewPacket(packet) : JSON.stringify(packet, null, 2), {
    headers: { "Content-Type": format === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      ...(format === "json" ? { "Content-Disposition": `attachment; filename="settlement-review-${source}.json"` } : {}) },
  });
}
