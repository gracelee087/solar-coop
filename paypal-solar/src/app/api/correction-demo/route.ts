import { NextResponse } from "next/server";
import { z } from "zod";
import { createCorrectionCase } from "../../../lib/correction-case";
import { extractCorrection } from "../../../lib/correction-extractor";
import { correctionInvoices, simulatedCorrectionPayments } from "../../../lib/correction-fixtures";

export const runtime = "nodejs";
const registry = new Map<string, { createdAt: number; session: ReturnType<typeof createCorrectionCase>; payment: ReturnType<typeof simulatedCorrectionPayments> }>();
let extracting = false;
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), document: z.string().min(1).max(16000), scenario: z.enum(["normal", "pending", "uncertain"]).default("normal") }).strict(),
  z.object({ action: z.literal("approve"), caseId: z.string().uuid(), token: z.string().length(64) }).strict(),
  z.object({ action: z.literal("check"), caseId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("simulate_completion"), caseId: z.string().uuid() }).strict(),
]);

/** Local development only. No credentials, live adapters, arbitrary model URL, or financial APIs. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (process.env.CORRECTION_LOCAL_AI !== "1" || !["127.0.0.1", "localhost"].includes(url.hostname)) return NextResponse.json({ error: "Local correction demo is disabled. Start on loopback with CORRECTION_LOCAL_AI=1." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  let data: z.infer<typeof inputSchema>;
  try {
    const raw = await request.text();
    if (raw.length > 20000) throw new Error("Too large");
    data = inputSchema.parse(JSON.parse(raw));
  } catch { return NextResponse.json({ error: "Invalid correction request" }, { status: 400 }); }
  for (const [key, value] of registry) if (Date.now() - value.createdAt > 3600_000) registry.delete(key);
  if (data.action === "inspect") {
    if (extracting || registry.size >= 30) return NextResponse.json({ error: "Local model busy or demo capacity reached; try later." }, { status: 429 });
    extracting = true;
    try {
      const extraction = await extractCorrection(data.document);
      const payment = simulatedCorrectionPayments({ pending: data.scenario === "pending", failRequest: data.scenario === "uncertain" });
      const session = createCorrectionCase(data.document, extraction.correction, correctionInvoices, payment.port, extraction);
      const report = await session.check();
      registry.set(report.caseId, { session, payment, createdAt: Date.now() });
      return NextResponse.json(report);
    } catch { return NextResponse.json({ error: "Local document extraction failed. Nothing was refunded; review the document or local model." }, { status: 502 }); }
    finally { extracting = false; }
  }
  const found = registry.get(data.caseId);
  if (!found) return NextResponse.json({ error: "Demo session expired. No live money moved." }, { status: 404 });
  if (data.action === "approve") return NextResponse.json(await found.session.approve(data.token));
  if (data.action === "simulate_completion") found.payment.complete();
  return NextResponse.json(await found.session.check());
}
