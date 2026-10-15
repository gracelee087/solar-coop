import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as workbenchPOST } from "../workbench/route";
import { GET, POST } from "./route";

vi.setConfig({ testTimeout: 20_000 });
let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "coop-demo-route-")); vi.stubEnv("COOP_DEMO_DIR", dir); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

it("runs the public demo in production while operator writes stay blocked", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ALLOW_COOP_DESK_DECISIONS", "");
  const start = await POST(new Request("http://localhost/api/coop/demo", { method: "POST", body: '{"action":"start"}' }));
  expect(start.status).toBe(200);
  const cookie = start.headers.get("set-cookie")!;
  expect(cookie).toMatch(/^solar_demo=[a-f0-9]{32}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure$/);
  const session = cookie.split(";")[0];
  const view = await (await GET(new Request("http://localhost/api/coop/demo", { headers: { cookie: session } }))).json();
  const h7 = view.items.find((i: { draftId: string }) => i.draftId === "bill-ST-202606-H07");
  const prepared = await POST(new Request("http://localhost/api/coop/demo", { method: "POST", headers: { cookie: session }, body: JSON.stringify({ action: "prepare", version: h7.version }) }));
  expect(prepared.status).toBe(200);
  expect((await workbenchPOST(new Request("http://localhost/api/coop/workbench", { method: "POST", body: '{"action":"start_rehearsal"}' }))).status).toBe(403);
});

it("refuses cross-origin, oversized, invalid and session-less requests", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(new Request("http://localhost/api/coop/demo", { method: "POST", headers: { Origin: "https://evil.test" }, body: '{"action":"start"}' }))).status).toBe(403);
  expect((await POST(new Request("http://localhost/api/coop/demo", { method: "POST", body: "x".repeat(5000) }))).status).toBe(413);
  expect((await POST(new Request("http://localhost/api/coop/demo", { method: "POST", body: "{" }))).status).toBe(400);
  expect((await POST(new Request("http://localhost/api/coop/demo", { method: "POST", body: JSON.stringify({ action: "prepare", version: "x".repeat(64) }) }))).status).toBe(409);
  expect((await GET(new Request("http://localhost/api/coop/demo"))).status).toBe(404);
});
