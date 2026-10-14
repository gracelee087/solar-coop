import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

const req = () => new Request("http://x/api/coop/decision", { method: "POST", body: "{}" });

it("refuses decisions in a production build unless explicitly allowed", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALLOW_COOP_DESK_DECISIONS", "");
  expect((await POST(req())).status).toBe(403);
  vi.stubEnv("ALLOW_COOP_DESK_DECISIONS", "true");
  expect((await POST(req())).status).toBe(400); // passes the guard; the empty body is then rejected
});

it("accepts decisions in local development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  expect((await POST(req())).status).toBe(400);
});
