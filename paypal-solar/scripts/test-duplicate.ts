// Error test: settling Haus 14 for June under the number of its already paid invoice must not bill twice.
import "./env";
import { settleWithAgent } from "../src/lib/settlement-agent";

(async () => {
  const r = await settleWithAgent({
    producer: { name: "Haus 12", email: "sb-c6nah53337070@business.example.com" },
    consumer: { name: "Haus 14", email: "sb-mocy053340320@personal.example.com" },
    period: "2026-06", sharedKWh: 131.31, priceCt: 13, amountCents: 1707,
    invoiceNumber: "ES-202606-H2-MV5R6U26", // already used and paid
    invoiceDate: "2026-07-01",
  });
  console.log(`outcome ${r.outcome}, invoice ${r.invoiceId} ${r.invoice?.status ?? ""}, agent tools: ${r.toolCalls.join(" → ") || "-"}`);
  console.log(`problems: ${r.problems.join("; ") || "none"}`);
  const pass = r.outcome === "existing" && r.invoiceId === "INV2-RX77-2QPA-EQNM-4YUQ" && r.toolCalls.length === 0;
  console.log(pass ? "PASS: existing invoice returned, nothing billed twice" : "FAIL");
  process.exit(pass ? 0 : 1);
})();
