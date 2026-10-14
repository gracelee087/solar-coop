import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractCorrection, extractionPrompt, extractionJsonSchema } from "../src/lib/correction-extractor";
import { createCorrectionCase } from "../src/lib/correction-case";
import { correctionDocument, correctionInvoices, simulatedCorrectionPayments } from "../src/lib/correction-fixtures";

async function main() {
  const run = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = `runs/correction/${run}`; mkdirSync(dir, { recursive: true });
  const draft = process.argv.includes("--draft");
  const document = draft ? correctionDocument.replace("Der endgültige korrigierte", "Der vorläufige korrigierte").replace("Diese Berichtigung ist endgültig und ersetzt den bisherigen Rechnungsbetrag.", "ENTWURF: Diese Berichtigung ist NICHT endgültig und ersetzt die bisherige Rechnung noch nicht.") : correctionDocument;
  const model = process.argv.find((arg) => arg.startsWith("--model="))?.slice(8) ?? "gemma4:e4b";
  writeFileSync(`${dir}/protocol.json`, JSON.stringify({ createdAt: new Date().toISOString(), model, mode: "development_rehearsal", document, invoices: correctionInvoices,
    prompt: extractionPrompt, schema: extractionJsonSchema, promptSha256: createHash("sha256").update(extractionPrompt).digest("hex"),
    humanTiming: null, note: "Synthetic case; development rehearsal, not a blinded benchmark. Real local model; simulated payment provider. No time-saving claim." }, null, 2));
  try {
    const extraction = await extractCorrection(document, { model });
    writeFileSync(`${dir}/extraction.json`, JSON.stringify(extraction, null, 2));
    const payment = simulatedCorrectionPayments();
    const session = createCorrectionCase(document, extraction.correction, correctionInvoices, payment.port, extraction);
    const inspected = await session.check();
    const final = inspected.approvalToken ? await session.approve(inspected.approvalToken) : inspected;
    await session.check();
    const result = { run, inspected, final, paymentRequests: payment.requests(), humanApprovals: 0,
      approvalSource: "scripted test approval; no human participant", humanElapsedMs: null, expected: draft ? "needs_review" : "resolved", success: draft ? final.state === "needs_review" && payment.requests() === 0 : final.state === "resolved" && payment.requests() === 1 };
    writeFileSync(`${dir}/result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ directory: dir, state: final.state, requests: payment.requests(), localModelMs: extraction.elapsedMs, problems: final.problems }));
    if (!result.success) process.exitCode = 1;
  } catch (e) {
    writeFileSync(`${dir}/failure.json`, JSON.stringify({ message: (e as Error).message }, null, 2));
    console.error((e as Error).message); process.exitCode = 1;
  }
}
void main();
