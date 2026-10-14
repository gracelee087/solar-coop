import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExceptionCase } from "./exception-cases";
import { ruleAction } from "./exception-rules";
import { caseView, type CaseView, type ExceptionProposal } from "./exceptions";
import { withLock } from "./state";

/** agent = a model run; rules = the fixed rule baseline (not AI). Each is saved separately and never mixed. */
export type ExceptionSource = "agent" | "rules";

/** The operator's review of one proposal. It records an opinion only: no reminder, refund or PayPal change follows. */
export interface ExceptionReview {
  by: string;
  at: string;
  agrees: boolean;
  comment?: string;
}

export interface ExceptionRun {
  /** New for every saved run; a review must name the run it was made on. */
  runId: string;
  source: ExceptionSource;
  /**
   * Where the cases come from. Only synthetic evaluation cases exist so far, nothing fetched from PayPal.
   * synthetic_holdout = the held-out cases written before the prompt change (`exceptions-eval`).
   */
  dataset: "synthetic_cases" | "synthetic_holdout";
  savedAt: string;
  model: string | null;
  views: CaseView[];
  proposals: ExceptionProposal[];
  problems: string[];
  /** Model steps and tokens of an agent run, as reported by the provider per step. */
  usage?: { steps: number; inputTokens: number; outputTokens: number };
  reviews: Record<string, ExceptionReview>;
  /** A saved evaluation run shown as is: no review can be recorded on it. */
  readOnly?: true;
  /** Evaluation runs only: matches with the frozen answers, for the model run and the fixed rules. */
  score?: { agent: { correct: number; total: number }; rules: { correct: number; total: number } };
}

const file = (runsDir: string, source: ExceptionSource) => path.join(runsDir, "coop-exceptions", `${source}.json`);

export function loadExceptionRun(runsDir: string, source: ExceptionSource): ExceptionRun | null {
  const f = file(runsDir, source);
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, "utf8")) as ExceptionRun;
  if (r.source !== source || !Array.isArray(r.proposals)) throw new Error(`${f} is not an exception run for ${source}`);
  return r;
}

/**
 * The latest saved held-out evaluation run (`npm run coop -- exceptions-eval`), as a read-only desk run.
 * Nothing is recomputed; the proposals are the model's saved output.
 */
export function loadHoldoutRun(runsDir: string): ExceptionRun | null {
  const dir = path.join(runsDir, "coop-exceptions-eval");
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).filter((f) => /^holdout-.*\.json$/.test(f)).sort().at(-1);
  if (!name) return null;
  const r = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  if (r.source !== "agent" || r.dataset !== "synthetic_holdout" || !Array.isArray(r.proposals) || !Array.isArray(r.views)) {
    throw new Error(`${name} is not a held-out evaluation run`);
  }
  return {
    runId: name.replace(/\.json$/, ""),
    source: "agent",
    dataset: "synthetic_holdout",
    savedAt: r.ranAt,
    model: r.model ?? null,
    views: r.views,
    proposals: r.proposals,
    problems: r.problems ?? [],
    usage: r.usage,
    reviews: {},
    readOnly: true,
    score: { agent: r.agent, rules: r.rules },
  };
}

function write(runsDir: string, r: ExceptionRun) {
  const f = file(runsDir, r.source);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(r, null, 2) + "\n");
  renameSync(`${f}.${process.pid}.tmp`, f);
}

/** Saves a run under its lock; reviews of an earlier run of the same source are dropped with it. */
export function saveExceptionRun(runsDir: string, r: ExceptionRun): void {
  withLock(`${file(runsDir, r.source)}.lock`, `Exception run ${r.source}`, () => write(runsDir, r));
}

/** A new run id, for runs built outside this file (e.g. the agent run in the CLI). */
export const newRunId = () => randomUUID();

/** The fixed rule baseline as a run: it reads status, dates and counters, never the messages. */
export function ruleBaselineRun(cases: ExceptionCase[], at: Date): ExceptionRun {
  return {
    runId: randomUUID(),
    source: "rules",
    dataset: "synthetic_cases",
    savedAt: at.toISOString(),
    model: null,
    views: cases.map(caseView),
    proposals: cases.map((x) => ({
      caseId: x.id,
      action: ruleAction(x),
      reason: "Fixed rule from status, dates and counters. Messages are not read.",
      evidence: [],
      unverified: [],
      source: "rule" as const,
    })),
    problems: [],
    reviews: {},
  };
}

export interface ReviewBody {
  source: ExceptionSource;
  runId: string;
  caseId: string;
  by: string;
  agrees: boolean;
  comment?: string;
}

export function parseReview(body: unknown): ReviewBody | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Expected a JSON object";
  const b = body as Record<string, unknown>;
  if (b.source !== "agent" && b.source !== "rules") return "Invalid source";
  if (typeof b.runId !== "string" || !b.runId.trim() || b.runId.length > 80) return "Invalid run id";
  if (typeof b.caseId !== "string" || !/^X\d{2}$/.test(b.caseId)) return "Invalid case id";
  if (typeof b.by !== "string" || !b.by.trim() || b.by.length > 60) return "Reviewer name is required";
  if (typeof b.agrees !== "boolean") return "agrees must be true or false";
  if (b.comment !== undefined && (typeof b.comment !== "string" || b.comment.length > 300)) return "Invalid comment";
  if (!b.agrees && !(typeof b.comment === "string" && b.comment.trim())) return "Say what you would do instead";
  return { source: b.source, runId: b.runId, caseId: b.caseId, by: b.by.trim(), agrees: b.agrees, ...(b.comment ? { comment: (b.comment as string).trim() } : {}) };
}

/** Records the operator's review of one proposal. Changes nothing else: no payment, reminder or PayPal call. */
export function reviewException(runsDir: string, body: unknown, now = new Date()): { status: number; body: unknown } {
  const r = parseReview(body);
  if (typeof r === "string") return { status: 400, body: { error: r } };
  try {
    const next = withLock(`${file(runsDir, r.source)}.lock`, `Exception run ${r.source}`, () => {
      const cur = loadExceptionRun(runsDir, r.source);
      if (!cur) throw Object.assign(new Error(`No saved ${r.source} run`), { status: 404 });
      if (cur.runId !== r.runId) {
        throw Object.assign(new Error("The proposals were replaced by a newer run since this page was loaded. Reload and review the new proposal."), { status: 409, stale: true });
      }
      if (!cur.proposals.some((p) => p.caseId === r.caseId)) throw Object.assign(new Error("Unknown case"), { status: 404 });
      if (cur.reviews[r.caseId]) throw Object.assign(new Error(`Case ${r.caseId} was already reviewed`), { status: 409 });
      const review: ExceptionReview = { by: r.by, at: now.toISOString(), agrees: r.agrees, ...(r.comment ? { comment: r.comment } : {}) };
      const updated = { ...cur, reviews: { ...cur.reviews, [r.caseId]: review } };
      write(runsDir, updated);
      return updated;
    });
    return { status: 200, body: next };
  } catch (e) {
    const err = e as Error & { status?: number; stale?: boolean };
    return { status: err.status ?? 409, body: { error: err.message, ...(err.stale ? { stale: true } : {}) } };
  }
}
