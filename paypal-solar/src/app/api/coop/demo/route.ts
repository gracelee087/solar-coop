import { ZodError } from "zod";
import { DEMO_COOKIE, DEMO_LIMITS, demoAction, demoBase, loadDemo, startDemo } from "../../../../lib/coop/demo";

const headers = { "Cache-Control": "no-store" };
const cookieOf = (request: Request) =>
  request.headers.get("cookie")?.split(";").map((c) => c.trim().split("=")).find(([k]) => k === DEMO_COOKIE)?.[1];
const setCookie = (id: string) =>
  `${DEMO_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEMO_LIMITS.ttlMs / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export async function GET(request: Request) {
  const view = loadDemo(process.cwd(), demoBase(), cookieOf(request));
  return Response.json(view ?? { error: "No demo started" }, { status: view ? 200 : 404, headers });
}

// Public, per-visitor offline demo: fictional data, no payment execution, no model call. Enabled on the hosted site.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin && URL.parse(origin)?.host !== host) return Response.json({ error: "Cross-origin writes are disabled" }, { status: 403, headers });
  const raw = await request.text();
  if (raw.length > 4000) return Response.json({ error: "Request too large" }, { status: 413, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  try {
    if (body && typeof body === "object" && "action" in body && (body.action === "start" || body.action === "reset")) {
      const { id, view } = await startDemo(process.cwd(), demoBase(), cookieOf(request));
      return Response.json(view, { headers: { ...headers, "Set-Cookie": setCookie(id) } });
    }
    return Response.json(demoAction(process.cwd(), demoBase(), cookieOf(request), body), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ZodError ? "Invalid demo request" : (error as Error).message }, { status: error instanceof ZodError ? 400 : 409, headers });
  }
}
