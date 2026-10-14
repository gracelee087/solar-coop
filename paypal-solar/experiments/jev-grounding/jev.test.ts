// Adapter tests with mocked HTTP responses. They check request shape and result handling only; passing them says
// nothing about how well Jev reviews explanations.
import { describe, expect, it, vi } from "vitest";
import { CLAIMS, ITEMS, PROPOSALS } from "./cases";
import { claimRequest, ENDPOINT, proposalRequest, review, type Fetch } from "./jev";

const claim = (id: string) => CLAIMS.find((c) => c.id === id)!;
const proposalOf = (id: string) => PROPOSALS.find((p) => p.id === claim(id).proposalId)!;
const reply = (answers: object, status = 200): Fetch =>
  vi.fn(async () => new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 900, output_tokens: 30 } }), { status }));
const choice = (c: string, confidence = 0.95) => ({ type: "choice", choice: c, probabilities: { [c]: confidence }, confidence });

describe("Jev request (docs.typesafe.ai/api)", () => {
  it("keeps facts, unverified messages, the proposal and the claim apart, and asks typed questions only", () => {
    const req = claimRequest(claim("B"), proposalOf("B"));
    const s = req.state as Record<string, unknown>;
    expect(req.model).toBe("jev-latest");
    expect(Object.keys(s)).toEqual(["facts", "customer_messages", "proposal", "claim", "cited_evidence"]);
    expect(s.customer_messages).toEqual([{ id: "N1", text: ITEMS.find((i) => i.id === "N1")!.text, status: "unverified claim" }]);
    expect(Object.keys(req.questions)).toEqual(["support", "claim_as_fact", "best_evidence"]);
    expect(Object.keys((req.questions.best_evidence as { criteria: object }).criteria)).toEqual([...ITEMS.map((i) => i.id), "none"]);
    expect(Object.keys(claimRequest(claim("D"), proposalOf("D")).questions)).toEqual(["action_fit", "best_evidence"]);
    expect(Object.keys(proposalRequest(PROPOSALS[1]).questions)).toEqual(["missing_unverified"]);
  });

  it("posts to the documented endpoint with a Bearer key", async () => {
    const f = reply({ support: choice("supports"), claim_as_fact: { type: "noul", noul: 0.1 }, best_evidence: choice("N1") });
    await review(claimRequest(claim("A"), proposalOf("A")), { apiKey: "k", fetch: f });
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.headers).toMatchObject({ Authorization: "Bearer k", "Content-Type": "application/json" });
  });
});

describe("Jev result handling (mock responses)", () => {
  const reqB = () => claimRequest(claim("B"), proposalOf("B"));

  it("maps the three relations to supported / insufficient / contradicted and keeps the evidence id", async () => {
    for (const [c, v] of [["supports", "supported"], ["says_nothing", "insufficient"], ["contradicts", "contradicted"]]) {
      const r = await review(reqB(), { apiKey: "k", fetch: reply({ support: choice(c), claim_as_fact: { type: "noul", noul: 0.9 }, best_evidence: choice("N1") }) });
      expect(r).toMatchObject({ status: "reviewed", verdict: v, bestEvidence: "N1", claimAsFact: 0.9, needsHuman: false, model: "jev-1.13.0" });
    }
  });

  it("sends a confident-looking answer below the provisional threshold to a person", async () => {
    const r = await review(reqB(), { apiKey: "k", fetch: reply({ support: choice("supports", 0.6), claim_as_fact: { type: "noul", noul: 0.2 }, best_evidence: choice("N1") }) });
    expect(r).toMatchObject({ verdict: "supported", confidence: 0.6, needsHuman: true });
  });

  it("marks errors, timeouts, a missing key and malformed answers as not reviewed", async () => {
    const ok = { support: choice("supports"), claim_as_fact: { type: "noul", noul: 0.2 }, best_evidence: choice("N1") };
    const cases: [string, Parameters<typeof review>[1]][] = [
      ["HTTP 429", { apiKey: "k", fetch: reply({}, 429) }],
      ["HTTP 529", { apiKey: "k", fetch: reply({}, 529) }],
      ["timeout", { apiKey: "k", fetch: vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) }],
      ["no API key", { fetch: reply(ok) }],
      ["is not one of the options", { apiKey: "k", fetch: reply({ ...ok, best_evidence: choice("N9") }) }],
      ["missing or of the wrong type", { apiKey: "k", fetch: reply({ support: choice("supports") }) }],
    ];
    for (const [why, opts] of cases) {
      const r = await review(reqB(), opts);
      expect(r).toMatchObject({ status: "not_reviewed", verdict: "not_reviewed", needsHuman: true });
      expect(r.reason).toContain(why);
    }
  });
});

describe("experiment cases", () => {
  it("cite only items that exist in X04, and freeze an expected answer for every claim", () => {
    const ids = new Set(ITEMS.map((i) => i.id));
    for (const c of CLAIMS) {
      for (const id of c.cited) expect(ids.has(id)).toBe(true);
      expect(c.kind === "fact_claim" ? c.expected.support : c.expected.actionFit).toBeDefined();
    }
    expect(CLAIMS.map((c) => c.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
});
