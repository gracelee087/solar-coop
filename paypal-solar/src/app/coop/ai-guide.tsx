import Link from "next/link";
import type { MouseEvent } from "react";
import { nextSteps } from "../../lib/coop/house-status";
import type { DeskSource } from "@/lib/coop/desk";
import type { WorkItem } from "@/lib/coop/workbench-types";
import styles from "./workbench.module.css";

/** Jumping to a collapsed record opens it first. */
const openTarget = (e: MouseEvent<HTMLAnchorElement>) => {
  const target = document.getElementById(e.currentTarget.hash.slice(1));
  if (target instanceof HTMLDetailsElement) target.open = true;
};

/** Saved AI agent output for one statement, a code-computed checklist and links to the records. No live model call. */
export default function AiGuide({ item, source, model }: { item: WorkItem; source: DeskSource; model: string | null }) {
  const note = source !== "rehearsal" && item.summarySource === "agent";
  const proposal = item.work.proposal?.source === "agent" ? item.work.proposal : undefined;
  const steps = nextSteps(item);
  const open = steps.filter((s) => !s.done);
  const saved = proposal
    ? `AI proposal saved · ${proposal.model}`
    : note
      ? `AI note saved${model ? ` · ${model}` : ""}`
      : item.noteRejected
        ? "The agent's note was rejected by the code check"
        : "No AI agent output saved for this statement.";
  return (
    <aside className={styles.guide} aria-label={`AI guide for ${item.name}`}>
      <div className={styles.guideHead}>
        <h2>AI guide</h2>
        <span>{item.name}</span>
      </div>
      <p className={styles.savedLine}>
        <span>Saved AI agent output</span> {saved}
      </p>
      <section className={styles.guideBlock}>
        <h3>
          Next step <span className={styles.codeBadge}>Checklist · computed by code, not AI</span>
        </h3>
        <ul className={styles.checklist}>
          {steps.map((s, i) => (
            <li key={i} className={s.done ? styles.done : styles.todo}>
              <span aria-hidden="true">{s.done ? "✓" : "○"}</span>
              <span>
                {s.text}
                <span className={styles.srOnly}>{s.done ? " (done)" : " (to do)"}</span>
              </span>
            </li>
          ))}
        </ul>
        {!open.length && <p className={styles.small}>Nothing open for this statement.</p>}
      </section>
      {(note || proposal || item.noteRejected || item.work.proposal) && (
        <details className={styles.fold}>
          <summary>Full AI output and caveats</summary>
          <p className={styles.small}>Recorded · no live call.</p>
          {note && (
            <div className={styles.aiNote}>
              <span>AI NOTE{model ? ` · ${model}` : ""}</span>
              <p>{item.summary}</p>
              <small>AI note · numbers checked; meaning still needs review.</small>
            </div>
          )}
          {item.noteRejected && (
            <p className={styles.warning}>
              The agent&apos;s note was rejected by the code check ({item.noteRejected}). The summary shown is prepared by code.
            </p>
          )}
          {proposal && (
            <div className={styles.aiNote}>
              <span>AI PROPOSAL · {proposal.model}</span>
              <p>{proposal.reason}</p>
              {item.proposalStale && <p className={styles.warning}>The statement or messages changed since this proposal.</p>}
              <small>
                {proposal.model} · Evidence IDs were checked. This does not guarantee the explanation is correct.
              </small>
            </div>
          )}
          {item.work.proposal?.source === "template" && (
            <p className={styles.small}>An offline investigation exists as a code template (not AI). See it in the statement.</p>
          )}
        </details>
      )}
      <details className={styles.fold}>
        <summary>Evidence and records</summary>
        <nav className={styles.evidenceLinks} aria-label="Jump to records">
          {item.chain && <a href="#stmt-check">Bill check</a>}
          <a href="#stmt-settlement" onClick={openTarget}>Settlement</a>
          <a href="#stmt-evidence" onClick={openTarget}>Payment evidence</a>
          <a href="#stmt-messages">Customer messages</a>
          {item.work.proposal && <a href="#stmt-investigation">Investigation</a>}
          {!!item.work.history.length && <a href="#stmt-history" onClick={openTarget}>Case timeline</a>}
          <Link href="/coop/exceptions?source=holdout">Saved model evaluation</Link>
        </nav>
        <div className={styles.evidenceTags}>
          {item.evidence.map((e) => (
            <details key={e.id}>
              <summary>
                {e.id} · {e.kind === "claim" ? "Claim" : e.kind === "manual" ? "Manual entry" : "Fact"}
              </summary>
              <p>{e.text}</p>
            </details>
          ))}
        </div>
      </details>
    </aside>
  );
}
