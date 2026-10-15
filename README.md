# Solar Co-op — PayPal AI Hackathon

An operator desk for community energy bills, producer payouts and payment exception review.

**Live demo (read-only, no login):** https://solar-coop.onrender.com/coop?source=evidence. It runs on the Render free tier, so the first request after 15 minutes of inactivity can take about a minute to wake up. Writes are disabled there; the interactive rehearsal runs locally.

**Start with [paypal-solar/README.md](paypal-solar/README.md).** The application is in `paypal-solar/`; the main judge route is `/coop?source=evidence`.

- [Judge walkthrough](paypal-solar/docs/JUDGE_GUIDE.md)
- [English submission draft](paypal-solar/docs/SUBMISSION.md)
- [Verification status](paypal-solar/docs/VERIFICATION.md)

The historical Python `core/` and assistant instruction files are not application setup requirements. The submission packaging command excludes them, along with credentials, dependencies, local runtime state and unverified external account data.

## Data and credits

- PV generation: PVGIS © European Communities, 2001-2026 (PVGIS 5.3, European Commission Joint Research Centre). Committed files: `paypal-solar/src/data/pvgis-*.json`.
- Household load: BDEW representative profile H25. Not redistributed; downloaded by `npm run fetch-data:h25`.
- Hosting: Render (free web service), configured by `render.yaml`.
- Demo video narration: generated locally with Kokoro-82M (hexgrad, Apache-2.0) via kokoro-onnx (MIT). Video typefaces: DM Sans and Cormorant Garamond, SIL Open Font License 1.1. The web app uses system fonts only.
