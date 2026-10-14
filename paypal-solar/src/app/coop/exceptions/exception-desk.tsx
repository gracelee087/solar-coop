"use client";

import { useState } from "react";
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

function ProposalBox({ p, view }: { p: ExceptionProposal; view: CaseView }) {
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
      {p.evidence.length > 0 && (
        <div className={styles.evidence}>
          <span className={styles.evidenceLabel}>Based on:</span>
          {p.evidence.map((e) => (
            <EvidenceTag key={e} ref_={e} view={view} />
          ))}
        </div>
      )}
      {p.unverified.length > 0 && (
        <div className={styles.unverified}>
          <p>Still to confirm by a person</p>
          <ul>
            {p.unverified.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CaseCard({ view, p, review, reviewer, busy, onReview, synthetic, readOnly }: {
  view: CaseView;
  synthetic: boolean;
  readOnly: boolean;
  p: ExceptionProposal;
  review?: ExceptionReview;
  reviewer: string;
  busy: boolean;
  onReview: (caseId: string, agrees: boolean, comment?: string) => void;
}) {
  const [disagreeing, setDisagreeing] = useState(false);
  const [comment, setComment] = useState("");
  const can = !review && reviewer.trim() !== "" && !busy;
  return (
    <li id={view.caseId} className={styles.case}>
      <div className={styles.caseHead}>
        <div>
          <span className={styles.caseId}>{view.caseId}</span>
          <strong>{KIND[view.kind]}</strong>
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
      <ProposalBox p={p} view={view} />
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
    </li>
  );
}

export default function ExceptionDesk({ initial }: { initial: ExceptionRun }) {
  const [run, setRun] = useState(initial);
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

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
  return (
    <section className={styles.desk}>
      {synthetic && (
        <p className={styles.banner}>
          <strong>Synthetic evaluation cases.</strong> These exceptions are made-up test cases for evaluating proposals. They were not
          looked up in PayPal, and no real household is involved.
        </p>
      )}
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
      <div className={styles.runInfo}>
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
        {run.problems.length > 0 && <p className={styles.problems}>Problems: {run.problems.join("; ")}</p>}
      </div>
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
      <ul className={styles.cases}>
        {run.views.map((v) => (
          <CaseCard key={v.caseId} view={v} p={byCase.get(v.caseId)!} review={run.reviews[v.caseId]} reviewer={reviewer} busy={busy} onReview={onReview} synthetic={synthetic} readOnly={run.readOnly === true} />
        ))}
      </ul>
    </section>
  );
}
