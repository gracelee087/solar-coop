import { createHash } from "node:crypto";

export type EvidenceKind = "agreement" | "usage" | "calculation" | "invoice_record" | "paypal_invoice" | "payment" | "supplier_bill" | "tax_assessment" | "customer_refund" | "tax_refund";
export type EvidenceStatus = "checked" | "missing" | "mismatch" | "pending" | "not_connected";
export interface EvidenceTag {
  id: string;
  caseId: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  source: string;
  environment: "local_record" | "modelled" | "simulated" | "paypal_sandbox" | "unconnected";
  observedAt: string;
  /** SHA-256 of the attached JSON snapshot, not a digital signature or proof of source authenticity. */
  sha256: string;
  snapshot: unknown;
  note: string;
  dependsOn: string[];
}

export function evidenceDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function tagIdentity(tag: Omit<EvidenceTag, "id">): string {
  return evidenceDigest({ caseId: tag.caseId, kind: tag.kind, status: tag.status, source: tag.source, environment: tag.environment,
    observedAt: tag.observedAt, sha256: tag.sha256, note: tag.note, dependsOn: tag.dependsOn });
}

/** Only trusted collectors call this function. There is no model tool to create or mark evidence checked. */
export function evidenceTag(input: Omit<EvidenceTag, "id" | "sha256" | "dependsOn"> & { dependsOn?: string[] }): EvidenceTag {
  const sha256 = evidenceDigest(input.snapshot);
  const { dependsOn = [], ...fields } = input;
  const id = tagIdentity({ ...fields, sha256, dependsOn });
  return { ...structuredClone(fields), dependsOn: [...dependsOn], sha256, id };
}

export function missingEvidence(caseId: string, observedAt: string): EvidenceTag[] {
  const slots: [EvidenceKind, string, EvidenceStatus][] = [
    ["agreement", "Saved agreement has not been collected", "missing"],
    ["usage", "Validated modelled usage has not been collected", "missing"],
    ["calculation", "Bill calculation has not been collected", "missing"],
    ["paypal_invoice", "Invoice response has not been retrieved", "missing"],
    ["payment", "Payment has not been verified", "missing"],
    ["supplier_bill", "Supplier/grid invoice connector is not implemented", "not_connected"],
    ["tax_assessment", "Tax filing/payment evidence is not connected; cost estimates are not tax receipts", "not_connected"],
    ["customer_refund", "Refund eligibility and execution are not implemented; no claim that a refund is due", "not_connected"],
    ["tax_refund", "Tax refund eligibility, application and receipt are not connected", "not_connected"],
  ];
  return slots.map(([kind, note, status]) => evidenceTag({ caseId, kind, status, note, source: "Not collected", environment: "unconnected", observedAt, snapshot: null }));
}

export function latestEvidence(tags: EvidenceTag[], kind: EvidenceKind) {
  return [...tags].reverse().find((tag) => tag.kind === kind);
}

/** A missing or modified artifact cannot authorize a bill or a paid result. */
export function evidenceProblems(caseId: string, tags: EvidenceTag[], required: EvidenceKind[]): string[] {
  return required.flatMap((kind) => {
    const tag = latestEvidence(tags, kind);
    if (!tag || tag.status !== "checked") return [`Evidence ${kind} is not checked`];
    if (tag.caseId !== caseId || tag.sha256 !== evidenceDigest(tag.snapshot) || tag.id !== tagIdentity(tag)) return [`Evidence ${kind} has a different case or altered snapshot/metadata`];
    if (tag.dependsOn.some((id) => !tags.some((parent) => parent.id === id && parent.caseId === caseId && parent.id === tagIdentity(parent) && parent.sha256 === evidenceDigest(parent.snapshot)))) return [`Evidence ${kind} has a missing or altered dependency`];
    return [];
  });
}
