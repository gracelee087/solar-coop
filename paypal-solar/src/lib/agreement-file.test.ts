import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Agreement } from "./agreement";
import { saveAgreementToFile } from "./agreement-file";

const dir = mkdtempSync(path.join(tmpdir(), "paypal-solar-agreements-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const agreement = (key: string, priceCt: number) => ({ settlementKey: key, priceCt, agreedAt: "2026-10-13T10:00:00Z" }) as Agreement;
const fresh = (name: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify({ note: "n", agreements: {} }));
  return file;
};
const stored = (file: string) => JSON.parse(readFileSync(file, "utf8")).agreements;

describe("saveAgreementToFile", () => {
  it("saves a new key and keeps the file's other fields", () => {
    const file = fresh("a.json");
    expect(saveAgreementToFile(file, agreement("K1", 13.31))).toEqual({ saved: true });
    expect(stored(file).K1.priceCt).toBe(13.31);
    expect(JSON.parse(readFileSync(file, "utf8")).note).toBe("n");
  });

  it("refuses a later save of the same key, even from a run that checked before the first save", () => {
    const file = fresh("b.json");
    // Both runs checked an empty file earlier; the first one saves, the late one must not overwrite it.
    expect(saveAgreementToFile(file, agreement("K1", 13.31))).toEqual({ saved: true });
    const late = saveAgreementToFile(file, agreement("K1", 13.7));
    expect(late.saved).toBe(false);
    expect(stored(file).K1.priceCt).toBe(13.31);
  });

  it("does not write while another save holds the lock", () => {
    const file = fresh("c.json");
    writeFileSync(`${file}.lock`, "");
    expect(saveAgreementToFile(file, agreement("K1", 12))).toEqual({ saved: false, error: `another save is in progress (${file}.lock exists)` });
    expect(stored(file)).toEqual({});
  });
});
