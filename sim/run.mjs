// Synthetic evaluation of Kural.
//   node sim/run.mjs [--per 36] [--seed 7] [--out public/eval/results.json]
//
// Every synthetic learner is cloned and run through every condition with common random
// numbers (identical pre-test, identical post-test draws), so condition differences are paired.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Session } from '../public/js/engine.js';
import { TASKS, TASK, BOTTLENECK_IDS, BOTTLENECKS } from '../public/js/content.js';
import { grade } from '../public/js/lang.js';
import { simulate } from '../public/js/demo.js';
import { RULES, dominant } from '../public/js/policy.js';
import { auc, spearman } from '../public/js/metrics.js';
import { ARCHETYPES, EFFECTS, scaleEffects, makeLearner, cloneLearner, respond, learn, rng, selfRating } from './learner.mjs';
import { BANK } from './bank.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PER = Number(arg('--per', 36)), SEED = Number(arg('--seed', 7)), OUT = arg('--out', 'public/eval/results.json');
const TASK_IDS = TASKS.map(t => t.id);
const TEST_ITEMS = 2;

export const CONDITIONS = {
  static:      { label: 'Static tutor', kind: 'static', attempts: 1, desc: 'One English attempt; wrong → show model answer.' },
  staticRetry: { label: 'Static + retries', kind: 'static', attempts: 3, desc: 'Up to 3 "try again" attempts, then the model answer. Time-matched baseline.' },
  adaptive:    { label: 'Adaptive (full)', kind: 'adaptive', opts: {}, desc: 'Load + diagnosis + all strategies.' },
  noHold:      { label: '− hysteresis', kind: 'adaptive', opts: { noHold: true }, desc: 'Switches mode on the first calm mistake.' },
  noProbe:     { label: '− recognition probe', kind: 'adaptive', opts: { noProbe: true }, desc: 'Never tests knowledge with multiple choice.' },
  englishOnly: { label: '− Tamil channels', kind: 'adaptive', opts: { englishOnly: true }, desc: 'No Tamil clarification, code-switching, word bridge or bilingual contrast.' },
  ladder:      { label: 'Ladder (no diagnosis)', kind: 'adaptive', opts: { ladder: true }, desc: 'Ignores the diagnosis: every failure climbs one rung.' },
};

// ---------- tests (pre / post): independent English, no support -----------------
function test(r, learner) {
  let ok = 0, n = 0;
  const per = {};
  for (const tid of TASK_IDS) {
    const task = TASK[tid];
    let k = 0;
    for (let i = 0; i < TEST_ITEMS; i++) {
      const resp = respond(r, learner, { task, mode: 'ENGLISH', awaiting: 'text', flags: { hints: 9, wordBank: false, keyword: false, contrasted: false, clarified: false } });
      const correct = resp.kind === 'text' && grade(task, resp.text, 'ENGLISH').correct;
      if (correct) { ok++; k++; }
      n++;
    }
    per[task.concept] = k / TEST_ITEMS;
  }
  return { rate: ok / n, per };
}

// ---------- static tutor ---------------------------------------------------------
function runStatic(learner, cond, r, effects) {
  const tasks = [];
  for (const tid of TASK_IDS) {
    const task = TASK[tid];
    const flags = { hints: 0, wordBank: false, keyword: false, contrasted: false, clarified: false };
    const rec = { taskId: tid, concept: task.concept, attempts: 0, turns: 0, hints: 0, first: null, solved: false, skipped: false, failures: 0 };
    while (true) {
      const resp = respond(r, learner, { task, mode: 'ENGLISH', awaiting: 'text', flags });
      rec.turns++;
      if (resp.kind === 'hint') { rec.hints++; learn(r, learner, task.concept, 'reveal', effects); break; } // static "help" = shows the answer
      if (resp.kind === 'skip') { rec.skipped = true; break; }
      rec.attempts++;
      const correct = grade(task, resp.text, 'ENGLISH').correct;
      if (rec.first == null) rec.first = correct;
      if (correct) { rec.solved = true; learn(r, learner, task.concept, 'successEnglish', effects); if (rec.failures) learn(r, learner, task.concept, 'successAfterStruggle', effects); break; }
      rec.failures++;
      if (rec.attempts < cond.attempts) { learn(r, learner, task.concept, 'retry', effects); continue; }
      learn(r, learner, task.concept, 'reveal', effects);
      break;
    }
    rec.gapLabel = rec.first !== true;
    tasks.push(rec);
  }
  return { tasks };
}

// ---------- adaptive tutor (the real engine) -------------------------------------
async function runAdaptive(learner, cond, r, effects) {
  const s = new Session({ learnerName: learner.id, taskIds: TASK_IDS, policyOpts: cond.opts });
  s.start();
  const log = [];
  let idx = -1, flags = null, guard = 0;
  while (s.awaiting !== 'done' && guard++ < 160) {
    if (s.idx !== idx) { idx = s.idx; flags = { hints: 0 }; }
    const task = TASK[s.taskIds[s.idx]], ts = s.ts;
    Object.assign(flags, { wordBank: !!ts.wordBank, keyword: ts.keywordShown, contrasted: ts.contrasted, clarified: ts.clarified });
    const resp = respond(r, learner, { task, mode: s.mode, awaiting: s.awaiting, flags });
    let out;
    if (resp.kind === 'hint') { flags.hints++; out = await s.submit({ kind: 'hint' }); }
    else if (resp.kind === 'skip') out = await s.submit({ kind: 'skip' });
    else if (resp.kind === 'choice') out = await s.submit({ kind: 'choice', choice: resp.choice, tel: { promptAt: 0, firstKeyAt: null, keys: [], submitAt: resp.wait } });
    else { const { text, tel } = simulate(resp.steps); out = await s.submit({ kind: 'text', text, tel }); }

    if (out.turn) {
      let cause = resp.cause;
      if (cause === 'NOISE?') cause = out.turn.correct ? null : 'NOISE';
      log.push({ cause, correct: out.turn.correct, kind: out.turn.kind, diag: out.turn.diag?.top ?? null, uncertain: out.turn.diag?.uncertain ?? null, load: out.turn.est.load, mode: out.turn.mode, rule: out.decision.rule, taskIndex: out.turn.taskIndex });
      if (out.turn.correct) {
        if (out.turn.mode === 'ENGLISH') { learn(r, learner, task.concept, 'successEnglish', effects); if (ts.failures) learn(r, learner, task.concept, 'successAfterStruggle', effects); }
        else learn(r, learner, task.concept, 'successSupported', effects);
      }
    }
    if (out.decision) learn(r, learner, task.concept, out.decision.action, effects);
    if (s.idx !== idx || s.awaiting === 'done') { const fin = s.tasks[idx]; s.rate(idx, selfRating(r, learner, fin.failures, fin.attempts)); }
  }
  const tasks = s.tasks.map(t => ({
    taskId: t.taskId, concept: t.concept, attempts: t.attempts, turns: s.turns.filter(x => x.taskIndex === t.index).length + t.hints, hints: t.hints,
    first: t.firstAttempt ? (t.firstAttempt.correct && t.firstAttempt.mode === 'ENGLISH') : null,
    solved: ['first-try', 'independent', 'recovered'].includes(t.outcome), skipped: t.outcome === 'skipped', outcome: t.outcome, maxRung: t.maxRung, modes: t.modes,
    gapLabel: t.knowledgeConfirmed || dominant(t) === 'KNOWLEDGE' || t.outcome === 'skipped',
    hidden: t.hiddenKnowledge, rating: t.selfRating, meanLoad: t.loads.length ? t.loads.reduce((a, b) => a + b, 0) / t.loads.length : null,
  }));
  for (const t of tasks) if (t.skipped) t.gapLabel = true;
  return { tasks, log, decisions: s.decisions, turns: s.turns };
}

// ---------- stats helpers ---------------------------------------------------------
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };
const ci = a => ({ mean: mean(a), ci: a.length > 1 ? 1.96 * sd(a) / Math.sqrt(a.length) : 0, n: a.length });
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;
const round = o => JSON.parse(JSON.stringify(o, (k, v) => typeof v === 'number' ? r3(v) : v));

// ---------- validate the response bank against the grader --------------------------
function checkBank() {
  const problems = [];
  for (const [tid, b] of Object.entries(BANK)) {
    const t = TASK[tid];
    for (const s of b.correct) if (!grade(t, s, 'ENGLISH').correct) problems.push(`${tid} correct rejected: ${s}`);
    for (const s of b.guidedCorrect) if (!grade(t, s, 'GUIDED').correct) problems.push(`${tid} guidedCorrect rejected: ${s}`);
    for (const k of ['knowledge', 'transfer', 'codeswitch', 'fragments', 'offtopic']) for (const s of b[k]) if (grade(t, s, 'ENGLISH').correct) problems.push(`${tid} ${k} accepted: ${s}`);
    for (const s of b.guidedWrong) if (grade(t, s, 'GUIDED').correct) problems.push(`${tid} guidedWrong accepted: ${s}`);
  }
  return problems;
}

// ---------- experiment ----------------------------------------------------------------
async function experiment({ effects, conditions, per, seed, collectDetail }) {
  const archKeys = Object.keys(ARCHETYPES);
  const rows = []; // one per learner × condition
  const logs = {}; const decisionsByCond = {};
  let id = 0;
  for (const a of archKeys) for (let i = 0; i < per; i++) {
    const lseed = seed * 100003 + id * 7919;
    const base = makeLearner(`L${id}`, a, lseed, TASK_IDS);
    id++;
    const truthK = Object.fromEntries(Object.entries(base.concepts).map(([c, v]) => [c, v.K]));
    const pre = test(rng(lseed + 1), cloneLearner(base));
    for (const ck of conditions) {
      const cond = CONDITIONS[ck];
      const learner = cloneLearner(base);
      const r = rng(lseed + 3);
      const res = cond.kind === 'static' ? runStatic(learner, cond, r, effects) : await runAdaptive(learner, cond, r, effects);
      const post = test(rng(lseed + 2), learner);
      rows.push({ learner: base.id, archetype: a, cond: ck, pre: pre.rate, post: post.rate, gain: post.rate - pre.rate, prePer: pre.per, postPer: post.per, truthK, tasks: res.tasks });
      if (collectDetail && res.log) { (logs[ck] ||= []).push(...res.log.map(l => ({ ...l, archetype: a }))); (decisionsByCond[ck] ||= []).push({ decisions: res.decisions, turns: res.turns, archetype: a }); }
    }
  }
  return { rows, logs, decisionsByCond };
}

function summarize(rows, logs, decisionsByCond) {
  const byCond = {};
  const staticRows = Object.fromEntries(rows.filter(r => r.cond === 'static').map(r => [r.learner, r]));
  for (const ck of Object.keys(CONDITIONS)) {
    const rs = rows.filter(r => r.cond === ck);
    if (!rs.length) continue;
    const tasks = rs.flatMap(r => r.tasks.map(t => ({ ...t, K: r.truthK[t.concept], archetype: r.archetype })));
    const diffs = rs.map(r => r.gain - (staticRows[r.learner]?.gain ?? 0));
    const knows = tasks.filter(t => t.K), gaps = tasks.filter(t => !t.K);
    const o = {
      label: CONDITIONS[ck].label, desc: CONDITIONS[ck].desc, n: rs.length,
      pre: ci(rs.map(r => r.pre)), post: ci(rs.map(r => r.post)), gain: ci(rs.map(r => r.gain)),
      diffVsStatic: { ...ci(diffs), pctImproved: diffs.filter(d => d > 0).length / diffs.length, pctWorse: diffs.filter(d => d < 0).length / diffs.length, d: sd(diffs) ? mean(diffs) / sd(diffs) : null },
      firstAttempt: mean(tasks.filter(t => t.first != null).map(t => +t.first)),
      independent: mean(tasks.map(t => +t.solved)),
      turnsPerTask: mean(tasks.map(t => t.turns)),
      gainPer10Turns: (() => { const g = mean(rs.map(r => r.gain)), tt = mean(rs.map(r => r.tasks.reduce((s, t) => s + t.turns, 0))); return tt ? 10 * g / tt : null; })(),
      hintsPerTask: mean(tasks.map(t => t.hints)),
      skipRate: mean(tasks.map(t => +t.skipped)),
      gapMislabel: mean(knows.map(t => +t.gapLabel)),   // P(labelled "doesn't know" | actually knows)
      gapRecall: mean(gaps.map(t => +t.gapLabel)),      // P(labelled "doesn't know" | actually doesn't)
      gapPrecision: (() => { const l = tasks.filter(t => t.gapLabel); return l.length ? l.filter(t => !t.K).length / l.length : null; })(),
    };
    const log = logs[ck];
    if (log) {
      const scored = log.filter(l => !l.correct && BOTTLENECK_IDS.includes(l.cause) && l.diag);
      const confident = scored.filter(l => !l.uncertain);
      o.diagAcc = mean(confident.map(l => +(l.diag === l.cause)));
      o.diagAccAll = mean(scored.map(l => +(!l.uncertain && l.diag === l.cause)));
      o.uncertainRate = mean(scored.map(l => +l.uncertain));
      const struggle = log.filter(l => l.kind === 'text' && l.cause && l.cause !== 'NOISE').map(l => l.load);
      const calm = log.filter(l => l.kind === 'text' && !l.cause && l.correct).map(l => l.load);
      o.loadAuc = auc(struggle, calm);
      o.loadStruggle = mean(struggle); o.loadCalm = mean(calm);
      const flu = tasks.filter(t => t.archetype === 'fluent' || t.archetype === 'slowFluent');
      o.falseAdapt = mean(flu.filter(t => t.first).map(t => +(t.maxRung > 0)));
      o.falseAdaptSlow = mean(tasks.filter(t => t.archetype === 'slowFluent' && t.first).map(t => +(t.maxRung > 0)));
      o.oscillation = mean(tasks.map(t => { let k = 0; for (let i = 2; i < t.modes.length; i++) if (t.modes[i] === t.modes[i - 2] && t.modes[i] !== t.modes[i - 1] && t.modes[i] !== 'ENGLISH') k++; return k; }));
      o.hiddenRecovered = mean(tasks.map(t => +!!t.hidden));
      const rated = tasks.filter(t => t.rating != null && t.meanLoad != null);
      o.rho = spearman(rated.map(t => t.meanLoad), rated.map(t => t.rating));
      o.recoveryRate = (() => { const f = tasks.filter(t => t.first === false); return f.length ? f.filter(t => t.solved).length / f.length : null; })();
    }
    byCond[ck] = o;
  }

  // Confusion matrix (full adaptive)
  const confusion = {};
  for (const l of logs.adaptive || []) {
    if (l.correct || !BOTTLENECK_IDS.includes(l.cause) || !l.diag) continue;
    const pred = l.uncertain ? 'UNCERTAIN' : l.diag;
    confusion[l.cause] ||= {}; confusion[l.cause][pred] = (confusion[l.cause][pred] || 0) + 1;
  }

  // Strategy effectiveness (full adaptive): after each rule fires, does the next answer in that task succeed?
  const ruleStats = {};
  for (const { decisions, turns } of decisionsByCond.adaptive || []) {
    for (const d of decisions) {
      if (d.action === 'baseline') continue;
      const s = (ruleStats[d.rule] ||= { rule: d.rule, text: RULES[d.rule], n: 0, nextN: 0, nextOk: 0, struggleBefore: 0 });
      s.n++;
      const next = turns.slice(d.seq).find(t => t.taskIndex === d.taskIndex);
      if (next) { s.nextN++; if (next.correct || (next.mode === 'CODESWITCH' && next.meaningConveyed)) s.nextOk++; }
    }
  }
  const rules = Object.values(ruleStats).map(s => ({ ...s, nextSuccess: s.nextN ? s.nextOk / s.nextN : null })).sort((a, b) => b.n - a.n);

  // Per archetype
  const archetypes = {};
  for (const a of Object.keys(ARCHETYPES)) {
    archetypes[a] = { label: ARCHETYPES[a].label, byCond: {} };
    for (const ck of Object.keys(byCond)) {
      const rs = rows.filter(r => r.archetype === a && r.cond === ck);
      const tasks = rs.flatMap(r => r.tasks.map(t => ({ ...t, K: r.truthK[t.concept] })));
      archetypes[a].byCond[ck] = { gain: mean(rs.map(r => r.gain)), post: mean(rs.map(r => r.post)), pre: mean(rs.map(r => r.pre)), independent: mean(tasks.map(t => +t.solved)), gapMislabel: mean(tasks.filter(t => t.K).map(t => +t.gapLabel)), turns: mean(tasks.map(t => t.turns)) };
    }
    archetypes[a].n = rows.filter(r => r.archetype === a && r.cond === 'static').length;
  }

  // Per concept gain (adaptive vs static)
  const concepts = {};
  for (const tid of TASK_IDS) {
    const c = TASK[tid].concept;
    concepts[c] = { label: TASK[tid].conceptLabel, byCond: {} };
    for (const ck of Object.keys(byCond)) {
      const rs = rows.filter(r => r.cond === ck);
      concepts[c].byCond[ck] = { pre: mean(rs.map(r => r.prePer[c])), post: mean(rs.map(r => r.postPer[c])) };
    }
  }
  return { byCond, confusion, rules, archetypes, concepts };
}

// ---------- main ----------------------------------------------------------------
const t0 = Date.now();
const problems = checkBank();
if (problems.length) { console.log('Response-bank / grader disagreements (reported, not fatal):'); for (const p of problems) console.log('  ·', p); }

const main = await experiment({ effects: EFFECTS, conditions: Object.keys(CONDITIONS), per: PER, seed: SEED, collectDetail: true });
const summary = summarize(main.rows, main.logs, main.decisionsByCond);

const sensitivity = {};
for (const f of [0.5, 1.5]) {
  const ex = await experiment({ effects: scaleEffects(f), conditions: ['static', 'staticRetry', 'adaptive'], per: Math.max(8, Math.round(PER / 2)), seed: SEED + 1000 * f, collectDetail: false });
  const s = summarize(ex.rows, {}, {});
  sensitivity[f] = Object.fromEntries(Object.entries(s.byCond).map(([k, v]) => [k, { gain: v.gain, diffVsStatic: v.diffVsStatic }]));
}

const results = round({
  meta: {
    generatedAt: new Date().toISOString(), seed: SEED, perArchetype: PER, learners: PER * Object.keys(ARCHETYPES).length, tasks: TASK_IDS.length, testItemsPerConcept: TEST_ITEMS,
    runtimeSec: (Date.now() - t0) / 1000,
    archetypes: Object.fromEntries(Object.entries(ARCHETYPES).map(([k, v]) => [k, v.label])),
    conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, v]) => [k, { label: v.label, desc: v.desc }])),
    bottlenecks: Object.fromEntries(Object.entries(BOTTLENECKS).map(([k, v]) => [k, v.label])),
    effects: EFFECTS, bankProblems: problems,
  },
  ...summary, sensitivity,
});
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(results, null, 1));

// ---------- console report ----------
const p = x => x == null ? '   —' : `${(x * 100).toFixed(1).padStart(5)}%`;
console.log(`\n${results.meta.learners} synthetic learners × ${Object.keys(CONDITIONS).length} conditions (${results.meta.runtimeSec}s)\n`);
console.log('condition              pre     post    gain   Δ vs static (95% CI)   indep.  turns/task  false-gap  diag-acc  load-AUC');
for (const [k, v] of Object.entries(results.byCond)) {
  console.log(`${v.label.padEnd(22)} ${p(v.pre.mean)} ${p(v.post.mean)} ${p(v.gain.mean)}  ${p(v.diffVsStatic.mean)} ±${(v.diffVsStatic.ci * 100).toFixed(1).padStart(4)}     ${p(v.independent)}  ${String(v.turnsPerTask?.toFixed(2)).padStart(6)}    ${p(v.gapMislabel)}  ${p(v.diagAcc)}  ${v.loadAuc ?? '  —'}`);
}
console.log('\nstrategy (adaptive)        fired   next answer succeeds');
for (const r of results.rules) console.log(`${r.rule.padEnd(18)} ${String(r.n).padStart(12)}   ${p(r.nextSuccess)}`);
console.log('\nsensitivity (learning effects ×0.5 / ×1.5): Δ adaptive vs static =', Object.entries(results.sensitivity).map(([f, s]) => `×${f}: ${p(s.adaptive.diffVsStatic.mean)}`).join('  '));
console.log(`\nwrote ${OUT}`);
