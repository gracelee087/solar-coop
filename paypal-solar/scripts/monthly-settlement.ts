import "./env";
import { google } from "@ai-sdk/google";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { loadMonthlyPlan } from "../src/lib/monthly-data";
import { createMonthSession, type MonthEvent } from "../src/lib/monthly-settlement";
import { runMonthlyAgent } from "../src/lib/monthly-agent";
import { runMonthlyRehearsal } from "../src/lib/monthly-rehearsal";
import { getInvoice } from "../src/lib/paypal-api";
import { settleWithAgent } from "../src/lib/settlement-agent";
import { makeReviewPacket, renderReviewPacket } from "../src/lib/settlement-review";

async function main() {
  const mode = process.argv[2] ?? "preview";
  if (!["preview", "rehearsal", "agent-readonly", "agent-sandbox"].includes(mode) || process.argv.length > 3) throw new Error("Use preview | rehearsal | agent-readonly | agent-sandbox");
  if (mode === "agent-sandbox" && process.env.ALLOW_MONTHLY_SANDBOX_ISSUING !== "true") throw new Error("Sandbox invoice issuing is on hold. ALLOW_MONTHLY_SANDBOX_ISSUING must explicitly be true after that hold is lifted.");
  const dir = path.join(process.cwd(), "runs", "monthly-settlement");
  mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  const fd = openSync(`${base}.jsonl`, "wx");
  const record = (event: MonthEvent) => { writeSync(fd, JSON.stringify(event) + "\n"); fsyncSync(fd); };
  try {
    const plan = loadMonthlyPlan();
    const session = createMonthSession(plan, {
      execution: mode.startsWith("agent") ? "sandbox_agent" : "local_preview",
      allowIssue: mode === "agent-sandbox", settle: settleWithAgent, getInvoice,
      now: () => new Date().toISOString(), record,
    });
    let result;
    if (mode === "rehearsal") result = await runMonthlyRehearsal("normal");
    else if (mode === "preview") result = session.inspect();
    else {
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("Gemini key missing");
      // One named model, no hidden restart/fallback after financial tool calls.
      const name = process.env.MONTHLY_AGENT_MODEL ?? process.env.GEMINI_MODELS?.split(",")[0] ?? "gemini-3.5-flash-lite";
      result = { model: name, report: await runMonthlyAgent(session, google(name)) };
    }
    writeFileSync(`${base}.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    const report = "first" in result ? result.first : "report" in result ? result.report : result;
    const packet = makeReviewPacket(report);
    writeFileSync(`${base}-review.json`, JSON.stringify(packet, null, 2) + "\n", { flag: "wx" });
    writeFileSync(`${base}-review.html`, renderReviewPacket(packet), { flag: "wx" });
    console.log(JSON.stringify(result, null, 2));
    console.log(`Report: ${base}.json`);
  } finally { closeSync(fd); }
}

main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
