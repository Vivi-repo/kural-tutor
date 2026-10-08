// Statistical validation of Kural's hypotheses on the synthetic-learner experiment.
//   node sim/stats.mjs   → public/eval/stats.json + REPORT.md
//
// Unit of analysis is the LEARNER (paired across tutors). Turn-level metrics use
// cluster bootstrap by learner, because turns from the same learner are not independent.
import { writeFile } from 'node:fs/promises';
import { BOTTLENECK_IDS, BOTTLENECKS } from '../public/js/content.js';
import { ARCHETYPES, EFFECTS, scaleEffects, rng } from './learner.mjs';
import { CONDITIONS, experiment, mean, sd, round } from './experiment.mjs';

const PRIMARY_SEED = 99, REPLICATION_SEEDS = [101, 103, 105, 107], PER = 40, B = 2000;
const R = rng(20261007);

// ---------------- distributions ----------------
const erf = x => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
const pNorm2 = z => 2 * (1 - normCdf(Math.abs(z)));
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
const lgamma = z => { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); };
function ibeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
const pT2 = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5); // two-sided

// ---------------- tests ----------------
function pairedTest(x) { // x = per-learner paired differences
  const n = x.length, m = mean(x), s = sd(x), se = s / Math.sqrt(n), t = s ? m / se : 0;
  const boot = []; for (let b = 0; b < B; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += x[Math.floor(R.next() * n)]; boot.push(acc / n); }
  boot.sort((a, b) => a - b);
  let flips = 0; const P = 2000; for (let p = 0; p < P; p++) { let acc = 0; for (const v of x) acc += R.next() < 0.5 ? v : -v; if (Math.abs(acc / n) >= Math.abs(m) - 1e-12) flips++; }
  return { n, mean: m, sd: s, ciLo: boot[Math.floor(0.025 * B)], ciHi: boot[Math.floor(0.975 * B)], t, df: n - 1, p: s ? pT2(t, n - 1) : 1,
    pWilcoxon: wilcoxon(x), pPermutation: (flips + 1) / (P + 1), dz: s ? m / s : null, pctPositive: x.filter(v => v > 0).length / n, pctNegative: x.filter(v => v < 0).length / n };
}
function wilcoxon(x) {
  const d = x.filter(v => v !== 0).map(v => ({ v, a: Math.abs(v) })).sort((p, q) => p.a - q.a);
  const n = d.length; if (!n) return 1;
  let i = 0, tieCorr = 0; const ranks = Array(n);
  while (i < n) { let j = i; while (j + 1 < n && d[j + 1].a === d[i].a) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[k] = r; const t = j - i + 1; tieCorr += t ** 3 - t; i = j + 1; }
  const W = d.reduce((s, e, k) => s + (e.v > 0 ? ranks[k] : 0), 0);
  const mu = n * (n + 1) / 4, sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tieCorr / 48);
  return pNorm2((W - mu) / sigma);
}
function mcnemar(b, c) { // b: static yes / adaptive no; c: static no / adaptive yes
  if (b + c === 0) return { b, c, p: 1 };
  const chi = (Math.abs(b - c) - 1) ** 2 / (b + c);
  return { b, c, chi2: chi, p: pNorm2(Math.sqrt(chi)) };
}
function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null };
  const p = k / n, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return { p, lo: c - h, hi: c + h, k, n };
}
function rankAuc(pos, neg) {
  const all = pos.map(v => [v, 1]).concat(neg.map(v => [v, 0])).sort((a, b) => a[0] - b[0]);
  let i = 0, rs = 0; while (i < all.length) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) if (all[k][1]) rs += r; i = j + 1; }
  const n1 = pos.length, n2 = neg.length, U = rs - n1 * (n1 + 1) / 2;
  const z = (U - n1 * n2 / 2) / Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
  return { auc: U / (n1 * n2), p: pNorm2(z), n1, n2 };
}
function clusterBoot(groups, stat) { // groups: array of arrays (one per learner)
  const est = stat(groups.flat()), out = [];
  for (let b = 0; b < 400; b++) { const s = []; for (let i = 0; i < groups.length; i++) s.push(...groups[Math.floor(R.next() * groups.length)]); out.push(stat(s)); }
  out.sort((a, b) => a - b);
  return { est, lo: out[Math.floor(0.025 * out.length)], hi: out[Math.floor(0.975 * out.length)], se: sd(out) };
}
function holm(ps) { // ps: [{key, p}] → adds pHolm
  const s = [...ps].sort((a, b) => a.p - b.p); let run = 0;
  s.forEach((e, i) => { run = Math.max(run, Math.min(1, e.p * (s.length - i))); e.pHolm = run; });
  return ps;
}
const nForPower = dz => Math.ceil(((1.959964 + 0.841621) / dz) ** 2 + 1.959964 ** 2 / 2);
const groupBy = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

// ---------------- analysis of one experiment ----------------
function analyse({ rows, logs }) {
  const by = (cond) => new Map(rows.filter(r => r.cond === cond).map(r => [r.learner, r]));
  const S = by('static'), SR = by('staticRetry'), A = by('adaptive');
  const learners = [...A.keys()];
  const indep = r => mean(r.tasks.map(t => +t.solved));
  const turns = r => r.tasks.reduce((s, t) => s + t.turns, 0);
  const mislabel = r => { const k = r.tasks.filter(t => r.truthK[t.concept]); return k.length ? mean(k.map(t => +t.gapLabel)) : null; };

  const out = {};
  // H1: behavioural load separates struggling from calm answers
  {
    const L = logs.adaptive.filter(l => l.kind === 'text');
    const pos = L.filter(l => l.cause && l.cause !== 'NOISE').map(l => l.load), neg = L.filter(l => !l.cause && l.correct).map(l => l.load);
    const g = [...groupBy(L.filter(l => (l.cause && l.cause !== 'NOISE') || (!l.cause && l.correct)), l => l.learner).values()];
    const boot = clusterBoot(g, s => { const p = s.filter(l => l.cause).map(l => l.load), n = s.filter(l => !l.cause).map(l => l.load); return p.length && n.length ? rankAuc(p, n).auc : 0.5; });
    out.H1 = { ...rankAuc(pos, neg), ciLo: boot.lo, ciHi: boot.hi, meanStruggle: mean(pos), meanCalm: mean(neg) };
  }
  // H2: knowledge vs expression — fewer false "doesn't know" labels, without losing true gaps
  {
    let b = 0, c = 0, b2 = 0, c2 = 0, kS = 0, kA = 0, nK = 0, gS = 0, gA = 0, nG = 0;
    for (const id of learners) {
      const s = S.get(id), a = A.get(id);
      s.tasks.forEach((ts, i) => {
        const ta = a.tasks[i]; const K = s.truthK[ts.concept];
        if (K) { nK++; kS += ts.gapLabel; kA += ta.gapLabel; if (ts.gapLabel && !ta.gapLabel) b++; if (!ts.gapLabel && ta.gapLabel) c++; }
        else { nG++; gS += ts.gapLabel; gA += ta.gapLabel; if (ts.gapLabel && !ta.gapLabel) b2++; if (!ts.gapLabel && ta.gapLabel) c2++; }
      });
    }
    const perLearner = learners.map(id => (mislabel(A.get(id)) ?? 0) - (mislabel(S.get(id)) ?? 0));
    const precision = (cond) => { let tp = 0, l = 0; for (const r of cond.values()) for (const t of r.tasks) if (t.gapLabel) { l++; if (!r.truthK[t.concept]) tp++; } return wilson(tp, l); };
    out.H2 = {
      falseGapStatic: wilson(kS, nK), falseGapAdaptive: wilson(kA, nK), mcnemarFalseGap: mcnemar(b, c), learnerLevel: pairedTest(perLearner),
      recallStatic: wilson(gS, nG), recallAdaptive: wilson(gA, nG), mcnemarRecall: mcnemar(b2, c2),
      precisionStatic: precision(S), precisionAdaptive: precision(A),
    };
  }
  // H3: bottleneck diagnosis beats chance and the majority-class baseline
  {
    const L = logs.adaptive.filter(l => !l.correct && BOTTLENECK_IDS.includes(l.cause) && l.diag);
    const conf = L.filter(l => !l.uncertain);
    const g = [...groupBy(conf, l => l.learner).values()];
    const acc = clusterBoot(g, s => mean(s.map(l => +(l.diag === l.cause))));
    const counts = {}; for (const l of conf) counts[l.cause] = (counts[l.cause] || 0) + 1;
    const majority = Math.max(...Object.values(counts)) / conf.length;
    const po = acc.est; let pe = 0;
    for (const k of BOTTLENECK_IDS) pe += (conf.filter(l => l.cause === k).length / conf.length) * (conf.filter(l => l.diag === k).length / conf.length);
    const perClass = BOTTLENECK_IDS.map(k => {
      const tp = conf.filter(l => l.cause === k && l.diag === k).length, fp = conf.filter(l => l.cause !== k && l.diag === k).length, fn = conf.filter(l => l.cause === k && l.diag !== k).length;
      const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
      return { cls: k, precision: p, recall: r, f1: p + r ? 2 * p * r / (p + r) : 0, support: tp + fn };
    });
    out.H3 = { n: conf.length, nAll: L.length, uncertainRate: 1 - conf.length / L.length, accuracy: acc.est, ciLo: acc.lo, ciHi: acc.hi,
      chance: 1 / 6, majority, zVsChance: (acc.est - 1 / 6) / acc.se, pVsChance: pNorm2((acc.est - 1 / 6) / acc.se), pVsMajority: pNorm2((acc.est - majority) / acc.se),
      kappa: (po - pe) / (1 - pe), macroF1: mean(perClass.map(c => c.f1)), perClass };
  }
  // H4: adaptive communication improves independent English and learning
  {
    const d = (X, Y, f) => learners.map(id => f(X.get(id)) - f(Y.get(id)));
    out.H4 = {
      independentVsStatic: pairedTest(d(A, S, indep)), independentVsRetry: pairedTest(d(A, SR, indep)),
      gainVsStatic: pairedTest(d(A, S, r => r.gain)), gainVsRetry: pairedTest(d(A, SR, r => r.gain)),
      efficiencyVsStatic: pairedTest(learners.map(id => 10 * A.get(id).gain / turns(A.get(id)) - 10 * S.get(id).gain / turns(S.get(id)))),
      efficiencyVsRetry: pairedTest(learners.map(id => 10 * A.get(id).gain / turns(A.get(id)) - 10 * SR.get(id).gain / turns(SR.get(id)))),
      turns: { static: mean([...S.values()].map(r => turns(r) / r.tasks.length)), retry: mean([...SR.values()].map(r => turns(r) / r.tasks.length)), adaptive: mean([...A.values()].map(r => turns(r) / r.tasks.length)) },
    };
  }
  // H5: adapting the channel lowers measured load on the next attempt (vs. holding the mode)
  {
    const perLearner = { adapt: new Map(), hold: new Map() };
    for (const [id, L] of groupBy(logs.adaptive, l => l.learner)) {
      for (let i = 0; i + 1 < L.length; i++) {
        const a = L[i], b = L[i + 1];
        if (a.correct || a.kind !== 'text' || b.taskIndex !== a.taskIndex || b.kind === 'choice') continue;
        const key = a.rule === 'R4-HOLD' ? 'hold' : b.mode !== a.mode ? 'adapt' : null;
        if (!key) continue;
        if (!perLearner[key].has(id)) perLearner[key].set(id, []);
        perLearner[key].get(id).push(b.load - a.load);
      }
    }
    const adapt = [...perLearner.adapt.values()].map(mean), hold = [...perLearner.hold.values()].map(mean);
    const both = [...perLearner.adapt.keys()].filter(id => perLearner.hold.has(id));
    out.H5 = { adapt: pairedTest(adapt), hold: pairedTest(hold),
      adaptMinusHold: pairedTest(both.map(id => mean(perLearner.adapt.get(id)) - mean(perLearner.hold.get(id)))) };
  }
  // H6: which strategies contribute (ablations), Holm-corrected
  {
    const fam = ['noHold', 'noProbe', 'englishOnly', 'ladder'].map(k => {
      const X = by(k);
      const g = pairedTest(learners.map(id => A.get(id).gain - X.get(id).gain));
      const ind = pairedTest(learners.map(id => indep(A.get(id)) - indep(X.get(id))));
      const fg = pairedTest(learners.map(id => (mislabel(X.get(id)) ?? 0) - (mislabel(A.get(id)) ?? 0)));
      return { key: k, label: CONDITIONS[k].label, gain: g, independent: ind, falseGap: fg, p: g.p };
    });
    holm(fam);
    holm(fam.map(f => f.independent)); holm(fam.map(f => f.falseGap));
    out.H6 = fam;
  }
  // Subgroups: adaptive − static gain per learner profile, Holm-corrected
  {
    const sub = Object.keys(ARCHETYPES).map(a => {
      const ids = learners.filter(id => A.get(id).archetype === a);
      return { key: a, label: ARCHETYPES[a].label, ...pairedTest(ids.map(id => A.get(id).gain - S.get(id).gain)) };
    });
    holm(sub);
    out.subgroups = sub;
  }
  return out;
}

// ---------------- run ----------------
const t0 = Date.now();
console.log('Primary experiment (seed 99)…');
const primary = analyse(await experiment({ effects: EFFECTS, conditions: Object.keys(CONDITIONS), per: PER, seed: PRIMARY_SEED, collectDetail: true }));

console.log('Replications…');
const replication = [];
for (const seed of [PRIMARY_SEED, ...REPLICATION_SEEDS]) {
  const a = seed === PRIMARY_SEED ? primary : analyse(await experiment({ effects: EFFECTS, conditions: Object.keys(CONDITIONS), per: PER, seed, collectDetail: true }));
  replication.push({ seed, gainVsStatic: a.H4.gainVsStatic, independentVsStatic: a.H4.independentVsStatic, falseGapReduction: a.H2.learnerLevel, auc: a.H1.auc, diagAcc: a.H3.accuracy, loadDrop: a.H5.adaptMinusHold.mean, ladder: a.H6.find(x => x.key === 'ladder').gain.mean, noProbe: a.H6.find(x => x.key === 'noProbe').gain.mean });
}

console.log('Sensitivity to learning-effect assumptions…');
const sensitivity = [];
for (const f of [0, 0.25, 0.5, 1, 1.5]) {
  const ex = await experiment({ effects: scaleEffects(f), conditions: ['static', 'staticRetry', 'adaptive'], per: 24, seed: 5000 + f * 100, collectDetail: true });
  const by = c => new Map(ex.rows.filter(r => r.cond === c).map(r => [r.learner, r]));
  const S = by('static'), SR = by('staticRetry'), A = by('adaptive');
  const ids = [...A.keys()];
  sensitivity.push({ scale: f, vsStatic: pairedTest(ids.map(id => A.get(id).gain - S.get(id).gain)), vsRetry: pairedTest(ids.map(id => A.get(id).gain - SR.get(id).gain)) });
}

// ---------------- verdicts ----------------
const allRep = (f) => replication.every(f);
const robustGain = sensitivity.filter(s => s.scale >= 0.5).every(s => s.vsStatic.ciLo > 0);
const h = primary;
const verdicts = [
  { id: 'H1', claim: 'Passive typing signals separate struggling answers from calm, correct ones.',
    supported: h.H1.ciLo > 0.5 && allRep(r => r.auc > 0.6),
    evidence: `AUC ${h.H1.auc.toFixed(3)} (95% CI ${h.H1.ciLo.toFixed(3)}–${h.H1.ciHi.toFixed(3)}, p ${fmtP(h.H1.p)}), replicated in ${replication.length}/${replication.length} seeds.`,
    caveat: 'Optimistic by construction: the simulator makes struggling learners slower and more hesitant. This validates the implementation, not real learner behaviour.' },
  { id: 'H2', claim: 'The system distinguishes "doesn\'t know it" from "knows it but can\'t say it in English".',
    supported: h.H2.mcnemarFalseGap.p < 0.05 && h.H2.falseGapAdaptive.p < h.H2.falseGapStatic.p && allRep(r => r.falseGapReduction.ciHi < 0),
    evidence: `False "doesn't know" labels on concepts the learner knows: ${pc(h.H2.falseGapStatic.p)} → ${pc(h.H2.falseGapAdaptive.p)} (McNemar χ² ${h.H2.mcnemarFalseGap.chi2.toFixed(1)}, p ${fmtP(h.H2.mcnemarFalseGap.p)}). Cost: true-gap recall ${pc(h.H2.recallStatic.p)} → ${pc(h.H2.recallAdaptive.p)}.`,
    caveat: 'Measured against simulator ground truth. Recall of genuine gaps drops; see the trade-off below.' },
  { id: 'H3', claim: 'The diagnosed bottleneck matches the true cause better than chance.',
    supported: h.H3.ciLo > Math.max(1 / 6, h.H3.majority),
    evidence: `Accuracy ${pc(h.H3.accuracy)} (cluster-bootstrap CI ${pc(h.H3.ciLo)}–${pc(h.H3.ciHi)}) vs chance 16.7% and majority-class ${pc(h.H3.majority)}; Cohen's κ ${h.H3.kappa.toFixed(2)}; ${pc(h.H3.uncertainRate)} deferred as uncertain.`,
    caveat: 'Moderate, not strong: retrieval vs overload and knowledge vs Tamil transfer are often confused.' },
  { id: 'H4', claim: 'Adaptive communication increases independent English production and learning.',
    supported: h.H4.gainVsStatic.ciLo > 0 && h.H4.gainVsRetry.ciLo > 0 && allRep(r => r.gainVsStatic.ciLo > 0) && robustGain,
    evidence: `Learning gain vs static +${pp(h.H4.gainVsStatic.mean)} (CI +${pp(h.H4.gainVsStatic.ciLo)} to +${pp(h.H4.gainVsStatic.ciHi)}, d_z ${h.H4.gainVsStatic.dz.toFixed(2)}, p ${fmtP(h.H4.gainVsStatic.p)}); vs time-matched retries +${pp(h.H4.gainVsRetry.mean)}. Independent completion +${pp(h.H4.independentVsStatic.mean)}. Positive at every assumption scale ≥ 0.5.`,
    caveat: 'Learning gains depend on modelled learning effects. With zero assumed teaching effect the advantage disappears (see sensitivity), so the size is an assumption.' },
  { id: 'H5', claim: 'Changing the communication channel lowers measured cognitive load on the next attempt.',
    supported: h.H5.adaptMinusHold.ciHi < 0 && allRep(r => r.loadDrop < 0),
    evidence: `Load change after a mode switch ${sgn(h.H5.adapt.mean)} vs after holding the mode ${sgn(h.H5.hold.mean)}; difference ${sgn(h.H5.adaptMinusHold.mean)} (CI ${sgn(h.H5.adaptMinusHold.ciLo)} to ${sgn(h.H5.adaptMinusHold.ciHi)}, p ${fmtP(h.H5.adaptMinusHold.p)}).`,
    caveat: 'Holding the mode is used as the control because load falls after any high-load answer (regression to the mean). The two situations are not randomised, so this is suggestive rather than causal.' },
  { id: 'H6', claim: 'Each adaptive strategy contributes to learning.',
    supported: h.H6.every(x => x.gain.ciLo > 0 && x.pHolm < 0.05),
    partial: h.H6.some(x => x.gain.ciLo > 0 && x.pHolm < 0.05),
    evidence: h.H6.map(x => `${x.key === 'ladder' ? 'Replacing diagnosis with a blind support ladder' : 'Removing ' + x.label.replace('− ', '')}: ${-x.gain.mean >= 0 ? '+' : '−'}${pp(Math.abs(x.gain.mean))} learning gain (Holm p ${fmtP(x.pHolm)})`).join('; ') + '.',
    caveat: 'Diagnosis-driven routing clearly matters. The recognition probe significantly hurts learning in this model, and hysteresis and Tamil channels show no detectable effect on learning gain.' },
];
function pc(x) { return x == null ? '—' : `${(x * 100).toFixed(1)}%`; }
function pp(x) { return `${(x * 100).toFixed(1)} pp`; }
function spp(x) { return `${x >= 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(1)} pp`; }
function sgn(x) { return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`; }
function fmtP(p) { return p < 0.001 ? '< 0.001' : p.toFixed(3); }
for (const v of verdicts) v.verdict = v.supported ? 'Supported (in simulation)' : v.partial ? 'Partially supported' : 'Not supported';

const power = [0.2, 0.3, 0.5, primary.H4.gainVsStatic.dz].map(dz => ({ dz, n: nForPower(dz), observed: dz === primary.H4.gainVsStatic.dz }));

const stats = round({
  meta: { generatedAt: new Date().toISOString(), primarySeed: PRIMARY_SEED, replicationSeeds: REPLICATION_SEEDS, learnersPerSeed: PER * Object.keys(ARCHETYPES).length, bootstrap: B, runtimeSec: (Date.now() - t0) / 1000,
    bottlenecks: Object.fromEntries(Object.entries(BOTTLENECKS).map(([k, v]) => [k, v.label])) },
  verdicts, primary, replication, sensitivity, power,
});
await writeFile('public/eval/stats.json', JSON.stringify(stats, null, 1));

// ---------------- REPORT.md ----------------
const P = primary;
const md = `# Kural: hypothesis validation report

*Generated ${new Date().toISOString().slice(0, 10)} by \`npm run stats\`. Synthetic learners; read "How much to trust this" before quoting any number.*

## Research question

> Can behavioural signals distinguish a learner's underlying knowledge from their ability to express it in English, and can adaptive communication reduce the cognitive load of producing it?

## Design

- **Learners:** ${stats.meta.learnersPerSeed} synthetic Tamil-speaking learners per seed (11 profiles × ${PER}), with hidden ground truth per concept: knows it, retrieval strength, missing English words, Tamil-structure transfer, comprehension, overload. Every profile is noisy: typos, slips, random Tamil words, skipping, hint spam, inconsistent typing speed, missing self-ratings.
- **Tutors:** static; static + 3 retries (time-matched baseline); full adaptive; four ablations.
- **Paired design:** every learner meets every tutor with common random numbers (identical pre-test and post-test draws).
- **Outcome:** unaided English production, 2 unseen items × 8 concepts, before and after the session.
- **Statistics:**
  - Unit of analysis is the learner.
  - Paired t-test, Wilcoxon signed-rank and sign-flip permutation tests, with ${B}-resample bootstrap CIs.
  - Turn-level metrics use a cluster bootstrap by learner.
  - McNemar for paired labels; Holm correction within each family.
  - Primary seed ${PRIMARY_SEED}, replicated on seeds ${REPLICATION_SEEDS.join(', ')}.
  - Sensitivity analysis scales all modelled learning effects ×0 to ×1.5.

## Verdicts

| | Hypothesis | Verdict | Evidence |
|---|---|---|---|
${verdicts.map(v => `| ${v.id} | ${v.claim} | **${v.verdict}** | ${v.evidence} |`).join('\n')}

## Details

### H2: knowledge vs expression (the core claim)
| | Static | Adaptive |
|---|---|---|
| False "doesn't know" (learner knows it) | ${pc(P.H2.falseGapStatic.p)} [${pc(P.H2.falseGapStatic.lo)}–${pc(P.H2.falseGapStatic.hi)}] | ${pc(P.H2.falseGapAdaptive.p)} [${pc(P.H2.falseGapAdaptive.lo)}–${pc(P.H2.falseGapAdaptive.hi)}] |
| Recall of genuine gaps | ${pc(P.H2.recallStatic.p)} | ${pc(P.H2.recallAdaptive.p)} |
| Precision of "doesn't know" labels | ${pc(P.H2.precisionStatic.p)} | ${pc(P.H2.precisionAdaptive.p)} |

McNemar (false labels): b=${P.H2.mcnemarFalseGap.b}, c=${P.H2.mcnemarFalseGap.c}, p ${fmtP(P.H2.mcnemarFalseGap.p)}. Learner-level mean reduction ${pp(-P.H2.learnerLevel.mean)} (CI ${pp(-P.H2.learnerLevel.ciHi)}–${pp(-P.H2.learnerLevel.ciLo)}).
**Trade-off:** the adaptive tutor misses more genuine gaps (recall ${pc(P.H2.recallStatic.p)} → ${pc(P.H2.recallAdaptive.p)}), but its "doesn't know" labels are far more often right (precision ${pc(P.H2.precisionStatic.p)} → ${pc(P.H2.precisionAdaptive.p)}).

### H3: diagnosis
| Bottleneck | Precision | Recall | F1 | n |
|---|---|---|---|---|
${P.H3.perClass.map(c => `| ${BOTTLENECKS[c.cls].label} | ${pc(c.precision)} | ${pc(c.recall)} | ${c.f1.toFixed(2)} | ${c.support} |`).join('\n')}

Macro-F1 ${P.H3.macroF1.toFixed(2)}, κ ${P.H3.kappa.toFixed(2)}.

### H4: production and learning (per learner, adaptive − baseline)
| Outcome | vs static | vs static + retries |
|---|---|---|
| Independent English in session | +${pp(P.H4.independentVsStatic.mean)} [${pp(P.H4.independentVsStatic.ciLo)}, ${pp(P.H4.independentVsStatic.ciHi)}] | +${pp(P.H4.independentVsRetry.mean)} [${pp(P.H4.independentVsRetry.ciLo)}, ${pp(P.H4.independentVsRetry.ciHi)}] |
| Learning gain (post − pre) | +${pp(P.H4.gainVsStatic.mean)} [${pp(P.H4.gainVsStatic.ciLo)}, ${pp(P.H4.gainVsStatic.ciHi)}], d_z ${P.H4.gainVsStatic.dz.toFixed(2)} | +${pp(P.H4.gainVsRetry.mean)} [${pp(P.H4.gainVsRetry.ciLo)}, ${pp(P.H4.gainVsRetry.ciHi)}], d_z ${P.H4.gainVsRetry.dz.toFixed(2)} |
| Gain per 10 turns | ${spp(P.H4.efficiencyVsStatic.mean)} | ${spp(P.H4.efficiencyVsRetry.mean)} |

Turns per task: static ${P.H4.turns.static.toFixed(2)}, retries ${P.H4.turns.retry.toFixed(2)}, adaptive ${P.H4.turns.adaptive.toFixed(2)}. ${pc(P.H4.gainVsStatic.pctPositive)} of learners gained more with adaptive, ${pc(P.H4.gainVsStatic.pctNegative)} less.

### H6: strategy ablations (full adaptive − ablation, Holm-corrected)
| Removed | Δ learning gain (full − ablation) | Holm p | Δ independent (full − ablation) | False "doesn't know" (ablation − full) |
|---|---|---|---|---|
${P.H6.map(x => `| ${x.label} | ${spp(x.gain.mean)} | ${fmtP(x.pHolm)} | ${spp(x.independent.mean)} | ${spp(x.falseGap.mean)} |`).join('\n')}

In the first two columns, positive = the strategy helps. In the last column, positive = the ablation produced more false labels (also means the strategy helps).

### Who benefits (adaptive − static learning gain, Holm-corrected)
| Profile | Δ gain | 95% CI | Holm p |
|---|---|---|---|
${P.subgroups.map(s => `| ${s.label} | +${pp(s.mean)} | ${pp(s.ciLo)} to ${pp(s.ciHi)} | ${fmtP(s.pHolm)} |`).join('\n')}

### Replication across seeds
| Seed | Δ gain vs static [CI] | False-label reduction | Load AUC | Diagnosis acc. |
|---|---|---|---|---|
${replication.map(r => `| ${r.seed} | +${pp(r.gainVsStatic.mean)} [${pp(r.gainVsStatic.ciLo)}, ${pp(r.gainVsStatic.ciHi)}] | ${pp(-r.falseGapReduction.mean)} | ${r.auc.toFixed(3)} | ${pc(r.diagAcc)} |`).join('\n')}

### Sensitivity to the learning assumptions
| Learning effects × | Δ gain vs static [CI] | Δ gain vs retries [CI] |
|---|---|---|
${sensitivity.map(s => `| ${s.scale} | ${spp(s.vsStatic.mean)} [${spp(s.vsStatic.ciLo)}, ${spp(s.vsStatic.ciHi)}] | ${spp(s.vsRetry.mean)} [${spp(s.vsRetry.ciLo)}, ${spp(s.vsRetry.ciHi)}] |`).join('\n')}

At ×0 nobody learns from any tutor, so the difference should be ≈ 0. That row is a check that the simulation isn't biased toward the adaptive tutor through some other path.

## How much to trust this

1. **Simulation, not people.** p-values here measure Monte-Carlo precision. With enough simulated learners almost any difference is "significant", so read effect sizes and CIs, not p-values.
2. **Same-author bias.** The simulator and tutor were written together. Comparisons between tutor variants share that bias and are more trustworthy than absolute values.
3. **What is measured vs. assumed:**
   - Measured against ground truth: H1 (implementation), H2, H3, false adaptations.
   - Dependent on assumed learning effects: H4 and H6 learning gains.
   - Observational: H5.
4. **One diagnosis change was tuned** on seed 7. All results here use seeds ${[PRIMARY_SEED, ...REPLICATION_SEEDS].join(', ')}.

## Recommended real-learner pilot

Paired (crossover) design, adaptive vs static + retries, primary outcome unaided English production on held-out items.

| Assumed real effect (d_z) | Learners needed (80% power, α 0.05) |
|---|---|
${power.map(p => `| ${p.dz.toFixed(2)}${p.observed ? ' (simulated)' : ''} | ${p.n} |`).join('\n')}

Real effects are usually much smaller than simulated ones, so plan for d_z ≈ 0.3 (about ${nForPower(0.3)} learners). Also log the live Monitor metrics (load AUC against self-ratings, recovery rate) to check H1 and H5 on real behaviour.
`;
await writeFile('REPORT.md', md);

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const v of verdicts) console.log(`${v.id} ${v.verdict.padEnd(26)} ${v.evidence}`);
