# Actual local-model development runs — 2026-10-14 Europe/Berlin

Synthetic German correction; three candidate invoices; no external model/payment calls.
Local files use UTC timestamps (2026-10-13T22:xx), which are 2026-10-14 in Berlin.

| Run | Model | Machine inference | Result | Simulated refund requests |
|---|---|---:|---|---:|
| Final correction | gemma4:e4b | 109.655 s | Source-grounded extraction, EUR 2 refund, independent completion, zero difference | 1 |
| Draft correction | gemma4:e4b | 88.626 s | `final=false`; needs review | 0 |
| Faster model trial after schema update | gemma3:4b | 28.392 s | Invented final-status quote rejected | 0 |

The default remains gemma4:e4b. The schema and prompt were developed using the sample; these two successful runs are NOT
a held-out accuracy benchmark. The model is not proven superior to rules or another extraction system.
The quote check only establishes that a substring exists; it cannot prove a document is genuine or correctly interpreted.

Before these runs, a gemma3:4b attempt returned `quotes` as a string and failed schema validation.
After structured schema output was added, a second attempt returned `quotes.final="true"` which was absent from the source.
That raw output is preserved in `earlier-ungrounded-output.json` (23.194 s). The first schema-invalid response was not captured,
so only its observed validation failure is recorded here; it is not silently counted as a success.
After quote descriptions were improved, the later 28.392 s gemma3 attempt still failed the source check.

`final-*` and `draft-*` include frozen inputs/prompt/schema, raw local-model output and full event records.
Approval in CLI runs was scripted for simulation, not performed by a human. The recorded `humanElapsedMs` is null.
No participant timing or time-saving percentage has been measured. The UI contains a separate manual exercise for that purpose.
No live/sandbox PayPal refund was executed and existing invoice IDs have not been validated as capture IDs.

The new API's nine tests use a mock extractor, explicitly named `test_mock`; they do not add nine real AI observations.
The browser tool rejected opening the local demo, so no visual/click-through pass is claimed.
