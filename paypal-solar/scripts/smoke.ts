// Smoke test: Gemini responds, and the model can list sandbox invoices through the PayPal toolkit.
import "./env";
import { generateText, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { paypalTools } from "../src/lib/paypal-tools";

const model = google(process.env.GEMINI_MODEL ?? "gemini-3.8-flash");

async function main() {
  const hello = await generateText({ model, prompt: "Reply with exactly: ok" });
  console.log("gemini:", hello.text.trim());

  const tools = paypalTools({ invoices: { list: true } });
  console.log("tools:", Object.keys(tools).join(", "));

  const res = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(3),
    prompt: "List my PayPal invoices and tell me how many there are.",
  });
  console.log("tool calls:", res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)).join(", ") || "(none)");
  console.log("answer:", res.text.trim());
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
