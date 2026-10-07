// Metrics computed from a session record: learner metrics (what the learner knows
// vs. can produce), system performance metrics (does adaptation recover knowledge?),
// and estimator validity (does the load score actually track struggle?).
import { MODES, MODE, BOTTLENECK_IDS, TASK } from './content.js';
import { LearnerModel } from './learner.js';

const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
function pearson(x, y) {
  const mx = avg(x), my = avg(y); let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : null;
}
export const spearman = (x, y) => x.length >= 3 ? pearson(rank(x), rank(y)) : null;
export function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  let s = 0; for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

export function computeMetrics(session) {
  const tasks = session.tasks.filter(t => t && t.outcome);
  const graded = session.turns.filter(t => t.kind === 'text' || t.kind === 'choice');
  const n = tasks.length;
  const attempted = tasks.filter(t => t.firstAttempt);
  const firstOk = attempted.filter(t => t.firstAttempt.correct && t.firstAttempt.mode === 'ENGLISH');
  const failedFirst = attempted.filter(t => !t.firstAttempt.correct);
  const recovered = tasks.filter(t => t.outcome === 'recovered');
  const independent = tasks.filter(t => ['first-try', 'independent', 'recovered'].includes(t.outcome));
  const hidden = tasks.filter(t => t.hiddenKnowledge);

  // Estimator validity
  const failLoads = graded.filter(t => !t.correct).map(t => t.est.load);
  const okLoads = graded.filter(t => t.correct).map(t => t.est.load);
  const rated = tasks.filter(t => t.selfRating != null && t.loads.length);
  const rho = spearman(rated.map(t => avg(t.loads)), rated.map(t => t.selfRating));

  // Intervention effectiveness: after the policy routes to mode M, is the next graded answer correct?
  const eff = Object.fromEntries(MODES.map(m => [m.id, { mode: m.id, label: m.label, n: 0, ok: 0 }]));
  for (const d of session.decisions) {
    if (!d.to || d.action === 'baseline') continue;
    const start = d.seq ?? session.turns.findIndex(t => t.id === d.turnId) + 1;
    const after = session.turns.slice(start).find(t => t.kind !== 'hint' && t.taskIndex === d.taskIndex && t.mode === d.to);
    if (!after) continue;
    eff[d.to].n++; if (after.correct || (d.to === 'CODESWITCH' && after.meaningConveyed)) eff[d.to].ok++;
  }

  // Bottlenecks (failed turns)
  const bott = Object.fromEntries(BOTTLENECK_IDS.map(b => [b, 0]));
  for (const t of graded) if (!t.correct && t.diag) bott[t.diag.top]++;

  const rules = {};
  for (const d of session.decisions) rules[d.rule] = (rules[d.rule] || 0) + 1;

  let switches = 0, oscillations = 0;
  for (const t of tasks) {
    for (let i = 1; i < t.modes.length; i++) if (t.modes[i] !== t.modes[i - 1]) switches++;
    for (let i = 2; i < t.modes.length; i++) if (t.modes[i] === t.modes[i - 2] && t.modes[i] !== t.modes[i - 1] && t.modes[i] !== 'ENGLISH') oscillations++;
  }

  const textTurns = graded.filter(t => t.kind === 'text');
  const half = Math.ceil(textTurns.length / 2);
  const tamilEarly = avg(textTurns.slice(0, half).map(t => t.tamilRatio));
  const tamilLate = avg(textTurns.slice(half).map(t => t.tamilRatio));

  const learner = new LearnerModel(session.learner);
  const concepts = [...new Set(session.tasks.filter(Boolean).map(t => t.concept))].map(c => {
    const taskDef = Object.values(TASK).find(t => t.concept === c);
    return { concept: c, label: taskDef?.conceptLabel || c, ...learner.view(c) };
  });

  const timeline = graded.map((t, i) => ({ i, load: t.est.load, level: t.est.level, correct: t.correct, mode: t.mode, rung: MODE[t.mode].rung, taskIndex: t.taskIndex, text: t.text, diag: t.diag?.top || null }));

  return {
    n, graded: graded.length,
    kpi: {
      firstAttemptAcc: attempted.length ? firstOk.length / attempted.length : null,
      independentRate: n ? independent.length / n : null,
      recoveryRate: failedFirst.length ? recovered.filter(t => !t.firstAttempt.correct).length / failedFirst.length : null,
      failedFirst: failedFirst.length, recovered: recovered.length, hiddenKnowledge: hidden.length,
      avgScaffoldDepth: avg(tasks.map(t => t.maxRung)),
      turnsToRecovery: avg(recovered.map(t => t.turnsToRecovery)),
      meanLoad: avg(graded.map(t => t.est.load)),
      hintsPerTask: n ? tasks.reduce((s, t) => s + t.hints, 0) / n : null,
      abandoned: tasks.filter(t => t.outcome === 'skipped').length,
      switches, oscillations,
    },
    validity: {
      auc: auc(failLoads, okLoads), meanLoadFail: avg(failLoads), meanLoadOk: avg(okLoads), nFail: failLoads.length, nOk: okLoads.length,
      rho, nRated: rated.length,
    },
    tamil: { early: tamilEarly, late: tamilLate, perTurn: textTurns.map(t => t.tamilRatio) },
    effectiveness: Object.values(eff).filter(e => e.n > 0),
    bottlenecks: bott, rules, concepts, timeline,
    gapLexicon: Object.values(learner.gapLexicon).sort((a, b) => b.count - a.count),
    transfer: Object.entries(learner.transfer).sort((a, b) => b[1] - a[1]),
    tasks,
  };
}
