# Kural: hypothesis validation report

*Generated 2026-10-08 by `npm run stats`. Synthetic learners; read "How much to trust this" before quoting any number.*

## Research question

> Can behavioural signals distinguish a learner's underlying knowledge from their ability to express it in English, and can adaptive communication reduce the cognitive load of producing it?

## Design

- **Learners:** 440 synthetic Tamil-speaking learners per seed (11 profiles × 40), with hidden ground truth per concept: knows it, retrieval strength, missing English words, Tamil-structure transfer, comprehension, overload. Every profile is noisy: typos, slips, random Tamil words, skipping, hint spam, inconsistent typing speed, missing self-ratings.
- **Tutors:** static; static + 3 retries (time-matched baseline); full adaptive; four ablations.
- **Paired design:** every learner meets every tutor with common random numbers (identical pre-test and post-test draws).
- **Outcome:** unaided English production, 2 unseen items × 8 concepts, before and after the session.
- **Statistics:**
  - Unit of analysis is the learner.
  - Paired t-test, Wilcoxon signed-rank and sign-flip permutation tests, with 2000-resample bootstrap CIs.
  - Turn-level metrics use a cluster bootstrap by learner.
  - McNemar for paired labels; Holm correction within each family.
  - Primary seed 99, replicated on seeds 101, 103, 105, 107.
  - Sensitivity analysis scales all modelled learning effects ×0 to ×1.5.

## Verdicts

| | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | Passive typing signals separate struggling answers from calm, correct ones. | **Supported (in simulation)** | AUC 0.948 (95% CI 0.943–0.953, p < 0.001), replicated in 5/5 seeds. |
| H2 | The system distinguishes "doesn't know it" from "knows it but can't say it in English". | **Supported (in simulation)** | False "doesn't know" labels on concepts the learner knows: 72.1% → 12.8% (McNemar χ² 1498.6, p < 0.001). Cost: true-gap recall 95.7% → 70.8%. |
| H3 | The diagnosed bottleneck matches the true cause better than chance. | **Supported (in simulation)** | Accuracy 54.5% (cluster-bootstrap CI 53.1%–56.2%) vs chance 16.7% and majority-class 26.4%; Cohen's κ 0.45; 20.2% deferred as uncertain. |
| H4 | Adaptive communication increases independent English production and learning. | **Supported (in simulation)** | Learning gain vs static +13.8 pp (CI +12.6 pp to +15.1 pp, d_z 0.99, p < 0.001); vs time-matched retries +12.2 pp. Independent completion +31.5 pp. Positive at every assumption scale ≥ 0.5. |
| H5 | Changing the communication channel lowers measured cognitive load on the next attempt. | **Supported (in simulation)** | Load change after a mode switch −0.166 vs after holding the mode +0.098; difference −0.265 (CI −0.282 to −0.249, p < 0.001). |
| H6 | Each adaptive strategy contributes to learning. | **Partially supported** | Removing hysteresis: +0.8 pp learning gain (Holm p 0.197); Removing recognition probe: +1.6 pp learning gain (Holm p 0.017); Removing Tamil channels: −0.5 pp learning gain (Holm p 0.360); Replacing diagnosis with a blind support ladder: −6.3 pp learning gain (Holm p < 0.001). |

## Details

### H2: knowledge vs expression (the core claim)
| | Static | Adaptive |
|---|---|---|
| False "doesn't know" (learner knows it) | 72.1% [70.4%–73.7%] | 12.8% [11.6%–14.1%] |
| Recall of genuine gaps | 95.7% | 70.8% |
| Precision of "doesn't know" labels | 29.3% | 63.4% |

McNemar (false labels): b=1639, c=48, p < 0.001. Learner-level mean reduction 60.5 pp (CI 57.8 pp–63.3 pp).
**Trade-off:** the adaptive tutor misses more genuine gaps (recall 95.7% → 70.8%), but its "doesn't know" labels are far more often right (precision 29.3% → 63.4%).

### H3: diagnosis
| Bottleneck | Precision | Recall | F1 | n |
|---|---|---|---|---|
| Knowledge gap | 56.4% | 51.3% | 0.54 | 1745 |
| Retrieval gap | 20.7% | 35.0% | 0.26 | 925 |
| Expression gap | 86.9% | 62.6% | 0.73 | 1290 |
| Tamil-structure transfer | 64.3% | 50.8% | 0.57 | 1310 |
| Cognitive overload | 39.0% | 58.1% | 0.47 | 635 |
| Misunderstood question | 100.0% | 77.1% | 0.87 | 703 |

Macro-F1 0.57, κ 0.45.

### H4: production and learning (per learner, adaptive − baseline)
| Outcome | vs static | vs static + retries |
|---|---|---|
| Independent English in session | +31.5 pp [29.5 pp, 33.5 pp] | +15.1 pp [13.2 pp, 17.1 pp] |
| Learning gain (post − pre) | +13.8 pp [12.6 pp, 15.1 pp], d_z 0.99 | +12.2 pp [11.0 pp, 13.6 pp], d_z 0.89 |
| Gain per 10 turns | +2.2 pp | +2.1 pp |

Turns per task: static 1.00, retries 2.14, adaptive 4.79. 74.8% of learners gained more with adaptive, 6.4% less.

### H6: strategy ablations (full adaptive − ablation, Holm-corrected)
| Removed | Δ learning gain (full − ablation) | Holm p | Δ independent (full − ablation) | False "doesn't know" (ablation − full) |
|---|---|---|---|---|
| − hysteresis | −0.8 pp | 0.197 | +3.0 pp | −0.3 pp |
| − recognition probe | −1.6 pp | 0.017 | −4.8 pp | −2.7 pp |
| − Tamil channels | +0.5 pp | 0.360 | +4.4 pp | +0.8 pp |
| Ladder (no diagnosis) | +6.3 pp | < 0.001 | +11.5 pp | +5.0 pp |

In the first two columns, positive = the strategy helps. In the last column, positive = the ablation produced more false labels (also means the strategy helps).

### Who benefits (adaptive − static learning gain, Holm-corrected)
| Profile | Δ gain | 95% CI | Holm p |
|---|---|---|---|
| Fluent | +4.1 pp | 1.6 pp to 6.7 pp | 0.003 |
| Slow but fluent | +8.4 pp | 5.0 pp to 12.0 pp | < 0.001 |
| Knows it, freezes | +12.3 pp | 8.3 pp to 16.7 pp | < 0.001 |
| Missing English words | +22.5 pp | 18.0 pp to 26.9 pp | < 0.001 |
| Tamil-structure transfer | +21.1 pp | 15.9 pp to 26.4 pp | < 0.001 |
| Genuine beginner | +17.3 pp | 13.9 pp to 20.9 pp | < 0.001 |
| Anxious / overloaded | +12.8 pp | 9.1 pp to 17.0 pp | < 0.001 |
| Misreads questions | +15.2 pp | 12.5 pp to 18.1 pp | < 0.001 |
| Fast and careless | +14.4 pp | 9.8 pp to 19.4 pp | < 0.001 |
| Erratic / inconsistent | +8.3 pp | 5.3 pp to 11.1 pp | < 0.001 |
| Mixed per concept | +15.0 pp | 10.6 pp to 19.7 pp | < 0.001 |

### Replication across seeds
| Seed | Δ gain vs static [CI] | False-label reduction | Load AUC | Diagnosis acc. |
|---|---|---|---|---|
| 99 | +13.8 pp [12.6 pp, 15.1 pp] | 60.5 pp | 0.948 | 54.5% |
| 101 | +12.7 pp [11.4 pp, 13.9 pp] | 59.1 pp | 0.956 | 55.5% |
| 103 | +12.2 pp [11.0 pp, 13.5 pp] | 60.5 pp | 0.953 | 55.3% |
| 105 | +12.3 pp [11.1 pp, 13.6 pp] | 60.4 pp | 0.954 | 54.7% |
| 107 | +12.7 pp [11.3 pp, 14.0 pp] | 61.8 pp | 0.952 | 54.3% |

### Sensitivity to the learning assumptions
| Learning effects × | Δ gain vs static [CI] | Δ gain vs retries [CI] |
|---|---|---|
| 0 | +0.0 pp [+0.0 pp, +0.0 pp] | +0.0 pp [+0.0 pp, +0.0 pp] |
| 0.25 | +4.0 pp [+2.9 pp, +5.1 pp] | +3.7 pp [+2.7 pp, +4.8 pp] |
| 0.5 | +7.7 pp [+6.4 pp, +8.9 pp] | +6.8 pp [+5.6 pp, +8.0 pp] |
| 1 | +12.8 pp [+11.2 pp, +14.5 pp] | +11.5 pp [+9.9 pp, +13.0 pp] |
| 1.5 | +18.2 pp [+16.2 pp, +20.2 pp] | +17.0 pp [+15.2 pp, +19.0 pp] |

At ×0 nobody learns from any tutor, so the difference should be ≈ 0. That row is a check that the simulation isn't biased toward the adaptive tutor through some other path.

## How much to trust this

1. **Simulation, not people.** p-values here measure Monte-Carlo precision. With enough simulated learners almost any difference is "significant", so read effect sizes and CIs, not p-values.
2. **Same-author bias.** The simulator and tutor were written together. Comparisons between tutor variants share that bias and are more trustworthy than absolute values.
3. **What is measured vs. assumed:**
   - Measured against ground truth: H1 (implementation), H2, H3, false adaptations.
   - Dependent on assumed learning effects: H4 and H6 learning gains.
   - Observational: H5.
4. **One diagnosis change was tuned** on seed 7. All results here use seeds 99, 101, 103, 105, 107.

## Recommended real-learner pilot

Paired (crossover) design, adaptive vs static + retries, primary outcome unaided English production on held-out items.

| Assumed real effect (d_z) | Learners needed (80% power, α 0.05) |
|---|---|
| 0.20 | 199 |
| 0.30 | 90 |
| 0.50 | 34 |
| 0.99 (simulated) | 10 |

Real effects are usually much smaller than simulated ones, so plan for d_z ≈ 0.3 (about 90 learners). Also log the live Monitor metrics (load AUC against self-ratings, recovery rate) to check H1 and H5 on real behaviour.
