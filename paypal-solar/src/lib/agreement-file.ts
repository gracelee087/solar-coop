import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { addAgreement, type Agreement, type AgreementStore } from "./agreement";

/**
 * Saves one agreement into the agreements file without ever replacing a saved one. The file is read again under
 * an exclusive lock right before writing: a check made earlier (e.g. before a long negotiation) is not enough,
 * because another run may have saved the same key meanwhile. That happened once: a stopped run kept going and
 * wrote over an agreement saved by a later run.
 */
export function saveAgreementToFile(file: string, a: Agreement): { saved: true } | { saved: false; error: string } {
  const lock = `${file}.lock`;
  let fd: number;
  try {
    fd = openSync(lock, "wx");
  } catch {
    return { saved: false, error: `another save is in progress (${lock} exists)` };
  }
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { note?: string; agreements: AgreementStore };
    const added = addAgreement(data.agreements, a);
    if ("error" in added) return { saved: false, error: added.error };
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...data, agreements: added.store }, null, 2) + "\n");
    renameSync(tmp, file);
    return { saved: true };
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
