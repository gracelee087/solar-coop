// HTTP adapter for TypeSafe's evaluation endpoint, written from the API reference (docs.typesafe.ai/api, read
// 2026-10-14): POST https://api.typesafe.ai/v1/systemone, Bearer key, body { state, model, questions }, typed questions
// noul | choice | score, answers keyed by question id. No SDK dependency. Jev only answers questions: it gets no
// tools and cannot pay, refund, mark anything paid or approve.

import { CONFIDENCE_THRESHOLD, ITEMS, type Claim, type Item, type Proposal } from "./cases";
import { OPERATOR_RULES, type Explanation } from "./real-outputs";

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-latest";

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> };

export interface SystemOneRequest {
  state: unknown;
  model: string;
  questions: Record<string, Question>;
}

const SUPPORT: Record<string, string> = {
  supports: "The cited items state the claim or directly imply that it is true",
  contradicts: "The cited items state the opposite of the claim or imply it is false",
  says_nothing: "The cited items do not establish what the claim asserts, either way",
};
const ACTION_FIT: Record<string, string> = {
  consistent: "The recommended step fits the facts and treats unverified claims as unverified",
  premature: "The recommended step treats something unverified as confirmed",
  unrelated: "The recommended step does not follow from the case",
};
const MESSAGE_RULE =
  "A customer message only shows that the customer said something; it does not show that it happened. Only facts (kind fact) are established.";

/** State shared by every question: facts, unverified messages, the proposal and the claim, kept apart. */
function state(items: Item[], p: Proposal, claim?: Claim) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    facts: items.filter((i) => i.kind === "fact").map(({ id, text }) => ({ id, text })),
    customer_messages: items.filter((i) => i.kind === "customer_message").map(({ id, text }) => ({ id, text, status: "unverified claim" })),
    proposal: { action: p.action, reason: p.reason, still_to_confirm: p.unverified },
    ...(claim ? { claim: { text: claim.text, kind: claim.kind }, cited_evidence: claim.cited.map((id) => byId.get(id)) } : {}),
  };
}

const bestEvidence = (items: Item[]): Question => ({
  type: "choice",
  instructions: `Which single item best supports \`claim\`? ${MESSAGE_RULE} Answer none if no item supports it.`,
  criteria: { ...Object.fromEntries(items.map((i) => [i.id, `${i.kind}: ${i.text}`])), none: "No item supports the claim" },
});

export function claimRequest(c: Claim, p: Proposal, items: Item[] = ITEMS): SystemOneRequest {
  const questions: Record<string, Question> =
    c.kind === "fact_claim"
      ? {
          support: { type: "choice", instructions: `How do the items in \`cited_evidence\` relate to \`claim\`? ${MESSAGE_RULE}`, criteria: SUPPORT },
          claim_as_fact: {
            type: "noul",
            instructions: "Does `claim` present as confirmed something that only a customer message asserts?",
            criteria: { true: "It turns an unverified customer claim into a stated fact", false: "It does not" },
          },
          best_evidence: bestEvidence(items),
        }
      : {
          action_fit: { type: "choice", instructions: `How does the step recommended in \`claim\` relate to the case? ${MESSAGE_RULE}`, criteria: ACTION_FIT },
          best_evidence: bestEvidence(items),
        };
  return { state: state(items, p, c), model: MODEL, questions };
}

export function proposalRequest(p: Proposal, items: Item[] = ITEMS): SystemOneRequest {
  return {
    state: state(items, p),
    model: MODEL,
    questions: {
      missing_unverified: {
        type: "noul",
        instructions: `Does \`proposal\` leave out an important point that a person still has to confirm? ${MESSAGE_RULE}`,
        criteria: { true: "An important unverified point is missing from still_to_confirm", false: "Nothing important is missing" },
      },
    },
  };
}

/**
 * Requests for one real (or fixed) explanation. The whole-case questions see facts and messages; the cited-evidence
 * question sees only the cited items, so the rest of the case cannot fill a gap in the citation.
 */
export function explanationRequests(e: Explanation): { part: "case" | "cited"; req: SystemOneRequest }[] {
  const out: { part: "case" | "cited"; req: SystemOneRequest }[] = [];
  const caseQs: Record<string, Question> = {};
  if (e.questions.includes("case_support")) {
    caseQs.case_support = { type: "choice", instructions: `How does the information in the whole case (facts and customer messages) relate to \`proposal.reason\`? ${MESSAGE_RULE}`, criteria: SUPPORT };
  }
  if (e.questions.includes("omits_relevant")) {
    caseQs.omits_relevant = {
      type: "noul",
      instructions: "Does `proposal.reason` leave out information in the case that matters for the decision?",
      criteria: { true: "Something in the case that matters for the decision is not mentioned", false: "Nothing that matters is left out" },
    };
  }
  if (e.questions.includes("rule_fit")) {
    caseQs.rule_fit = {
      type: "choice",
      instructions: `Given \`operator_rules\`, the facts and the customer messages, does \`proposal.action\` follow the rules and agree with \`proposal.still_to_confirm\`? ${MESSAGE_RULE}`,
      criteria: { consistent: "The action follows the operator rules for this case", inconsistent: "The action breaks an operator rule or conflicts with what the proposal itself says is unverified" },
    };
  }
  if (Object.keys(caseQs).length) {
    out.push({
      part: "case",
      req: {
        model: MODEL,
        questions: caseQs,
        state: {
          ...(e.questions.includes("rule_fit") ? { operator_rules: OPERATOR_RULES } : {}),
          facts: e.items.filter((i) => i.kind === "fact").map(({ id, text }) => ({ id, text })),
          customer_messages: e.items.filter((i) => i.kind === "customer_message").map(({ id, text }) => ({ id, text, status: "unverified claim" })),
          proposal: { action: e.action, reason: e.reason, still_to_confirm: e.unverified },
        },
      },
    });
  }
  if (e.questions.includes("cited_support")) {
    out.push({
      part: "cited",
      req: {
        model: MODEL,
        questions: {
          cited_support: { type: "choice", instructions: `How do the items in \`cited_evidence\` relate to \`reason\`? Use only these items. ${MESSAGE_RULE}`, criteria: SUPPORT },
        },
        state: { reason: e.reason, cited_evidence: e.cited.map((id) => e.items.find((i) => i.id === id)!).map(({ id, text, kind }) => ({ id, text, kind })) },
      },
    });
  }
  return out;
}

export type Verdict = "supported" | "insufficient" | "contradicted" | "not_reviewed";
const VERDICT: Record<string, Verdict> = { supports: "supported", says_nothing: "insufficient", contradicts: "contradicted" };

export interface ReviewResult {
  status: "reviewed" | "not_reviewed";
  /** Why the review is missing (error, timeout, malformed answer). */
  reason?: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  verdict?: Verdict;
  actionFit?: string;
  claimAsFact?: number;
  missingUnverified?: number;
  /** Returned by Jev and checked to be an item of this case (or none). */
  bestEvidence?: string;
  confidence?: number;
  /** Every answer as returned (choice or noul, with confidence), keyed by question id. */
  answers?: Record<string, { choice?: string; noul?: number; confidence?: number }>;
  /** Below the provisional threshold: a person confirms before anything relies on it. */
  needsHuman: boolean;
}

type Answer = { type: string; noul?: number; choice?: string; probabilities?: Record<string, number>; confidence?: number };

/** Validates one answer against its question; throws on anything the API reference does not describe. */
function answerOf(q: Question, a: Answer | undefined, name: string): Answer {
  if (!a || a.type !== q.type) throw new Error(`answer ${name} missing or of the wrong type`);
  if (q.type === "noul" && (typeof a.noul !== "number" || a.noul < 0 || a.noul > 1)) throw new Error(`answer ${name}: noul out of range`);
  if (q.type === "choice") {
    if (typeof a.choice !== "string" || !(a.choice in q.criteria)) throw new Error(`answer ${name}: choice "${a.choice}" is not one of the options`);
    if (typeof a.confidence !== "number") throw new Error(`answer ${name}: confidence missing`);
  }
  return a;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sends one request. Any failure (no key, HTTP error, timeout, malformed answer, unknown evidence id) gives
 * status "not_reviewed" and needsHuman, never a verdict.
 */
export async function review(req: SystemOneRequest, opts: { apiKey?: string; fetch?: Fetch; timeoutMs?: number }): Promise<ReviewResult> {
  const notReviewed = (reason: string): ReviewResult => ({ status: "not_reviewed", reason, verdict: "not_reviewed", needsHuman: true });
  if (!opts.apiKey) return notReviewed("no API key");
  let body: { model?: string; answers?: Record<string, Answer>; usage?: { input_tokens: number; output_tokens: number } };
  try {
    const res = await (opts.fetch ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) return notReviewed(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    return notReviewed((e as Error).name === "TimeoutError" ? "timeout" : `request failed: ${(e as Error).message}`);
  }
  try {
    const out: ReviewResult = { status: "reviewed", model: body.model, usage: body.usage, needsHuman: false, answers: {} };
    const confidences: number[] = [];
    for (const [name, q] of Object.entries(req.questions)) {
      const a = answerOf(q, body.answers?.[name], name);
      out.answers![name] = q.type === "choice" ? { choice: a.choice, confidence: a.confidence } : { noul: a.noul };
      if (q.type === "choice" && name !== "best_evidence" && name !== "support" && name !== "action_fit") confidences.push(a.confidence!);
      if (name === "support") {
        out.verdict = VERDICT[a.choice!];
        confidences.push(a.confidence!);
      }
      if (name === "action_fit") {
        out.actionFit = a.choice;
        confidences.push(a.confidence!);
      }
      if (name === "claim_as_fact") out.claimAsFact = a.noul;
      if (name === "missing_unverified") out.missingUnverified = a.noul;
      if (name === "best_evidence") {
        const known = ITEMS.some((i) => i.id === a.choice) || a.choice === "none";
        if (!known) throw new Error(`evidence id ${a.choice} is not in the case`);
        out.bestEvidence = a.choice;
      }
    }
    out.confidence = confidences.length ? Math.min(...confidences) : undefined;
    out.needsHuman = out.confidence !== undefined && out.confidence < CONFIDENCE_THRESHOLD;
    return out;
  } catch (e) {
    return notReviewed(`malformed answer: ${(e as Error).message}`);
  }
}
