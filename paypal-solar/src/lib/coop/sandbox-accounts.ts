import { sandboxEmails } from "../demo-group";
import type { Participant } from "./types";

/**
 * Sandbox execution only: the sample households play existing PayPal sandbox personal accounts (fake test accounts,
 * no real money). There are three such accounts for ten households, so one account plays several households.
 */
const PERSONAL = [sandboxEmails.h1, sandboxEmails.h2, sandboxEmails.h3];

export function withSandboxEmails(participants: Participant[]): Participant[] {
  const producers = participants.filter((p) => p.role === "producer");
  const consumers = participants.filter((p) => p.role === "consumer");
  const email = new Map<string, string>([
    ...producers.map((p, i) => [p.id, PERSONAL[i % PERSONAL.length]] as [string, string]),
    ...consumers.map((c, i) => [c.id, PERSONAL[i % PERSONAL.length]] as [string, string]),
  ]);
  return participants.map((p) => ({ ...p, email: email.get(p.id)! }));
}
