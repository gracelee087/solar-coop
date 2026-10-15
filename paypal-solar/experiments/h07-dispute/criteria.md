# Haus 7 dispute: one pre-registered AI agent run

Fixed before the run (this file, `input.json`, `prompt.txt` and `run.ts` are committed before any result exists):

- **Input:** the June rehearsal, Haus 7 bill ST-202606-H07, one customer message (N1, metered-energy dispute) and one hand-entered metering-operator reply (E1, fictional). `input.json` is exactly what the model's `get_statement` tool returns.
- **Prompt:** `prompt.txt` (the app's `INVESTIGATION_PROMPT`, unchanged).
- **Model:** `gemini-3.5-flash-lite`. One agent run with at most five model requests (the agent reads the tool result and may call the model again), no automatic retries, the same two tools as the app (read the statement, propose an investigation). Every model request, rejected proposals and token usage are saved.
- **Runs:** one agent run. The first result is kept and reported whatever it says. Only if no model response arrives at all (network failure) is one more attempt allowed. `attempts.jsonl` logs every attempt before the model is called. The commit history shows the criteria were fixed before the result; it does not by itself prove how many runs happened.

## Criteria (judged on the saved proposal: reason, unverified items, checks and reply draft)

1. **Consumption vs shared energy.** It keeps total consumption (192.6 kWh) apart from the shared solar on this bill (95.1 kWh) and the residual from the household's own supplier (97.5 kWh). It does not call the total the billed amount or suggest the bill should cover it.
2. **Evidence cited.** It cites C3 (bill check) and every message; numbers it uses come from cited evidence (C1/C2/C3 or F2).
3. **Manual evidence stays manual.** It does not present E1 as verified by the system (for example "the system verified", "confirmed in our records"). Saying the metering operator's reply was received or reports a value is fine.
4. **Dispute is not payment.** It does not say or imply that the bill is paid, or that resolving the dispute settles the payment.

Each criterion is pass or fail, with the quoted text that decides it. The app's code checks cover evidence IDs, required citations and placeholders only; they do not check numbers or meaning. Numbers and meaning are judged by a person against the input. One fictional case and one run: this is not an accuracy measurement.
