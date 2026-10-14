import path from "node:path";
import { decide } from "../../../../lib/coop/desk";

// Records a human approve/reject decision in the saved run. Never executes a payment; no PayPal or Gemini call.
// The approver name is not authentication, so a production build (e.g. a public deployment) refuses decisions unless
// ALLOW_COOP_DESK_DECISIONS=true is set for a deployment that is protected some other way.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_COOP_DESK_DECISIONS !== "true") {
    return Response.json({ error: "Decisions are disabled on this deployment: the approver name is not authentication" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const r = decide(path.join(process.cwd(), "runs"), body);
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
