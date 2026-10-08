# Kural (குரல்): an adaptive English tutor for Tamil speakers

When a learner gets an answer wrong, a typical tutor records "doesn't know." Kural checks **why** the answer failed.
It reads passive typing signals: latency, pauses, deletions, disfluency, hedges like *puriyala* / *solla theriyala*, and switches into Tamil.
It works out what is blocking the learner, then changes the **communication channel** (not the task).
Once the learner recovers, it removes that support again.

```
Observe → Estimate load → Diagnose bottleneck → Adapt mode → Re-check English → Update learner model
```

## Run

```bash
npm install
npm start               # http://localhost:5173
npm test                # headless run of the 3 demo learners + assertions
```

Demo links (autoplay): `/?demo=kavya&speed=16`, `/?demo=arun&view=counterfactual`, `/?demo=meena`.

**Optional Claude analysis.** Set `ANTHROPIC_API_KEY` before `npm start`, or set `TUTOR_LLM=1` after `ant auth login`.
Claude is used for two things only:
- mapping unknown Tamil/Tanglish words to the English the learner needed
- a second opinion when the rule grader can't decide

The adaptive engine stays deterministic either way. Model: `claude-opus-5-5` (override with `TUTOR_MODEL`), effort `low`, server-side refusal fallback enabled.

## How it decides

| Layer | File | What it does |
|---|---|---|
| Content | `public/js/content.js` | 8 tasks. Each task covers all 6 modes and includes its Tamil-transfer error patterns and a Tamil/Tanglish lexicon |
| Language | `public/js/lang.js` | Detects code-switching, extracts gaps (e.g. `mela → on`, `table-la → in/on the table`), hedges, disfluency, grading |
| Load | `public/js/estimator.js` | Weighted signals blended with the 3 strongest signals. Calibrated to the learner's own baseline |
| Diagnosis | `public/js/diagnosis.js` | Softmax over knowledge / retrieval / expression / Tamil-transfer / overload / misunderstanding, with evidence |
| Policy | `public/js/policy.js` | Named rules (R1–R18, H1–H2). Hysteresis: one calm mistake never switches mode |
| Learner model | `public/js/learner.js` | Beta posteriors for comprehension, recognition, guided and free production |
| Metrics | `public/js/metrics.js` | Recovery rate, hidden knowledge, intervention effectiveness, load AUC, self-report correlation |

Modes, from least to most support: English-only → Guided English → Recognition → Code-switch → Bilingual → Explicit teaching.

Sessions are saved in browser localStorage. Use **Sessions → Export JSON** for cross-learner analysis.

## Synthetic evaluation

```bash
npm run sim      # 440 synthetic learners × 7 tutor conditions → public/eval/results.json (≈10 s)
```

Results are shown on the **Evaluation** tab. The setup:
- **Learners:** 11 profiles (fluent, slow-but-fluent, knows-it-but-freezes, missing English words, Tamil-transfer, beginner, anxious, misreader, careless, erratic, mixed). Each has hidden per-concept state and realistic noise: typos, slips, random Tamil words, skipping, hint spam, inconsistent typing speed, missing self-ratings.
- **Design:** every learner meets every tutor (paired, common random numbers), with an unaided pre-test and post-test.
- **Conditions:** static tutor, static + retries, full adaptive, and four ablations (no hysteresis, no recognition probe, no Tamil channels, ladder without diagnosis).
- **What's measured vs. assumed:** diagnosis accuracy, false "doesn't know" labels and false adaptations are scored against the simulator's ground truth. Learning gains depend on the modelled effects in `sim/learner.mjs` (`EFFECTS`), and a sensitivity analysis scales them ×0.5 and ×1.5.

## Hypothesis validation

```bash
npm run stats    # ≈1 min → public/eval/stats.json + REPORT.md
```

Paired tests per learner (t, Wilcoxon, sign-flip permutation, bootstrap CIs), McNemar for labels, cluster bootstrap for turn-level metrics, Holm correction, 5-seed replication, sensitivity, and power analysis for a real pilot. Results are on the **Report** tab and in [REPORT.md](REPORT.md).

## Live monitoring

The app sends **anonymous** per-session metrics to `/api/track` (timings, modes, outcomes, diagnoses; never names or typed answers). The **Monitor** tab polls `/api/metrics` every 15 s and shows live KPIs against simulation expectations, estimator health (load AUC, load vs self-rating, oscillation), strategy effectiveness, per-concept results and alerts. Storage is a private Vercel Blob store in production (`BLOB_READ_WRITE_TOKEN`) and `data/sessions/` locally.

## Deploy

```bash
npx vercel deploy --prod      # static site from public/ + api/health, api/analyze
```
To enable Claude analysis on Vercel, add `ANTHROPIC_API_KEY` in the project's environment variables.
