// Aggregate stored session metrics into the live monitoring view.
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const rate = (arr, f) => (arr.length ? arr.filter(f).length / arr.length : null);
const DAY = 86400000;

function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  const all = pos.map(v => [v, 1]).concat(neg.map(v => [v, 0])).sort((a, b) => a[0] - b[0]);
  let i = 0, rs = 0;
  while (i < all.length) { let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) if (all[k][1]) rs += r; i = j + 1; }
  return (rs - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}
function spearman(x, y) {
  if (x.length < 5) return null;
  const rank = a => { const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(a.length); let i = 0;
    while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
  const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry);
  let n = 0, dx = 0, dy = 0; for (let i = 0; i < rx.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : null;
}

export function aggregate(all, { demo = 'exclude', days = 30, now = Date.now() } = {}) {
  const realCount = all.filter(s => !s.demo).length;
  let effectiveDemo = demo;
  if (demo === 'exclude' && realCount === 0) effectiveDemo = 'include'; // nothing real yet: show demos rather than an empty page
  const since = days ? now - days * DAY : 0;
  const sessions = all.filter(s => (effectiveDemo === 'include' || (effectiveDemo === 'only' ? s.demo : !s.demo)) && (s.updatedAt || 0) >= since);

  const tasks = sessions.flatMap(s => s.tasks.filter(t => t.outcome).map(t => ({ ...t, sid: s.id, anon: s.anon, demo: s.demo, at: t.endedAt || s.updatedAt })));
  const turns = sessions.flatMap(s => s.turns.filter(t => t.kind === 'text' || t.kind === 'choice'));
  const attempted = tasks.filter(t => t.firstCorrect != null);
  const failedFirst = attempted.filter(t => !t.firstCorrect);
  const solved = t => ['first-try', 'independent', 'recovered'].includes(t.outcome);

  const kpi = {
    sessions: sessions.length, learners: new Set(sessions.map(s => s.anon)).size, tasks: tasks.length, answers: turns.length,
    completedSessions: sessions.filter(s => s.done).length,
    active24h: sessions.filter(s => now - s.updatedAt < DAY).length,
    firstAttemptAcc: rate(attempted, t => t.firstCorrect),
    independentRate: rate(tasks, solved),
    recoveryRate: rate(failedFirst, t => t.outcome === 'recovered'),
    hiddenKnowledgeRate: rate(failedFirst, t => t.hidden),
    abandonRate: rate(tasks, t => t.outcome === 'skipped'),
    hintsPerTask: mean(tasks.map(t => t.hints || 0)),
    avgScaffoldDepth: mean(tasks.map(t => t.maxRung || 0)),
    meanLoad: mean(turns.map(t => t.load).filter(x => x != null)),
    lastEventAt: sessions.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0) || null,
  };

  // Is the load estimator still separating struggle from success on real behaviour?
  const fail = turns.filter(t => !t.ok && t.load != null).map(t => t.load), ok = turns.filter(t => t.ok && t.load != null).map(t => t.load);
  const rated = tasks.filter(t => t.rating != null && t.meanLoad != null);
  const diagTurns = turns.filter(t => !t.ok && t.unc != null);
  let osc = 0;
  for (const t of tasks) for (let i = 2; i < t.modes.length; i++) if (t.modes[i] === t.modes[i - 2] && t.modes[i] !== t.modes[i - 1] && t.modes[i] !== 'ENGLISH') osc++;
  const health = {
    loadAuc: auc(fail, ok), nFail: fail.length, nOk: ok.length, meanLoadFail: mean(fail), meanLoadOk: mean(ok),
    ratingRho: spearman(rated.map(t => t.meanLoad), rated.map(t => t.rating)), nRated: rated.length,
    uncertainRate: rate(diagTurns, t => t.unc), oscillationPerTask: tasks.length ? osc / tasks.length : null,
    tamilShare: mean(turns.filter(t => t.kind === 'text').map(t => t.tamil || 0)),
  };

  // Strategy effectiveness: after a rule fires, does the learner's next answer in that task succeed?
  const rules = {};
  for (const s of sessions) for (const d of s.decisions) {
    if (!d.rule || d.action === 'baseline') continue;
    const r = (rules[d.rule] ||= { rule: d.rule, n: 0, nextN: 0, nextOk: 0 });
    r.n++;
    const next = s.turns.slice(d.seq ?? 0).find(t => t.ti === d.ti && t.kind !== 'hint' && t.kind !== 'skip');
    if (next && d.to) { r.nextN++; if (next.ok || (next.mode === 'CODESWITCH' && next.mc)) r.nextOk++; }
  }
  const ruleList = Object.values(rules).map(r => ({ ...r, nextSuccess: r.nextN ? r.nextOk / r.nextN : null })).sort((a, b) => b.n - a.n);

  const bottlenecks = {}; for (const t of turns) if (!t.ok && t.diag && !t.unc) bottlenecks[t.diag] = (bottlenecks[t.diag] || 0) + 1;
  const modes = {}; for (const t of turns) if (t.mode) modes[t.mode] = (modes[t.mode] || 0) + 1;

  const concepts = {};
  for (const t of tasks) {
    const c = (concepts[t.concept] ||= { concept: t.concept, n: 0, first: [], solved: 0, hidden: 0, loads: [], failedFirst: 0 });
    c.n++; if (t.firstCorrect != null) c.first.push(+t.firstCorrect); if (solved(t)) c.solved++; if (t.hidden) c.hidden++; if (t.firstCorrect === false) c.failedFirst++; if (t.meanLoad != null) c.loads.push(t.meanLoad);
  }
  const conceptList = Object.values(concepts).map(c => ({ concept: c.concept, n: c.n, firstAttemptAcc: mean(c.first), independentRate: c.solved / c.n, hiddenRate: c.failedFirst ? c.hidden / c.failedFirst : null, meanLoad: mean(c.loads) })).sort((a, b) => b.n - a.n);

  // Daily series
  const nDays = Math.min(days || 30, 30);
  const daily = [];
  for (let d = nDays - 1; d >= 0; d--) {
    const start = new Date(now - d * DAY); start.setUTCHours(0, 0, 0, 0);
    const end = start.getTime() + DAY;
    const dt = tasks.filter(t => t.at >= start.getTime() && t.at < end);
    const df = dt.filter(t => t.firstCorrect != null);
    daily.push({ day: start.toISOString().slice(0, 10), tasks: dt.length, sessions: new Set(dt.map(t => t.sid)).size, firstAttemptAcc: rate(df, t => t.firstCorrect), independentRate: rate(dt, solved) });
  }

  const recent = tasks.sort((a, b) => b.at - a.at).slice(0, 15).map(t => ({ at: t.at, concept: t.concept, outcome: t.outcome, modes: t.modes, dominant: t.dominant, hidden: t.hidden, demo: t.demo }));

  const alerts = [];
  const warn = (level, msg) => alerts.push({ level, msg });
  if (!sessions.length) warn('info', 'No sessions in this window yet.');
  if (effectiveDemo !== demo) warn('info', 'No real learner sessions yet, so demo sessions are shown.');
  if (health.loadAuc != null && health.nFail >= 30 && health.nOk >= 30 && health.loadAuc < 0.65) warn('critical', `Load estimator is barely separating failed from correct answers (AUC ${health.loadAuc.toFixed(2)}). Recalibrate the signal weights.`);
  if (health.oscillationPerTask != null && tasks.length >= 20 && health.oscillationPerTask > 0.3) warn('warning', `Mode oscillation is high (${health.oscillationPerTask.toFixed(2)} per task). Hysteresis may be too weak.`);
  if (kpi.abandonRate != null && tasks.length >= 20 && kpi.abandonRate > 0.15) warn('warning', `${Math.round(kpi.abandonRate * 100)}% of tasks are skipped. Check task difficulty or support level.`);
  if (kpi.recoveryRate != null && failedFirst.length >= 20 && kpi.recoveryRate < 0.3) warn('warning', `Only ${Math.round(kpi.recoveryRate * 100)}% of initially failed tasks recover. Scaffolding may not be working.`);
  if (health.uncertainRate != null && diagTurns.length >= 30 && health.uncertainRate > 0.4) warn('warning', `Diagnosis is uncertain on ${Math.round(health.uncertainRate * 100)}% of failed answers.`);
  if (sessions.length && kpi.lastEventAt && now - kpi.lastEventAt > DAY) warn('info', 'No activity in the last 24 hours.');

  return { generatedAt: now, window: { days, demo, effectiveDemo }, totals: { stored: all.length, real: realCount, demo: all.length - realCount }, kpi, health, rules: ruleList, bottlenecks, modes, concepts: conceptList, daily, recent, alerts };
}
