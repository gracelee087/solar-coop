import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { loadWorkbench, workbenchAction } from "./workbench";
import { seedWorkbench } from "./workbench-seed";
import type { WorkbenchView } from "./workbench-types";

/**
 * Public demo: each visitor gets their own offline rehearsal in a temporary folder, keyed by a random cookie.
 * Only case actions are allowed. There is no payment approval or execution and no model call; a saved AI proposal
 * is shown only when the case equals its recorded input. Folders are temporary and disappear on a server restart.
 */
export const DEMO_COOKIE = "solar_demo";
export const DEMO_PERIOD = "2026-06";
export const DEMO_DRAFT = "bill-ST-202606-H07";
export const DEMO_OPERATOR = "Demo operator";
export const DEMO_MESSAGE = "My meter shows about 193 kWh for 2026-06, but your bill says 95.1 kWh. Which one is right? Reference ST-202606-H07.";
export const DEMO_LIMITS = { sessions: 200, actions: 60, ttlMs: 24 * 60 * 60 * 1000 };

const sessionId = z.string().regex(/^[a-f0-9]{32}$/);
const caseAction = z.object({
  action: z.enum(["message", "prepare", "review", "evidence", "hold", "explain", "confirm", "close"]),
  version: z.string().length(64),
  text: z.string().trim().max(600).optional(),
  hold: z.enum(["external", "correction"]).optional(),
  origin: z.enum(["metering_operator", "grid_operator", "paypal", "customer", "internal"]).optional(),
  reference: z.string().trim().max(80).optional(),
}).strict();

export const demoBase = () => process.env.COOP_DEMO_DIR ?? path.join(os.tmpdir(), "solar-coop-demo");
const dirOf = (base: string, id: string) => path.join(base, sessionId.parse(id));
const runsOf = (base: string, id: string) => path.join(dirOf(base, id), "runs");
const countFile = (base: string, id: string) => path.join(dirOf(base, id), "actions.json");

/** Removes expired sessions, then the oldest ones while over the session limit. */
function prune(base: string, now: number) {
  if (!existsSync(base)) return;
  const dirs = readdirSync(base).filter((d) => sessionId.safeParse(d).success)
    .map((d) => ({ d, t: statSync(path.join(base, d)).mtimeMs })).sort((a, b) => a.t - b.t);
  for (const x of dirs) if (now - x.t > DEMO_LIMITS.ttlMs) rmSync(path.join(base, x.d), { recursive: true, force: true });
  const left = dirs.filter((x) => now - x.t <= DEMO_LIMITS.ttlMs);
  for (const x of left.slice(0, Math.max(0, left.length - DEMO_LIMITS.sessions + 1))) rmSync(path.join(base, x.d), { recursive: true, force: true });
}

/** Starts (or resets) a visitor's demo: a fresh June rehearsal with the Haus 7 customer message attached. */
export async function startDemo(root: string, base: string, existing?: string, now = new Date()): Promise<{ id: string; view: WorkbenchView }> {
  const id = existing && sessionId.safeParse(existing).success ? existing : randomBytes(16).toString("hex");
  rmSync(dirOf(base, id), { recursive: true, force: true });
  prune(base, now.getTime());
  mkdirSync(dirOf(base, id), { recursive: true });
  const runs = runsOf(base, id);
  const seeded = await seedWorkbench(root, runs);
  const item = seeded.items.find((i) => i.draftId === DEMO_DRAFT)!;
  const view = workbenchAction(runs, { period: DEMO_PERIOD, source: "rehearsal", draftId: DEMO_DRAFT, action: "message", topic: "meter", by: DEMO_OPERATOR, text: DEMO_MESSAGE, version: item.version }, now, root);
  writeFileSync(countFile(base, id), "0");
  return { id, view };
}

export function loadDemo(root: string, base: string, id: string | undefined): WorkbenchView | null {
  if (!id || !sessionId.safeParse(id).success || !existsSync(runsOf(base, id))) return null;
  return loadWorkbench(runsOf(base, id), DEMO_PERIOD, "rehearsal", root);
}

/** One case action on the visitor's Haus 7 statement. The operator name is fixed; nothing else can be targeted. */
export function demoAction(root: string, base: string, id: string | undefined, body: unknown, now = new Date()): WorkbenchView {
  if (!id || !sessionId.safeParse(id).success || !existsSync(runsOf(base, id))) throw new Error("Your demo has expired. Start it again.");
  const b = caseAction.parse(body);
  const used = Number(readFileSync(countFile(base, id), "utf8")) || 0;
  if (used >= DEMO_LIMITS.actions) throw new Error("This demo has reached its action limit. Reset it to start again.");
  const view = workbenchAction(runsOf(base, id), { ...b, period: DEMO_PERIOD, source: "rehearsal", draftId: DEMO_DRAFT, by: DEMO_OPERATOR }, now, root);
  writeFileSync(countFile(base, id), String(used + 1));
  return view;
}
