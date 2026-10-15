import path from "node:path";
import { loadExceptionRun, loadHoldoutRun } from "@/lib/coop/exception-desk";
import ExceptionDesk from "./exception-desk";
import { submissionHoldout } from "@/lib/coop/submission-evidence";
import AppShell from "../app-shell";
import styles from "./exceptions.module.css";

// Reads the saved exception run at request time; nothing here calls PayPal or Gemini.
export const dynamic = "force-dynamic";

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source: raw } = await searchParams;
  const source = raw === "rules" ? "rules" : raw === "agent" ? "agent" : "holdout";
  const runs = path.join(process.cwd(), "runs");
  const run = source === "holdout" ? loadHoldoutRun(runs) ?? submissionHoldout() : loadExceptionRun(runs, source);
  const tab = (key: string) => (source === key ? styles.tabActive : undefined);
  const writable = process.env.NODE_ENV !== "production" || process.env.ALLOW_COOP_DESK_DECISIONS === "true";
  return (
    <AppShell
      active="lab"
      writable={writable}
      eyebrow="Neighbourhood energy sharing · § 42c EnWG · prototype"
      title="Payment exceptions — the AI proposes, you decide"
      lead={
        <>
          Bills and payouts that did not end cleanly. Facts are written by code from the case data; messages are claims. A
          proposal is a suggestion: you decide, and nothing is sent from this page.
        </>
      }
    >
      <nav className={styles.tabs} aria-label="Exception runs">
        <a className={tab("holdout")} href="?source=holdout">Team-authored cases (read-only)</a>
        <a className={tab("agent")} href="?source=agent">AI agent run</a>
        <a className={tab("rules")} href="?source=rules">Fixed rules (not AI)</a>
        {source === "holdout" && <a href="#Y11">Jump to Y11</a>}
      </nav>
      {run ? (
        <ExceptionDesk initial={run} />
      ) : (
        <p className={styles.banner}>
          No saved {source === "agent" ? "AI agent" : source === "rules" ? "rule" : "team-authored case evaluation"} run yet. Run{" "}
          <code>npm run coop -- {source === "agent" ? "exceptions-run" : source === "rules" ? "exceptions-rules" : "exceptions-eval"}</code>
          {source === "agent" ? " locally with your own Gemini API key" : source === "rules" ? " locally (offline, no key)" : ""}.
          {source !== "holdout" && (
            <>
              {" "}The saved scores for the AI agent and the fixed rules are on the{" "}
              <a href="?source=holdout">Team-authored cases</a> tab.
            </>
          )}
        </p>
      )}
    </AppShell>
  );
}
