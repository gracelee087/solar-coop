import path from "node:path";
import { ZodError } from "zod";
import { loadWorkbench, workbenchAction } from "../../../../lib/coop/workbench";
import { seedWorkbench } from "../../../../lib/coop/workbench-seed";

const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const period = params.get("period") ?? "2026-06";
  const source = params.get("source") ?? "agent";
  if (!["agent", "replay", "rehearsal"].includes(source) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return Response.json({ error: "Invalid month or source" }, { status: 400 });
  const view = loadWorkbench(path.join(process.cwd(), "runs"), period, source as "agent" | "replay" | "rehearsal");
  return Response.json(view ?? { error: "No saved month" }, { status: view ? 200 : 404, headers });
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_COOP_DESK_DECISIONS !== "true") return Response.json({ error: "Local review only: this deployment has no operator authentication." }, { status: 403 });
  // Browser writes must originate on this host; names are audit labels, not authentication.
  // Compare with the Host header: the dev server rewrites request.url to localhost even when opened at 127.0.0.1.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin && URL.parse(origin)?.host !== host) return Response.json({ error: "Cross-origin writes are disabled" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (body && typeof body === "object" && "action" in body && body.action === "start_rehearsal") return Response.json(await seedWorkbench(process.cwd()), { headers });
    return Response.json(workbenchAction(path.join(process.cwd(), "runs"), body), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ZodError ? "Invalid workbench request" : (error as Error).message }, { status: error instanceof ZodError ? 400 : 409, headers });
  }
}
