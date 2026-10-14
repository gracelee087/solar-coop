import path from "node:path";
import { reviewException } from "../../../../lib/coop/exception-desk";

// Records the operator's review of an exception proposal. It records an opinion only: no reminder, refund, payout or
// PayPal call follows. Like decisions, refused on production builds unless ALLOW_COOP_DESK_DECISIONS=true.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_COOP_DESK_DECISIONS !== "true") {
    return Response.json({ error: "Reviews are disabled on this deployment: the reviewer name is not authentication" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const r = reviewException(path.join(process.cwd(), "runs"), body);
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
