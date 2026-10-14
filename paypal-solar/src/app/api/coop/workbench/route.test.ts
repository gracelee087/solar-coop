import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
afterEach(() => vi.unstubAllEnvs());
it("blocks production mutations without authentication protection", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ALLOW_COOP_DESK_DECISIONS", "");
  expect((await POST(new Request("http://localhost/api/coop/workbench", { method: "POST", body: '{"action":"start_rehearsal"}' }))).status).toBe(403);
});
it("refuses cross-origin writes and invalid request data locally", async () => {
  vi.stubEnv("NODE_ENV", "development");
  expect((await POST(new Request("http://localhost/api/coop/workbench", { method: "POST", headers: { Origin: "https://example.com" }, body: "{}" }))).status).toBe(403);
  expect((await POST(new Request("http://localhost/api/coop/workbench", { method: "POST", headers: { Origin: "null" }, body: "{}" }))).status).toBe(403);
  // Opened at 127.0.0.1: the browser's Origin matches the Host header although request.url says localhost.
  expect((await POST(new Request("http://localhost:3007/api/coop/workbench", { method: "POST", headers: { Origin: "http://127.0.0.1:3007", Host: "127.0.0.1:3007" }, body: "{}" }))).status).toBe(400);
  expect((await POST(new Request("http://localhost:3007/api/coop/workbench", { method: "POST", headers: { Origin: "http://evil.test", Host: "127.0.0.1:3007" }, body: "{}" }))).status).toBe(403);
  expect((await POST(new Request("http://localhost/api/coop/workbench", { method: "POST", body: "{" }))).status).toBe(400);
  expect((await POST(new Request("http://localhost/api/coop/workbench", { method: "POST", body: "{}" }))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/coop/workbench?period=../../other"))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/coop/workbench?source=holdout"))).status).toBe(400);
});
