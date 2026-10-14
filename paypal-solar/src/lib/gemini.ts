import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * Free-tier daily quotas are counted per model (gemini-3.8-flash: 20 requests/day, measured 2026-10-12),
 * so models are tried in order and a model that returns a quota error is skipped for the rest of the process.
 */
const MODELS = (
  process.env.GEMINI_MODELS ??
  "gemini-3.5-flash-lite,gemini-3.7-flash,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemma-4-26b-a4b-it"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const exhausted = new Set<string>();

export async function withModelFallback<T>(run: (model: LanguageModel, name: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const name of MODELS) {
    if (exhausted.has(name)) continue;
    try {
      return await run(google(name), name);
    } catch (e) {
      lastError = e;
      if (String((e as Error).message).includes("quota")) exhausted.add(name);
    }
  }
  throw lastError ?? new Error("No Gemini model available");
}
