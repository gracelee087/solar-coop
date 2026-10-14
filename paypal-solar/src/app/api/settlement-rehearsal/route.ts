import { runMonthlyRehearsal, type RehearsalScenario } from "../../../lib/monthly-rehearsal";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("scenario" in body) || typeof body.scenario !== "string" || !["normal", "missing_agreement", "amount_mismatch"].includes(body.scenario)) {
    return Response.json({ error: "Choose a supported rehearsal scenario" }, { status: 400 });
  }
  return Response.json(await runMonthlyRehearsal(body.scenario as RehearsalScenario), { headers: { "Cache-Control": "no-store" } });
}
