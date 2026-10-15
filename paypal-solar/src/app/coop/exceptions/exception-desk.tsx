"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ExceptionReview, ExceptionRun } from "@/lib/coop/exception-desk";
import type { CaseView, ExceptionProposal } from "@/lib/coop/exceptions";
import styles from "./exceptions.module.css";

const time = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

const ACTION: Record<string, string> = {
  wait: "Wait, nothing to do yet",
  remind: "Send a PayPal reminder",
  contact_producer: "Contact the producer",
  cancel_unclaimed_payout: "Cancel the unclaimed payout and pay another way",
  check_provider: "Check the real result at PayPal first",
  escalate: "A person looks at it",
};

const KIND: Record<string, string> = {
  unpaid_bill: "Unpaid bill",
  unclaimed_payout: "Unclaimed payout",
  payout_problem: "Payout failed, returned or on hold",
  unknown_outcome: "Execution result unknown",
  refunded_after_payment: "Refunded after payment",
};

/** Per-case misses as saved with an evaluation run's score (the scorer stores them next to the totals). */
function savedMisses(score: ExceptionRun["score"], who: "agent" | "rules"): string[] | null {
  const misses = (score?.[who] as { misses?: unknown } | undefined)?.misses;
  return Array.isArray(misses) ? misses.filter((m): m is string => typeof m === "string") : null;
}

type Tone = "red" | "amber" | "green";

/** List colour, derived from the saved run only. */
function caseTone(p: ExceptionProposal, aiMissed: boolean | null): [Tone, string] {
  if (aiMissed) return ["red", "Differs from the frozen answer"];
  if (p.source === "default") return ["red", "No accepted proposal"];
  if (p.action === "escalate" || p.unverified.length > 0) return ["amber", "Needs a human decision"];
  return ["green", aiMissed === false ? "Matched the frozen answer" : "Nothing open to confirm"];
}

/** One evidence tag; pressing it shows the original text and whether it is a fact or an unverified claim. */
function EvidenceTag({ ref_, view }: { ref_: string; view: CaseView }) {
  const note = view.notes.find((n) => n.id === ref_);
  const label = note ? `Customer message ${note.id} · unverified` : ref_.includes(":") ? ref_.split(":")[0] : "PayPal rule";
  return (
    <details className={note ? `${styles.tag} ${styles.tagClaim}` : styles.tag}>
      <summary>{label}</summary>
      <div className={styles.tagBody}>
        <p>{note ? note.text : ref_}</p>
        <p>
          {note
            ? "Claim in a message. Not verified: it does not confirm a payment or any other fact."
            : "Fact written by code from the case data (a synthetic evaluation case here, not a PayPal lookup)."}
        </p>
      </div>
    </details>
  );
}

/** Secondary detail, collapsed by default (native details/summary, keyboard accessible). */
function More({ label, className, children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <details className={className ? `${styles.more} ${className}` : styles.more}>
      <summary>
        <span className={styles.chevron} aria-hidden="true">▸</span> {label}
      </summary>
      <div className={styles.moreBody}>{children}</div>
    </details>
  );
}

function ProposalBox({ p, view, extra }: { p: ExceptionProposal; view: CaseView; extra?: ReactNode }) {
  const badge =
    p.source === "agent"
      ? ["AI agent proposal · passed the code check (not a correctness check)", styles.badgeAgent]
      : p.source === "rule"
        ? ["Fixed rule result — not AI, messages not read", styles.badgeRule]
        : ["No accepted proposal — a person decides", styles.badgeNone];
  return (
    <div className={styles.proposal}>
      <span className={`${styles.badge} ${badge[1]}`}>{badge[0]}</span>
      <p className={styles.action}>{ACTION[p.action] ?? p.action}</p>
      <p className={styles.reason}>{p.reason}</p>
      {p.refused && <p className={styles.refused}>The agent&apos;s proposal was refused by the code check: {p.refused}</p>}
      <div className={styles.moreRow}>
        {p.evidence.length > 0 && (
          <More label={`Based on (${p.evidence.length})`}>
            <div className={styles.evidence}>
              <span className={styles.evidenceLabel}>Based on:</span>
              {p.evidence.map((e) => (
                <EvidenceTag key={e} ref_={e} view={view} />
              ))}
            </div>
          </More>
        )}
        {p.unverified.length > 0 && (
          <More label={`Still to confirm by a person (${p.unverified.length})`} className={styles.unverified}>
            <ul>
              {p.unverified.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </More>
        )}
        {extra}
      </div>
    </div>
  );
}

/** Next steps derived from the saved case and proposal fields by code; no model is asked. */
function Checklist({ view, p, review, readOnly, aiMissed, rulesMissed }: {
  view: CaseView;
  p: ExceptionProposal;
  review?: ExceptionReview;
  readOnly: boolean;
  aiMissed: boolean | null;
  rulesMissed: boolean | null;
}) {
  const items: [boolean, string][] = [
    [true, `${view.facts.length} facts written by code from the case data`],
    view.notes.length
      ? [false, `${view.notes.length} customer message${view.notes.length > 1 ? "s" : ""}: unverified claims, check before acting`]
      : [true, "No customer messages"],
    p.source === "agent"
      ? p.refused
        ? [false, "The agent's proposal was refused by the code check"]
        : [true, "Proposal passed the code check (allowed action, cited evidence exists) — not a correctness check"]
      : p.source === "rule"
        ? [true, "Fixed rule result from status, dates and counters — messages not read"]
        : [false, "No accepted proposal — a person decides"],
    p.unverified.length
      ? [false, `${p.unverified.length} item${p.unverified.length > 1 ? "s" : ""} still to confirm by a person`]
      : [true, "No open items listed in the proposal"],
  ];
  if (aiMissed !== null) items.push([!aiMissed, aiMissed ? "Saved AI agent action differs from the frozen answer" : "Saved AI agent action matches the frozen answer"]);
  if (rulesMissed !== null) {
    items.push([!rulesMissed, rulesMissed ? "Fixed rules differ from the frozen answer (they never read messages)" : "Fixed rules match the frozen answer"]);
  }
  items.push(
    review
      ? [true, `Review recorded by ${review.by} — no action taken`]
      : readOnly
        ? [true, "Saved evaluation output, read-only: no review is recorded here"]
        : [false, "Not reviewed yet"],
  );
  return (
    <More label="Checklist · computed by code, not AI" className={styles.checklist}>
      <ul>
        {items.map(([ok, text]) => (
          <li key={text} className={ok ? styles.checkOk : styles.checkOpen}>
            <span aria-hidden="true">{ok ? "✓" : "!"}</span>
            {text}
          </li>
        ))}
      </ul>
    </More>
  );
}

function CaseCard({ view, p, review, reviewer, busy, onReview, synthetic, readOnly, aiMissed, rulesMissed }: {
  view: CaseView;
  synthetic: boolean;
  readOnly: boolean;
  p: ExceptionProposal;
  review?: ExceptionReview;
  reviewer: string;
  busy: boolean;
  onReview: (caseId: string, agrees: boolean, comment?: string) => void;
  aiMissed: boolean | null;
  rulesMissed: boolean | null;
}) {
  const [disagreeing, setDisagreeing] = useState(false);
  const [comment, setComment] = useState("");
  const can = !review && reviewer.trim() !== "" && !busy;
  const guide =
    p.source === "agent" ? "AI guide · Saved AI agent output" : p.source === "rule" ? "Saved fixed-rule output · not AI" : "No accepted AI agent output";
  return (
    <article className={styles.case} aria-labelledby={`${view.caseId}-title`}>
      <div className={styles.caseHead}>
        <div>
          <span className={styles.caseId}>{view.caseId}</span>
          <strong id={`${view.caseId}-title`}>{KIND[view.kind]}</strong>
          <span className={styles.participant}>{view.participantId}</span>
        </div>
        <span className={styles.amount}>€{view.amountEur}</span>
      </div>
      <div className={styles.columns}>
        <div className={styles.facts}>
          <p className={styles.label}>
            {synthetic ? "Facts · synthetic case, written by code (not fetched from PayPal)" : "Facts · from PayPal and the ledger"}
          </p>
          <ul>
            {view.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
        <div className={styles.messages}>
          <p className={styles.label}>Messages · unverified claims</p>
          {view.notes.length ? (
            <ul>
              {view.notes.map((n) => (
                <li key={n.id}>
                  <span className={styles.noteId}>{n.id}</span>
                  {n.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No messages.</p>
          )}
        </div>
      </div>
      <section className={styles.guide} aria-label={guide}>
        <p className={`${styles.label} ${styles.guideLabel}`}>{guide}</p>
        <ProposalBox
          p={p}
          view={view}
          extra={<Checklist view={view} p={p} review={review} readOnly={readOnly} aiMissed={aiMissed} rulesMissed={rulesMissed} />}
        />
        {review ? (
          <p className={styles.reviewed}>
            Reviewed by {review.by}, {time(review.at)}: {review.agrees ? "agrees with the proposal" : "disagrees"}
            {review.comment && ` — ${review.comment.replace(/[.!?]+$/, "")}`}. <strong>No action taken:</strong> no reminder sent or held, no payment
            changed, PayPal status unchanged.
          </p>
        ) : readOnly ? (
          <p className={styles.footnote}>Saved evaluation output, read-only. Nothing is reviewed or sent from here.</p>
        ) : (
          <div className={styles.reviewActions}>
            <button disabled={!can} onClick={() => onReview(view.caseId, true)} className={styles.agree}>
              Agree
            </button>
            {disagreeing ? (
              <span className={styles.disagree}>
                <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} placeholder="What would you do instead?" />
                <button disabled={!can || !comment.trim()} onClick={() => onReview(view.caseId, false, comment)} className={styles.disagreeButton}>
                  Save disagreement
                </button>
              </span>
            ) : (
              <button disabled={!can} onClick={() => setDisagreeing(true)} className={styles.disagreeButton}>
                Disagree…
              </button>
            )}
            <span className={styles.footnote}>Records your review only; nothing is sent.</span>
          </div>
        )}
      </section>
    </article>
  );
}

/** Per case: did the saved AI agent action and the fixed rule action match the frozen answer? From the saved miss lists only. */
function MatchStrip({ views, ai, rules, selected, onSelect }: {
  views: CaseView[];
  ai: string[];
  rules: string[];
  selected: string;
  onSelect: (caseId: string) => void;
}) {
  const rows: [string, string[]][] = [
    ["AI agent · saved run", ai],
    ["Fixed rules · not AI", rules],
  ];
  return (
    <figure className={styles.strip}>
      <figcaption className={styles.label}>Per case · matched the frozen answer (✓ green) or not (✗ red)</figcaption>
      <div className={styles.stripScroll}>
        <table>
          <thead>
            <tr>
              <th scope="col"><span className={styles.srOnly}>Run</span></th>
              {views.map((v) => (
                <th key={v.caseId} scope="col" className={v.caseId === selected ? styles.stripSelected : undefined}>
                  {v.caseId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, misses]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {views.map((v) => {
                  const miss = misses.includes(v.caseId);
                  return (
                    <td key={v.caseId}>
                      <button
                        type="button"
                        className={`${styles.cell} ${miss ? styles.cellMiss : styles.cellMatch} ${v.caseId === selected ? styles.cellSelected : ""}`}
                        onClick={() => onSelect(v.caseId)}
                        aria-label={`${v.caseId}, ${name}: ${miss ? "differs from" : "matches"} the frozen answer`}
                      >
                        {miss ? "✗" : "✓"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <More label="Which cases differ" className={styles.stripNote}>
        <p>
          Differ: AI agent {ai.length ? ai.join(", ") : "none"} · fixed rules {rules.length ? rules.join(", ") : "none"}. From the per-case
          misses saved with this run; the frozen answers themselves are not part of the saved run.
        </p>
      </More>
    </figure>
  );
}

export default function ExceptionDesk({ initial }: { initial: ExceptionRun }) {
  const [run, setRun] = useState(initial);
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState(initial.views[0]?.caseId ?? "");

  // A #Y11 style link selects that case (on load and when the hash changes, e.g. "Jump to Y11").
  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!initial.views.some((v) => v.caseId === id)) return;
      setSelected(id);
      const detail = document.getElementById("case-detail");
      if (detail && detail.getBoundingClientRect().top > window.innerHeight - 160) detail.scrollIntoView({ block: "start" });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [initial.views]);

  function select(caseId: string) {
    setSelected(caseId);
    window.history.replaceState(null, "", `#${caseId}`);
  }

  async function onReview(caseId: string, agrees: boolean, comment?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/coop/exception-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: run.source, runId: run.runId, caseId, by: reviewer, agrees, ...(comment ? { comment } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Error ${res.status}`);
        setStale(body.stale === true);
      } else setRun(body as ExceptionRun);
    } catch {
      setError("Could not reach the server; nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  const byCase = new Map(run.proposals.map((p) => [p.caseId, p]));
  const synthetic = run.dataset === "synthetic_cases" || run.dataset === "synthetic_holdout";
  const aiMisses = savedMisses(run.score, "agent");
  const ruleMisses = savedMisses(run.score, "rules");
  const missed = (list: string[] | null, id: string) => (list ? list.includes(id) : null);
  const view = run.views.find((v) => v.caseId === selected) ?? run.views[0];
  return (
    <section className={styles.desk}>
      {synthetic && (
        <p className={styles.banner}>
          <strong>Synthetic evaluation cases.</strong> These exceptions are made-up test cases for evaluating proposals. They were not
          looked up in PayPal, and no real household is involved.
        </p>
      )}
      <div className={styles.overview}>
        {run.score && (
          <div className={styles.scores} aria-label="Evaluation score on team-authored cases">
            <article className={`${styles.score} ${styles.scoreAi}`}>
              <p>AI AGENT · SAVED RUN</p>
              <strong>{run.score.agent.correct}<small> / {run.score.agent.total}</small></strong>
              <span>Cases matching our frozen answers</span>
            </article>
            <article className={styles.score}>
              <p>FIXED RULES · NOT AI</p>
              <strong>{run.score.rules.correct}<small> / {run.score.rules.total}</small></strong>
              <span>Same cases; the rules never read messages</span>
            </article>
            <article className={styles.score}>
              <p>SCOPE · NOT A BENCHMARK</p>
              <strong>{run.score.agent.total}<small> cases · 1 run</small></strong>
              <span>Team-authored synthetic cases, answers and prompt</span>
            </article>
          </div>
        )}
        {aiMisses && ruleMisses ? (
          <MatchStrip views={run.views} ai={aiMisses} rules={ruleMisses} selected={view?.caseId ?? ""} onSelect={select} />
        ) : (
          <p className={styles.stripMissing}>
            {run.score
              ? "This saved run records totals only, no per-case results, so no per-case chart is shown."
              : "No per-case comparison with frozen answers in this saved run; it exists only for the team-authored cases."}
          </p>
        )}
      </div>
      <More
        className={styles.runInfo}
        label={
          <>
            {run.readOnly
              ? "One saved run · not an independent benchmark"
              : run.source === "agent"
                ? `AI agent run · saved ${time(run.savedAt)}`
                : `Fixed rules, not a model run · saved ${time(run.savedAt)}`}
            <span className={styles.moreHint}> · details</span>
          </>
        }
      >
        {run.source === "agent" ? (
          <p>
            <strong>AI agent run</strong>{run.readOnly ? "" : ` · run ${run.runId.slice(0, 8)}`}
            {run.model ? ` · ${run.model}` : ""} · saved {time(run.savedAt)}. The code check of each proposal covers: an allowed
            action, cited evidence that exists in the case, listed open items when a message is cited, and numbers that appear in
            the case. <strong>It does not check whether the reasoning is correct.</strong>
          </p>
        ) : (
          <p>
            <strong>Fixed rules, not a model run</strong> · run {run.runId.slice(0, 8)} · saved {time(run.savedAt)}. The rules read status, dates and counters;
            they never read messages.
          </p>
        )}
        {run.readOnly && (
          <p>
            <strong>Team-authored synthetic cases, read-only.</strong> Saved output of one real model run. We wrote the cases, the
            answers and the prompt, and revised the prompt after an earlier run on related cases.
            {run.score &&
              ` Matched the frozen answers in ${run.score.agent.correct}/${run.score.agent.total} cases; the fixed rules in ${run.score.rules.correct}/${run.score.rules.total}.`}{" "}
            Not an independent accuracy measure.
          </p>
        )}
      </More>
      {run.problems.length > 0 && <p className={`${styles.problems} ${styles.problemsLine}`}>Problems: {run.problems.join("; ")}</p>}
      {!run.readOnly && (
      <label className={styles.reviewer}>
        Your name
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={60} placeholder="Required to review" />
      </label>
      )}
      {error && (
        <p className={styles.error}>
          Not saved: {error}
          {stale && (
            <button onClick={() => window.location.reload()}>
              Reload the new proposals
            </button>
          )}
        </p>
      )}
      <div className={styles.master}>
        <nav className={styles.caseNav} aria-label="Cases">
          <ul className={styles.cases}>
            {run.views.map((v) => {
              const p = byCase.get(v.caseId)!;
              const [tone, status] = caseTone(p, missed(aiMisses, v.caseId));
              return (
                <li key={v.caseId}>
                  <button
                    type="button"
                    className={`${styles.caseItem} ${styles[tone]} ${v.caseId === view?.caseId ? styles.caseItemActive : ""}`}
                    aria-current={v.caseId === view?.caseId ? "true" : undefined}
                    onClick={() => select(v.caseId)}
                  >
                    <span className={styles.itemTop}>
                      <span className={styles.caseId}>{v.caseId}</span>
                      <span className={styles.itemAmount}>€{v.amountEur}</span>
                    </span>
                    <strong>{KIND[v.kind]}</strong>
                    <span className={styles.itemMeta}>
                      {v.participantId} · {status}
                      {missed(ruleMisses, v.caseId) && <span className={styles.ruleFlag}>Rules ✗</span>}
                      {run.reviews[v.caseId] && " · reviewed"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <More label="Colour key" className={styles.legend}>
            <p>
              <span className={styles.red}>Red</span> differs from the frozen answer or no accepted proposal ·{" "}
              <span className={styles.amber}>Amber</span> needs a human decision (a person looks at it, or open items) ·{" "}
              <span className={styles.green}>Green</span> {aiMisses ? "matched, nothing open" : "nothing open to confirm"}
            </p>
          </More>
        </nav>
        <div id="case-detail" className={styles.detail}>
          {view && (
            <CaseCard key={view.caseId} view={view} p={byCase.get(view.caseId)!} review={run.reviews[view.caseId]} reviewer={reviewer} busy={busy} onReview={onReview} synthetic={synthetic} readOnly={run.readOnly === true} aiMissed={missed(aiMisses, view.caseId)} rulesMissed={missed(ruleMisses, view.caseId)} />
          )}
        </div>
      </div>
    </section>
  );
}
