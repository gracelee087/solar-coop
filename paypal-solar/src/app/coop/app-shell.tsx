import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./app-shell.module.css";

// Shared operator layout: fixed sidebar navigation, compact page header, full-width content.
export type ShellSection = "demo" | "desk" | "lab" | "energy";

const links: { key: ShellSection; href: string; label: string; hint: string }[] = [
  { key: "demo", href: "/coop/demo", label: "Try the demo", hint: "One dispute, end to end" },
  { key: "desk", href: "/coop?source=evidence", label: "Operator desk", hint: "Bills, payouts, cases" },
  { key: "lab", href: "/coop/exceptions", label: "Evaluation lab", hint: "AI agent vs fixed rules" },
  { key: "energy", href: "/energy", label: "Energy overview", hint: "Earlier prototype" },
];

export default function AppShell({
  active,
  writable,
  envLabel,
  eyebrow,
  title,
  lead,
  actions,
  children,
}: {
  active: ShellSection;
  /** Whether this page accepts operator writes (false on the hosted demo and on archived evidence). */
  writable: boolean;
  /** Overrides the environment badge (for example the public demo). */
  envLabel?: string;
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.app}>
      <aside className={styles.sidebar} aria-label="Main navigation">
        <Link className={styles.brand} href="/coop">
          <span className={styles.logo}>S</span>
          <span>
            Solar Co-op
            <small>Operator desk</small>
          </span>
        </Link>
        <nav className={styles.menu}>
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={l.key === active ? styles.active : undefined}
              aria-current={l.key === active ? "page" : undefined}
            >
              <strong>{l.label}</strong>
              <small>{l.hint}</small>
            </Link>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          <span className={writable ? styles.envLocal : styles.envReadOnly}>
            {envLabel ?? (writable ? "Local rehearsal" : "Read-only")}
          </span>
          <p>Code calculates. AI proposes. You review. PayPal processes (sandbox).</p>
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1>{title}</h1>
            {lead && <p className={styles.lead}>{lead}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
