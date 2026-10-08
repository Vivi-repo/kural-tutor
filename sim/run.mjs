// Synthetic evaluation of Kural.
//   node sim/run.mjs [--per 40] [--seed 99] [--out public/eval/results.json]
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BOTTLENECKS } from '../public/js/content.js';
import { ARCHETYPES, EFFECTS, scaleEffects } from './learner.mjs';
import { CONDITIONS, TASK_IDS, TEST_ITEMS, checkBank, experiment, summarize, round } from './experiment.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PER = Number(arg('--per', 40)), SEED = Number(arg('--seed', 99)), OUT = arg('--out', 'public/eval/results.json');

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
    tuning: { note: 'One diagnosis change was made after inspecting the confusion matrix on a separate tuning seed (7): history-based retrieval evidence is halved when the answer shows a specific error pattern. All numbers on this page come from a fresh held-out seed.', tuningSeed: 7, diagAccBefore: 0.501, diagAccAfter: 0.540, transferCorrectBefore: 474, transferCorrectAfter: 602 },
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
