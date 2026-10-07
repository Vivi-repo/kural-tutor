// Evaluation view: results of the synthetic-learner experiment (sim/run.mjs).
import { esc, pct, fix } from './charts.js';

const pp = x => x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pp`;
const kpi = (label, val, sub, hero = false, tip = '') => `<div class="kpi ${hero ? 'hero' : ''}" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;
const BOTT = ['KNOWLEDGE', 'RETRIEVAL', 'EXPRESSION', 'L1_TRANSFER', 'OVERLOAD', 'MISUNDERSTANDING'];
const ORDER = ['static', 'staticRetry', 'adaptive', 'noHold', 'noProbe', 'englishOnly', 'ladder'];

function heat(v, max) {
  const a = max ? Math.max(0, Math.min(1, v / max)) : 0;
  return `background:color-mix(in srgb, var(--series-1) ${Math.round(a * 85)}%, var(--surface));color:${a > 0.55 ? '#fff' : 'var(--ink)'}`;
}

function prePost(res) {
  const rows = ORDER.filter(k => res.byCond[k]).map(k => {
    const c = res.byCond[k];
    return `<div class="db-row"><span>${esc(c.label)}</span><span class="db-track">
      <span class="db-line" style="left:${c.pre.mean * 100}%;width:${(c.post.mean - c.pre.mean) * 100}%"></span>
      <span class="db-dot" style="left:${c.pre.mean * 100}%;background:var(--ink-3)" data-tip="Pre-test: ${pct(c.pre.mean, 1)}"></span>
      <span class="db-dot" style="left:${c.post.mean * 100}%;background:var(--series-1)" data-tip="Post-test: ${pct(c.post.mean, 1)} ± ${pct(c.post.ci, 1)}"></span></span>
      <span class="db-val">${pp(c.gain.mean)}</span></div>`;
  }).join('');
  return `<div class="dumbbell">${rows}</div><div class="legend"><span><span class="sw" style="background:var(--ink-3)"></span>Pre-test</span><span><span class="sw" style="background:var(--series-1)"></span>Post-test</span><span>Independent English production on 2 unseen items per concept · axis 0–100%</span></div>`;
}

export async function renderEval(el) {
  let res;
  try { res = await (await fetch('eval/results.json', { cache: 'no-cache' })).json(); }
  catch { el.innerHTML = '<h2>Evaluation</h2><p class="empty">No results yet. Run <code>npm run sim</code> to generate public/eval/results.json.</p>'; return; }
  const m = res.meta, S = res.byCond.static, R = res.byCond.staticRetry, A = res.byCond.adaptive;

  const head = `<div class="dash-head"><div><h2>Evaluation: synthetic learners</h2>
    <div class="small muted">${m.learners} simulated Tamil-speaking learners (${Object.keys(m.archetypes).length} profiles × ${m.perArchetype}) · ${m.tasks} tasks · ${Object.keys(m.conditions).length} tutor conditions · paired design (every learner meets every tutor) · held-out seed ${m.seed} · generated ${new Date(m.generatedAt).toLocaleString()}</div></div></div>
    <div class="note" style="margin:0 0 14px"><b>How to read this.</b> Diagnosis, mislabelling, false-adaptation and load numbers are measured against the simulator's hidden ground truth. They test whether the system <i>does what it claims</i> on realistic, noisy input.
    <b>Learning-gain numbers depend on modelled learning effects</b> (listed at the bottom), so treat them as a hypothesis to test with real learners, not as evidence. The simulator and tutor were written together, which favours the tutor; the ablations and baselines share that bias, so the comparisons between them are more trustworthy than the absolute values.</div>`;

  const headline = `<div class="kpis">
    ${kpi('Learning gain vs static', pp(A.diffVsStatic.mean), `95% CI ±${(A.diffVsStatic.ci * 100).toFixed(1)} pp · ${pct(A.diffVsStatic.pctImproved)} of learners improved`, true, 'Paired difference in pre→post gain, adaptive minus static, same learners. Depends on modelled learning effects.')}
    ${kpi('Wrongly labelled "doesn\'t know"', `${pct(S.gapMislabel)} → ${pct(A.gapMislabel)}`, 'static → adaptive, among concepts the learner actually knows', true, 'P(tutor concludes a knowledge gap | learner actually knows the concept). Measured against ground truth.')}
    ${kpi('Independent English in session', `${pct(S.independent)} → ${pct(A.independent)}`, 'tasks finished with unaided correct English', true)}
    ${kpi('Bottleneck diagnosis accuracy', pct(A.diagAcc), `6-way (chance ≈ 17%) · ${pct(A.uncertainRate)} deferred as "uncertain"`, false, 'On failed answers with a known cause, when the system committed to a diagnosis.')}
    ${kpi('Learning per 10 turns', `${fix(S.gainPer10Turns * 100, 1)} → ${fix(A.gainPer10Turns * 100, 1)} pp`, `static → adaptive · ${fix(S.turnsPerTask, 1)} vs ${fix(A.turnsPerTask, 1)} turns/task`, false, 'Efficiency check: the adaptive tutor uses more turns; this normalises for time.')}
    ${kpi('False adaptations on fluent learners', pct(A.falseAdapt), `slow-but-fluent: ${pct(A.falseAdaptSlow)} · tasks answered right first time`, false, 'Did the tutor add support when the learner was already correct? Slow typists test the personal-baseline calibration.')}
  </div>`;

  const conds = ORDER.filter(k => res.byCond[k]);
  const ablRows = conds.map(k => {
    const c = res.byCond[k];
    const dFull = c.gain.mean - A.gain.mean;
    return `<tr${k === 'adaptive' ? ' style="font-weight:600"' : ''}><td>${esc(c.label)}<div class="small faint">${esc(c.desc)}</div></td>
      <td class="num">${pp(c.gain.mean)} <span class="faint">±${(c.gain.ci * 100).toFixed(1)}</span></td>
      <td class="num">${k === 'adaptive' ? '—' : pp(dFull)}</td>
      <td class="num">${pct(c.independent)}</td><td class="num">${fix(c.turnsPerTask, 2)}</td><td class="num">${fix(c.gainPer10Turns * 100, 1)}</td>
      <td class="num">${pct(c.gapMislabel)}</td><td class="num">${pct(c.diagAcc)}</td></tr>`;
  }).join('');

  const ab = k => res.byCond[k] ? res.byCond[k].gain.mean - A.gain.mean : null;
  const findings = [
    `<b>The diagnosis is what drives the benefit.</b> The "ladder" tutor (more support after each failure, ignoring <i>why</i> it failed) gets ${pp(res.byCond.ladder?.gain.mean)} learning vs ${pp(A.gain.mean)} for full adaptive, uses more turns, and labels more known concepts as gaps (${pct(res.byCond.ladder?.gapMislabel)}).`,
    `<b>Measuring "knows it" vs "can say it" is the strongest, least assumption-dependent result.</b> A static tutor marks ${pct(S.gapMislabel)} of concepts the learner actually knows as "doesn't know"; adaptive marks ${pct(A.gapMislabel)}. Adding retries to the static tutor doesn't help (${pct(R.gapMislabel)}).`,
    `<b>Tamil channels mainly help learners finish in English, not learn more (in this model).</b> Removing clarification, code-switching, word bridges and bilingual contrast changes independent completion by ${pp(res.byCond.englishOnly.independent - A.independent)} but learning gain by only ${pp(ab('englishOnly'))}, because the English-only fallback (explicit teaching) also closes gaps here. Benefits the model leaves out, such as lower anxiety and understanding the question, are where Tamil channels should prove themselves with real learners.`,
    `<b>The recognition probe doesn't pay for itself here.</b> Removing it changes gain by ${pp(ab('noProbe'))}, raises independent completion to ${pct(res.byCond.noProbe.independent)}, and uses fewer turns. Probing costs a turn, and on noisy learners a wrong multiple-choice pick can wrongly "confirm" a gap. Worth narrowing it to cases where a knowledge gap is genuinely plausible.`,
    `<b>Hysteresis (holding mode after one calm mistake) is roughly neutral for learning</b> (removing it: ${pp(ab('noHold'))}). Its "next answer succeeds" rate is the lowest of any strategy (${pct(res.rules.find(r => r.rule === 'R4-HOLD')?.nextSuccess)}). Its value is in avoiding needless switches, not in teaching.`,
    `<b>Biggest weakness: stepping straight back to English-only.</b> After a supported success, the unaided re-check succeeds only ${pct(res.rules.find(r => r.rule === 'R3-STEP-DOWN')?.nextSuccess)} of the time, and ${res.rules.find(r => r.rule === 'R16-CAP')?.n} tasks hit the attempt cap. Fading support gradually (keyword only → starter only → none) is the most promising next change.`,
    `<b>Diagnosis confusions are concentrated where you'd expect:</b> retrieval vs overload (both look like slow, hesitant answers) and knowledge vs transfer (both produce wrong forms quickly). The "uncertain → probe" fallback catches ${pct(A.uncertainRate)} of cases.`,
  ];

  const rules = res.rules.filter(r => r.nextSuccess != null);
  const maxN = Math.max(...rules.map(r => r.n));
  const ruleRows = rules.sort((a, b) => b.nextSuccess - a.nextSuccess).map(r => `<tr><td><span class="decision-rule">${esc(r.rule)}</span></td><td>${esc(r.text)}</td>
    <td class="num">${r.n}</td><td><div class="barrow" style="grid-template-columns:1fr 48px"><span class="track"><span class="bar" style="width:${r.nextSuccess * 100}%"></span></span><span class="val">${pct(r.nextSuccess)}</span></div></td></tr>`).join('');

  const conf = res.confusion;
  const cols = [...BOTT, 'UNCERTAIN'];
  const confRows = BOTT.filter(t => conf[t]).map(t => {
    const tot = cols.reduce((s, c) => s + (conf[t][c] || 0), 0);
    return `<tr><th style="text-align:left">${esc(m.bottlenecks[t])}</th>${cols.map(c => { const v = (conf[t][c] || 0) / tot; return `<td class="num" style="${heat(v, 0.8)};text-align:center;${c === t ? 'outline:2px solid var(--ink);outline-offset:-2px' : ''}" data-tip="${esc(`Truth: ${m.bottlenecks[t]}\nDiagnosed: ${m.bottlenecks[c] || 'Uncertain'}\n${conf[t][c] || 0} of ${tot} answers`)}">${pct(v)}</td>`; }).join('')}<td class="num faint">${tot}</td></tr>`;
  }).join('');

  const archRows = Object.entries(res.archetypes).map(([k, a]) => {
    const vals = conds.map(c => a.byCond[c]?.gain ?? null);
    return `<tr><td>${esc(a.label)}</td>${vals.map(v => `<td class="num" style="${heat(v ?? 0, 0.35)};text-align:center">${pp(v)}</td>`).join('')}<td class="num">${pct(a.byCond.static.gapMislabel)} → ${pct(a.byCond.adaptive.gapMislabel)}</td></tr>`;
  }).join('');

  const sens = res.sensitivity;
  const sensRows = [['0.5', sens['0.5']], ['1 (main)', { adaptive: { diffVsStatic: A.diffVsStatic }, staticRetry: { diffVsStatic: R.diffVsStatic } }], ['1.5', sens['1.5']]].map(([f, s]) =>
    `<tr><td>× ${f}</td><td class="num">${pp(s.staticRetry.diffVsStatic.mean)}</td><td class="num"><b>${pp(s.adaptive.diffVsStatic.mean)}</b> <span class="faint">±${(s.adaptive.diffVsStatic.ci * 100).toFixed(1)}</span></td></tr>`).join('');

  const eff = m.effects;
  const effList = `<ul class="evidence">
    <li>Explicit teaching closes a true knowledge gap with p=${eff.teachK.explicit}; bilingual explanation ${eff.teachK.bilingual}; keyword cue ${eff.teachK.keyword}; showing the model answer (static) ${eff.teachK.reveal}.</li>
    <li>Tamil-transfer tendency is multiplied by ${eff.transferMult.bilingual} after a bilingual contrast, ${eff.transferMult.explicit} after explicit teaching, ${eff.transferMult.reveal} after a model answer, ${eff.transferMult.retry} after "try again".</li>
    <li>A missing-English-word gap closes with p=${eff.closeLexical.bridge} after a Tamil→English word bridge, ${eff.closeLexical.explicit} after explicit teaching, ${eff.closeLexical.reveal} after a model answer.</li>
    <li>Retrieval strength rises +${eff.retrieval.successEnglish} per correct unaided answer, +${eff.retrieval.successAfterStruggle} more if it followed a struggle (testing effect), +${eff.retrieval.successSupported} per supported success.</li>
    <li>Clarifying a question in Tamil raises comprehension of later English prompts by +${eff.comprehension.clarify}.</li>
    <li>Static and adaptive tutors get exactly the same effect sizes for the same action; the sensitivity table scales all of them.</li></ul>`;

  el.innerHTML = head + headline +
    `<div class="section-title"><h2>How much did it improve learning?</h2><p>Pre-test → post-test, unaided English, same learners under every tutor.</p></div>
     <div class="grid-2"><div class="card"><h3>Pre → post by tutor</h3>${prePost(res)}</div>
     <div class="card"><h3>Sensitivity to the learning assumptions <span class="hint">Δ gain vs static tutor</span></h3>
       <div class="table-wrap"><table class="data"><thead><tr><th>Learning effects scaled</th><th>Static + retries</th><th>Adaptive</th></tr></thead><tbody>${sensRows}</tbody></table></div>
       <p class="note">The adaptive advantage shrinks when interventions are assumed to be weaker, but stays positive. The direction holds; the size is an assumption.</p></div></div>
     <div class="section-title"><h2>Which strategies helped?</h2><p>Ablations: the full adaptive tutor with one strategy removed.</p></div>
     <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Tutor</th><th>Learning gain</th><th>vs full adaptive</th><th>Independent English</th><th>Turns / task</th><th>Gain per 10 turns</th><th>False "doesn't know"</th><th>Diagnosis acc.</th></tr></thead><tbody>${ablRows}</tbody></table></div></div>
     <div class="card" style="margin-top:12px"><h3>Findings</h3><ul class="evidence" style="font-size:13.5px">${findings.map(f => `<li style="margin:6px 0">${f}</li>`).join('')}</ul></div>
     <div class="grid-2" style="margin-top:12px">
       <div class="card"><h3>Strategy effectiveness <span class="hint">P(next answer in the task succeeds | rule fired)</span></h3><div class="table-wrap"><table class="data"><thead><tr><th>Rule</th><th>Strategy</th><th>Fired</th><th style="min-width:140px">Next answer succeeds</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
         <p class="note">Not causal on its own: rules fire in different situations. Recognition-based rules look strong partly because picking from options is easier than producing. The ablation table is the causal comparison.</p></div>
       <div class="card"><h3>Diagnosis vs ground truth <span class="hint">row-normalised · full adaptive</span></h3><div class="table-wrap"><table class="data"><thead><tr><th>True cause ↓ / diagnosed →</th>${cols.map(c => `<th style="text-align:center">${esc((m.bottlenecks[c] || 'Uncertain').split(' ')[0])}</th>`).join('')}<th>n</th></tr></thead><tbody>${confRows}</tbody></table></div>
         <p class="note">Outlined cells = correct. ${m.tuning ? esc(m.tuning.note) + ` On the tuning seed this raised accuracy from ${pct(m.tuning.diagAccBefore, 1)} to ${pct(m.tuning.diagAccAfter, 1)}.` : ''}</p></div>
     </div>
     <div class="section-title"><h2>Who does it help?</h2><p>Learning gain by learner profile. Every profile has noise: typos, slips, random Tamil words, skipping, hint spam, inconsistent typing speed.</p></div>
     <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Profile</th>${conds.map(c => `<th style="text-align:center">${esc(res.byCond[c].label)}</th>`).join('')}<th>False "doesn't know": static → adaptive</th></tr></thead><tbody>${archRows}</tbody></table></div></div>
     <div class="grid-2" style="margin-top:12px">
       <div class="card"><h3>Does the load estimate track struggle?</h3><div class="kpis">
         ${kpi('Load AUC', fix(A.loadAuc), 'struggling vs calm-correct answers')}
         ${kpi('Mean load', `${fix(A.loadStruggle)} / ${fix(A.loadCalm)}`, 'struggling / calm')}
         ${kpi('vs self-rating', A.rho == null ? '—' : `ρ ${fix(A.rho)}`, 'Spearman, noisy synthetic ratings')}</div>
         <p class="note">Optimistic by construction: the simulator makes struggling learners type slower and hesitate more, which is exactly what the estimator measures. This checks the implementation. Whether real Tamil learners behave this way is the first thing to test with people.</p></div>
       <div class="card"><h3>Modelled learning assumptions</h3>${effList}</div>
     </div>
     <p class="small faint" style="margin-top:16px">Reproduce: <code>npm run sim</code> (seed ${m.seed}, ${m.perArchetype} learners per profile). Source: sim/learner.mjs, sim/bank.mjs, sim/run.mjs.</p>`;
}
