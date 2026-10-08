// Hypothesis-validation report (renders public/eval/stats.json from sim/stats.mjs).
import { esc, pct, fix } from './charts.js';

const pp = x => x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pp`;
const fmtP = p => p == null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3);
const verdictPill = v => `<span class="pill ${v.startsWith('Supported') ? 'ok' : v.startsWith('Partially') ? 'neutral' : 'bad'}">${esc(v)}</span>`;

// Forest plot: one row per item, point estimate with CI, zero line.
function forest(rows, { min, max, fmt = pp }) {
  const W = 1000, rowH = 30, L = 260, Rr = 90, H = rows.length * rowH + 30;
  const x = v => L + ((v - min) / (max - min)) * (W - L - Rr);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Effect estimates with 95% confidence intervals">`;
  s += `<line x1="${x(0)}" x2="${x(0)}" y1="4" y2="${H - 22}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>`;
  for (const t of [min, (min + max) / 2, max]) s += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${fmt(t)}</text>`;
  rows.forEach((r, i) => {
    const y = 18 + i * rowH;
    s += `<text x="${L - 10}" y="${y + 4}" text-anchor="end" class="axis-label">${esc(r.label)}</text>`;
    s += `<line x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${y}" y2="${y}" stroke="var(--series-1)" stroke-width="2"/>`;
    s += `<circle cx="${x(r.est)}" cy="${y}" r="5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<text x="${W - Rr + 8}" y="${y + 4}" class="axis-label">${fmt(r.est)}</text>`;
    s += `<rect class="hit" x="${L}" y="${y - 12}" width="${W - L - Rr}" height="24" data-tip="${esc(`${r.label}\n${fmt(r.est)} (95% CI ${fmt(r.lo)} to ${fmt(r.hi)})${r.p != null ? `\np ${fmtP(r.p)}` : ''}`)}"/>`;
  });
  return `<div class="chart-wrap">${s}</svg></div>`;
}

export async function renderReport(el) {
  let s;
  try { s = await (await fetch('eval/stats.json', { cache: 'no-cache' })).json(); }
  catch { el.innerHTML = '<h2>Report</h2><p class="empty">No stats yet. Run <code>npm run stats</code>.</p>'; return; }
  const P = s.primary, BN = s.meta.bottlenecks;
  const supported = s.verdicts.filter(v => v.verdict.startsWith('Supported')).length;

  const head = `<div class="dash-head"><div><h2>Hypothesis validation report</h2>
    <div class="small muted">${s.meta.learnersPerSeed} synthetic learners per seed · primary seed ${s.meta.primarySeed}, replicated on ${s.meta.replicationSeeds.join(', ')} · ${s.meta.bootstrap.toLocaleString()} bootstrap resamples · generated ${new Date(s.meta.generatedAt).toLocaleString()}</div></div></div>
    <div class="card prose" style="max-width:none"><h3>Research question</h3>
    <p style="margin:0 0 8px"><i>Can behavioural signals distinguish a learner's underlying knowledge from their ability to express it in English, and can adaptive communication reduce the cognitive load of producing it?</i></p>
    <p style="margin:0"><b>${supported} of ${s.verdicts.length} hypotheses are supported in simulation.</b> The core claim (H2: telling "doesn't know" apart from "can't say it") holds strongly against ground truth. The learning-gain result (H4) is consistent and robust, but its size rests on modelled learning effects. Not every strategy earns its place (H6). Everything here is synthetic: it shows the system behaves as designed and tells you what to test with real learners. It is not evidence about real learners.</p></div>`;

  const verdicts = `<div class="section-title"><h2>Verdicts</h2><p>Supported = predicted direction, 95% CI excludes no-effect, replicated in all 5 seeds, and (for learning) robust to halving the learning assumptions.</p></div>
    <div class="verdicts">${s.verdicts.map(v => `<div class="verdict"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="vid">${v.id}</span>${verdictPill(v.verdict)}</div>
      <div class="claim">${esc(v.claim)}</div><span class="ev">${esc(v.evidence)}</span><div class="cav">${esc(v.caveat)}</div></div>`).join('')}</div>`;

  const H2 = P.H2;
  const h2 = `<div class="section-title"><h2>H2 · Knowledge vs expression</h2><p>The core claim, scored against each simulated learner's true knowledge.</p></div>
    <div class="grid-2"><div class="card"><div class="table-wrap"><table class="data"><thead><tr><th></th><th>Static tutor</th><th>Adaptive</th></tr></thead><tbody>
      <tr><td>False "doesn't know" (learner knows it)</td><td class="num">${pct(H2.falseGapStatic.p, 1)} <span class="faint">[${pct(H2.falseGapStatic.lo, 1)}–${pct(H2.falseGapStatic.hi, 1)}]</span></td><td class="num"><b>${pct(H2.falseGapAdaptive.p, 1)}</b> <span class="faint">[${pct(H2.falseGapAdaptive.lo, 1)}–${pct(H2.falseGapAdaptive.hi, 1)}]</span></td></tr>
      <tr><td>Recall of genuine gaps</td><td class="num">${pct(H2.recallStatic.p, 1)}</td><td class="num">${pct(H2.recallAdaptive.p, 1)}</td></tr>
      <tr><td>Precision of "doesn't know" labels</td><td class="num">${pct(H2.precisionStatic.p, 1)}</td><td class="num"><b>${pct(H2.precisionAdaptive.p, 1)}</b></td></tr>
    </tbody></table></div>
    <p class="note">McNemar on paired labels: b=${H2.mcnemarFalseGap.b}, c=${H2.mcnemarFalseGap.c}, χ² ${fix(H2.mcnemarFalseGap.chi2, 1)}, p ${fmtP(H2.mcnemarFalseGap.p)}. Learner-level: mean ${pp(H2.learnerLevel.mean)} (CI ${pp(H2.learnerLevel.ciLo)} to ${pp(H2.learnerLevel.ciHi)}), Wilcoxon p ${fmtP(H2.learnerLevel.pWilcoxon)}.</p></div>
    <div class="card"><h3>The trade-off</h3><p class="prose" style="margin:0">The adaptive tutor is far more careful about calling something a gap: when it says "doesn't know", it is right ${pct(H2.precisionAdaptive.p)} of the time (static: ${pct(H2.precisionStatic.p)}). The cost is that it misses more genuine gaps (recall ${pct(H2.recallStatic.p)} → ${pct(H2.recallAdaptive.p)}), mostly when a learner who doesn't know a rule recovers through guided practice. For teaching that's fine, because the learner still ends up producing the form. For assessment or placement, tune toward recall.</p></div></div>`;

  const H4 = P.H4;
  const effects = [
    { label: 'Learning gain vs static', est: H4.gainVsStatic.mean, lo: H4.gainVsStatic.ciLo, hi: H4.gainVsStatic.ciHi, p: H4.gainVsStatic.p },
    { label: 'Learning gain vs static + retries', est: H4.gainVsRetry.mean, lo: H4.gainVsRetry.ciLo, hi: H4.gainVsRetry.ciHi, p: H4.gainVsRetry.p },
    { label: 'Independent English vs static', est: H4.independentVsStatic.mean, lo: H4.independentVsStatic.ciLo, hi: H4.independentVsStatic.ciHi, p: H4.independentVsStatic.p },
    { label: 'Independent English vs retries', est: H4.independentVsRetry.mean, lo: H4.independentVsRetry.ciLo, hi: H4.independentVsRetry.ciHi, p: H4.independentVsRetry.p },
    ...P.H6.map(x => ({ label: x.key === 'ladder' ? 'Diagnosis (vs blind ladder)' : `${x.label.replace('− ', '')} (keep vs remove)`, est: x.gain.mean, lo: x.gain.ciLo, hi: x.gain.ciHi, p: x.pHolm })),
  ];
  const h4 = `<div class="section-title"><h2>H4 / H6 · Learning and strategies</h2><p>Per-learner paired differences with bootstrap 95% CIs. Strategy rows use Holm-corrected p.</p></div>
    <div class="card">${forest(effects, { min: -0.1, max: 0.4 })}
    <p class="note">d_z vs static ${fix(H4.gainVsStatic.dz)} · ${pct(H4.gainVsStatic.pctPositive)} of learners gained more with adaptive, ${pct(H4.gainVsStatic.pctNegative)} less · turns per task: static ${fix(H4.turns.static)}, retries ${fix(H4.turns.retry)}, adaptive ${fix(H4.turns.adaptive)}. The recognition-probe row sits left of zero: removing the probe <b>improves</b> learning (Holm p ${fmtP(P.H6.find(x => x.key === 'noProbe').pHolm)}).</p></div>`;

  const sens = `<div style="margin-top:12px;display:flex;flex-direction:column;gap:12px">
    <div class="card"><h3>Sensitivity to the learning assumptions <span class="hint">Δ gain vs static</span></h3>${forest(s.sensitivity.map(x => ({ label: `effects × ${x.scale}`, est: x.vsStatic.mean, lo: x.vsStatic.ciLo, hi: x.vsStatic.ciHi, p: x.vsStatic.p })), { min: -0.05, max: 0.25 })}
      <p class="note">At ×0 (no tutor teaches anything) the difference is exactly zero, so nothing else in the simulation favours the adaptive tutor. The advantage scales with how much teaching actually works.</p></div>
    <div class="card"><h3>Replication across seeds <span class="hint">Δ gain vs static</span></h3>${forest(s.replication.map(r => ({ label: `seed ${r.seed}`, est: r.gainVsStatic.mean, lo: r.gainVsStatic.ciLo, hi: r.gainVsStatic.ciHi, p: r.gainVsStatic.p })), { min: -0.05, max: 0.25 })}
      <div class="table-wrap"><table class="data"><thead><tr><th>Seed</th><th>False-label reduction</th><th>Load AUC</th><th>Diagnosis acc.</th><th>Ladder penalty</th></tr></thead><tbody>
      ${s.replication.map(r => `<tr><td>${r.seed}</td><td class="num">${pp(-r.falseGapReduction.mean)}</td><td class="num">${fix(r.auc, 3)}</td><td class="num">${pct(r.diagAcc, 1)}</td><td class="num">${pp(-r.ladder)}</td></tr>`).join('')}</tbody></table></div></div></div>`;

  const H3 = P.H3, H1 = P.H1, H5 = P.H5;
  const other = `<div class="section-title"><h2>H1 · H3 · H5 · Signals, diagnosis, load</h2></div>
    <div class="grid-2">
      <div class="card"><h3>H3 · Diagnosis per bottleneck</h3><div class="table-wrap"><table class="data"><thead><tr><th>Bottleneck</th><th>Precision</th><th>Recall</th><th>F1</th><th>n</th></tr></thead><tbody>
        ${H3.perClass.map(c => `<tr><td>${esc(BN[c.cls])}</td><td class="num">${pct(c.precision)}</td><td class="num">${pct(c.recall)}</td><td class="num">${fix(c.f1)}</td><td class="num">${c.support}</td></tr>`).join('')}</tbody></table></div>
        <p class="note">Accuracy ${pct(H3.accuracy, 1)} (cluster-bootstrap CI ${pct(H3.ciLo, 1)}–${pct(H3.ciHi, 1)}) vs chance 16.7% and always-guess-the-commonest ${pct(H3.majority, 1)}. κ ${fix(H3.kappa)}, macro-F1 ${fix(H3.macroF1)}. ${pct(H3.uncertainRate)} of failed answers deferred as uncertain.</p></div>
      <div class="card"><h3>H1 · Signals track struggle</h3><div class="kpis">
        <div class="kpi"><div class="k-label">Load AUC</div><div class="k-val">${fix(H1.auc, 3)}</div><div class="k-sub">CI ${fix(H1.ciLo, 3)}–${fix(H1.ciHi, 3)} · n ${H1.n1} / ${H1.n2}</div></div>
        <div class="kpi"><div class="k-label">Mean load</div><div class="k-val">${fix(H1.meanStruggle)} / ${fix(H1.meanCalm)}</div><div class="k-sub">struggling / calm</div></div></div>
        <h3 style="margin-top:14px">H5 · Load after adapting</h3><div class="kpis">
        <div class="kpi"><div class="k-label">After a mode switch</div><div class="k-val">${fix(H5.adapt.mean)}</div><div class="k-sub">change in load, next answer</div></div>
        <div class="kpi"><div class="k-label">After holding the mode</div><div class="k-val">${fix(H5.hold.mean)}</div><div class="k-sub">control</div></div>
        <div class="kpi"><div class="k-label">Difference</div><div class="k-val">${fix(H5.adaptMinusHold.mean)}</div><div class="k-sub">CI ${fix(H5.adaptMinusHold.ciLo)} to ${fix(H5.adaptMinusHold.ciHi)}</div></div></div>
        <p class="note">Both are optimistic by construction: the simulator encodes the behaviour the estimator looks for. Validate them first on real learners with the live Monitor (load AUC, load vs self-rating).</p></div>
    </div>`;

  const subs = `<div class="section-title"><h2>Who benefits</h2><p>Adaptive − static learning gain by profile, Holm-corrected across 11 profiles.</p></div>
    <div class="card">${forest(P.subgroups.map(g => ({ label: g.label, est: g.mean, lo: g.ciLo, hi: g.ciHi, p: g.pHolm })), { min: -0.1, max: 0.45 })}</div>`;

  const power = `<div class="grid-2" style="margin-top:12px">
    <div class="card"><h3>Planning the real-learner pilot</h3><p class="prose" style="margin:0 0 8px">Crossover design, adaptive vs static + retries, primary outcome unaided English on held-out items. Learners needed for 80% power at α = 0.05:</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Assumed real effect (d_z)</th><th>Learners</th></tr></thead><tbody>${s.power.map(p => `<tr><td>${fix(p.dz)}${p.observed ? ' <span class="pill neutral">simulated</span>' : ''}</td><td class="num">${p.n}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Real effects are usually much smaller than simulated ones. Plan for d_z ≈ 0.3 (≈ ${s.power.find(p => p.dz === 0.3)?.n} learners).</p></div>
    <div class="card"><h3>How much to trust this</h3><ul class="evidence prose" style="font-size:13px">
      <li><b>Simulation, not people.</b> With enough simulated learners almost anything is "significant". Read effect sizes and CIs; the p-values only show the Monte-Carlo noise is small.</li>
      <li><b>Same-author bias.</b> Simulator and tutor were written together. Comparisons between tutor variants (ablations, baselines) share the bias and are more trustworthy than absolute numbers.</li>
      <li><b>Measured vs assumed.</b> H2, H3 and false adaptations are scored against ground truth. H4/H6 learning sizes depend on modelled learning effects. H5 is observational.</li>
      <li><b>Tuning hygiene.</b> One diagnosis change was tuned on seed 7. Every number here comes from other seeds.</li>
      <li><b>Unit of analysis is the learner</b>, with paired tests, cluster bootstrap for turn-level metrics, and Holm correction within each family.</li></ul></div></div>
    <p class="small faint" style="margin-top:16px">Reproduce: <code>npm run stats</code> (≈1 min). Full tables: REPORT.md in the repository.</p>`;

  el.innerHTML = head + verdicts + h2 + h4 + sens + other + subs + power;
}
