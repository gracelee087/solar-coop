// Runs the grounding experiment. Dry run by default: prints and saves the requests, calls nothing.
// A real call needs both ALLOW_JEV_CALL=true and TYPESAFE_API_KEY in .env.local, and the user's approval first.
//   npx tsx experiments/jev-grounding/run.ts
import "../../scripts/env";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLAIMS, CONFIDENCE_THRESHOLD, PROPOSALS } from "./cases";
import { claimRequest, explanationRequests, proposalRequest, review, type ReviewResult, type SystemOneRequest } from "./jev";
import { EXPLANATIONS } from "./real-outputs";

/** Fixed before any result: a noul answer at or above this counts as yes. */
export const NOUL_YES = 0.5;

const live = process.env.ALLOW_JEV_CALL === "true";
const out = path.join(__dirname, "..", "..", "runs", "jev-grounding");
mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

interface Job { id: string; group: "written_claims" | "real_outputs"; variant?: "original" | "fixed"; expected: Record<string, unknown>; req: SystemOneRequest }

const jobs: Job[] = [
  ...CLAIMS.map((c) => ({ id: `claim ${c.id}`, group: "written_claims" as const, expected: c.expected, req: claimRequest(c, PROPOSALS.find((p) => p.id === c.proposalId)!) })),
  ...PROPOSALS.map((p) => ({ id: `proposal ${p.id}`, group: "written_claims" as const, expected: p.expected, req: proposalRequest(p) })),
  ...EXPLANATIONS.flatMap((e) =>
    explanationRequests(e).map(({ part, req }) => ({
      id: `${e.id} ${part}`, group: "real_outputs" as const, variant: e.variant,
      expected: Object.fromEntries(Object.keys(req.questions).map((q) => [q, e.expected[q as keyof typeof e.expected]])), req,
    })),
  ),
];

/** An answer that flags a problem: weak or contradicted support, an omission, or a rule conflict. */
const isWarning = (q: string, v: unknown) =>
  (q.endsWith("_support") && v !== "supports") || (q === "omits_relevant" && v === true) || (q === "rule_fit" && v === "inconsistent");

function compare(j: Job, r: ReviewResult) {
  return Object.entries(j.expected).map(([q, expected]) => {
    const a = r.answers?.[q];
    const actual = a === undefined ? "not_reviewed" : a.choice ?? (a.noul! >= NOUL_YES);
    return { question: q, expected, actual, match: actual === expected, falseWarning: j.variant === "fixed" && isWarning(q, actual) && !isWarning(q, expected) };
  });
}

async function main() {
  const chars = jobs.reduce((s, j) => s + JSON.stringify(j.req).length, 0);
  console.log(`${jobs.length} requests (${jobs.filter((j) => j.group === "real_outputs").length} on real outputs), ${chars} characters of JSON (token count is reported by the API only)`);
  if (!live) {
    const file = path.join(out, `dry-run-${stamp}.json`);
    writeFileSync(file, JSON.stringify({ source: "dry_run", threshold: CONFIDENCE_THRESHOLD, noulYes: NOUL_YES, jobs }, null, 2) + "\n");
    console.log(`Dry run: nothing was sent. Requests saved to ${path.relative(process.cwd(), file)}`);
    return;
  }
  const results = [];
  for (const j of jobs) {
    const result = await review(j.req, { apiKey: process.env.TYPESAFE_API_KEY });
    const checks = result.status === "reviewed" ? compare(j, result) : [];
    results.push({ id: j.id, group: j.group, variant: j.variant, expected: j.expected, result, checks });
    console.log(`${j.id}: ${result.status}${result.reason ? ` (${result.reason})` : ""} ${checks.map((c) => `${c.question}=${c.actual}${c.match ? "" : ` (expected ${c.expected})`}`).join(" ")}`);
  }
  const real = results.filter((r) => r.group === "real_outputs");
  const all = real.flatMap((r) => r.checks);
  const summary = {
    notReviewed: real.filter((r) => r.result.status !== "reviewed").length,
    matches: `${all.filter((c) => c.match).length}/${all.length}`,
    falseWarningsOnFixed: all.filter((c) => c.falseWarning).length,
    usage: results.reduce((s, r) => s + (r.result.usage?.input_tokens ?? 0), 0),
  };
  console.log(`Real outputs: ${summary.matches} answers as expected, ${summary.falseWarningsOnFixed} false warnings on fixed versions, ${summary.notReviewed} not reviewed; ${summary.usage} input tokens in total`);
  const file = path.join(out, `jev-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ source: "jev", ranAt: new Date().toISOString(), threshold: CONFIDENCE_THRESHOLD, noulYes: NOUL_YES, summary, results }, null, 2) + "\n");
  console.log(`Saved ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
