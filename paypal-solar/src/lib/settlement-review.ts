import { evidenceDigest, evidenceProblems, latestEvidence } from "./case-evidence";
import type { MonthReport } from "./monthly-settlement";

/** Preparation only: neither a tax return nor a statement of actual taxable income. */
export function makeReviewPacket(report: MonthReport, generatedAt = new Date().toISOString()) {
  const rows = report.items.map((item) => {
    const payment = latestEvidence(item.evidence, "payment");
    const evidenceOk = evidenceProblems(item.caseId, item.evidence, ["agreement", "usage", "calculation", "paypal_invoice", "payment"]).length === 0
      && item.input?.invoiceNumber === item.caseId
      && evidenceDigest(latestEvidence(item.evidence, "calculation")?.snapshot ?? null) === evidenceDigest(item.input);
    const observedPaymentCents = item.state === "paid" && evidenceOk ? item.input?.amountCents ?? null : null;
    const latest = [...new Map(item.evidence.map((tag) => [tag.kind, tag])).values()];
    return {
      caseId: item.caseId, household: item.name, period: report.period, state: item.state,
      calculatedEnergyChargeCents: item.input?.amountCents ?? null,
      invoiceId: item.invoiceId, observedPaymentCents, paymentEnvironment: payment?.environment ?? "unconnected",
      actualFeeCents: null, actualRefundCents: null, taxPaidCents: null,
      evidenceIds: item.evidence.map((tag) => tag.id),
      gaps: latest.filter((tag) => tag.status !== "checked").map((tag) => ({ kind: tag.kind, status: tag.status, reason: tag.note })),
      problems: item.problems,
    };
  });
  return {
    schemaVersion: 1, title: "Settlement evidence review packet", generatedAt, period: report.period,
    execution: report.execution, status: "DRAFT_DEMO_NOT_FOR_TAX_FILING",
    scope: "One modelled month only. Not an annual account, tax return, tax exemption decision or refund claim.",
    taxTreatment: "UNASSESSED: the prototype's small-business assumption is not a tax-status determination.",
    summary: { cases: rows.length, calculatedEnergyChargesCents: rows.reduce((sum, row) => sum + (row.calculatedEnergyChargeCents ?? 0), 0),
      checkedPaymentObservationsCents: rows.reduce((sum, row) => sum + (row.observedPaymentCents ?? 0), 0),
      actualCashReceiptsCents: null, actualFeesCents: null, actualRefundsCents: null, taxableProfitCents: null },
    rows, monthProblems: report.problems,
    evidence: report.items.flatMap((item) => item.evidence),
    reviewChecklist: [
      "Confirm the owner, installation details and applicable income/VAT/electricity-tax treatment.",
      "Obtain real meter records, contracts and invoice originals; the current usage is modelled.",
      "Collect actual PayPal transactions, fees and refund records; sandbox/simulation is not money received.",
      "Collect supplier/grid bills and any tax notices; cost estimates are not receipts.",
      "Add all relevant periods before preparing annual totals. Missing values are unknown, not zero.",
      "Review with the responsible person or tax adviser before preparing any required filing. Nothing is submitted to ELSTER.",
    ],
    sources: [{ title: "ELSTER: digital receipts and their use", url: "https://www.elster.de/eportal/helpGlobal?themaGlobal=help_meine_belege" }],
  };
}

export type ReviewPacket = ReturnType<typeof makeReviewPacket>;
const escapeHtml = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const euro = (cents: number | null) => cents === null ? "Unknown / not connected" : `${(cents / 100).toFixed(2)} EUR`;

export function renderReviewPacket(packet: ReviewPacket): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Evidence review packet — demo draft</title><style>
  body{font-family:Arial,sans-serif;max-width:1120px;margin:40px auto;padding:0 28px;color:#182316;line-height:1.5}h1{font-size:38px;line-height:1.1}h2{margin-top:32px}small{color:#46543f}.banner{background:#fff2cf;border:2px solid #97650b;padding:18px}.stats{display:flex;gap:20px;margin:28px 0}.stats div{flex:1;background:#eef3e9;padding:20px}.stats b{display:block;font-size:30px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:12px;border-bottom:1px solid #aeb9a5;vertical-align:top}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f0;padding:12px;font-size:12px}summary{cursor:pointer}a{color:#245213}@media print{body{margin:0;max-width:none}details{break-inside:avoid}.banner{font-weight:bold}a{color:inherit}}</style></head><body>
  <small>NEIGHBOURHOOD SOLAR · PREPARATION FOR RECORD REVIEW</small><h1>One month. Linked evidence.<br>A review packet, ready to inspect.</h1>
  <div class="banner"><strong>DEMO DRAFT — NOT FOR TAX FILING</strong><br>${escapeHtml(packet.scope)}<br>Modelled energy and ${escapeHtml(packet.execution)} records. No real cash receipts are established.</div>
  <p>Period: <b>${escapeHtml(packet.period)}</b> · Prepared: ${escapeHtml(packet.generatedAt)}</p>
  <div class="stats"><div><b>${packet.summary.cases}</b>linked cases</div><div><b>${euro(packet.summary.calculatedEnergyChargesCents)}</b>calculated energy charges</div><div><b>Not assessed</b>taxable income / refund eligibility</div></div>
  <h2>Case register</h2><table><thead><tr><th>Household / case</th><th>Calculated charge</th><th>Checked payment observation</th><th>Actual fees / refunds / tax</th></tr></thead><tbody>${packet.rows.map((row) => `<tr><td><b>${escapeHtml(row.household)}</b><br><code>${escapeHtml(row.caseId)}</code></td><td>${euro(row.calculatedEnergyChargeCents)}</td><td>${euro(row.observedPaymentCents)}<br>${escapeHtml(row.paymentEnvironment)}</td><td>Unknown — supporting records needed</td></tr>`).join("")}</tbody></table>
  <h2>Missing records and review tasks</h2><ul>${packet.reviewChecklist.map((task) => `<li>${escapeHtml(task)}</li>`).join("")}</ul>
  <p><strong>${escapeHtml(packet.taxTreatment)}</strong></p>
  ${packet.rows.map((row) => `<details><summary>${escapeHtml(row.caseId)} — ${row.gaps.length} unresolved evidence categories</summary><ul>${row.gaps.map((gap) => `<li>${escapeHtml(gap.kind)} · ${escapeHtml(gap.status)}: ${escapeHtml(gap.reason)}</li>`).join("")}</ul></details>`).join("")}
  ${packet.monthProblems.length ? `<h2>Month errors</h2><pre>${escapeHtml(packet.monthProblems.join("\n"))}</pre>` : ""}
  <h2>Evidence index</h2><p>Open a record to inspect its attached snapshot. This is a local review copy, not an authenticated receipt or a submission confirmation.</p>
  ${packet.evidence.map((tag) => `<details><summary>${escapeHtml(tag.caseId)} · ${escapeHtml(tag.kind)} · ${escapeHtml(tag.status)}</summary><p>Source: ${escapeHtml(tag.source)}<br>Observed: ${escapeHtml(tag.observedAt)}<br>Environment: ${escapeHtml(tag.environment)}<br>ID: <code>${tag.id}</code><br>SHA-256: <code>${tag.sha256}</code></p><p>${escapeHtml(tag.note)}</p><pre>${escapeHtml(JSON.stringify(tag.snapshot, null, 2))}</pre></details>`).join("")}
  <p>ELSTER reference: <a href="https://www.elster.de/eportal/helpGlobal?themaGlobal=help_meine_belege">Digital receipts and their use</a>. This app does not transmit documents to ELSTER.</p></body></html>`;
}
