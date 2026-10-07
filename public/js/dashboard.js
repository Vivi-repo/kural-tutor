// Researcher views: metrics dashboard, decision log, static-vs-adaptive counterfactual, session history.
import { MODE, BOTTLENECKS, BOTTLENECK_IDS, TASK } from './content.js';
import { RULES } from './policy.js';
import { esc, pct, fix, modeTag, barList, loadChart, supportChart, skillDumbbell } from './charts.js';
import { computeMetrics, auc } from './metrics.js';

const kpi = (label, val, sub, hero = false, tip = '') => `<div class="kpi ${hero ? 'hero' : ''}" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;
const OUTCOME = { 'first-try': ['First try', 'ok'], independent: ['Independent', 'ok'], recovered: ['Recovered', 'ok'], 'not-yet': ['Not yet', 'bad'], skipped: ['Skipped', 'neutral'] };

function header(session, title, extra = '') {
  const when = new Date(session.startedAt).toLocaleString();
  return `<div class="dash-head"><div><h2>${title}</h2><div class="small muted">${esc(session.learnerName)} · started ${when} · ${session.tasks.filter(t => t?.outcome).length}/${session.taskIds.length} tasks complete</div></div>${extra}</div>`;
}

export function renderDashboard(el, session) {
  const m = computeMetrics(session);
  const k = m.kpi, v = m.validity;
  if (!m.graded) { el.innerHTML = header(session, 'Dashboard') + '<p class="empty">No answers yet. Start on the Learn tab, or play a demo learner.</p>'; return; }

  const perf = `<div class="section-title"><h2>Performance</h2><p>Does adaptive communication recover knowledge that a static tutor would miss?</p></div>
  <div class="kpis">
    ${kpi('First-attempt accuracy', pct(k.firstAttemptAcc), 'what a static tutor measures', false, 'Share of tasks answered correctly on the first English-only attempt')}
    ${kpi('Independent English', pct(k.independentRate), 'tasks ending in unaided English', true, 'Share of tasks where the learner finished by producing correct English with no support visible')}
    ${kpi('Recovery rate', pct(k.recoveryRate), `${k.recovered} of ${k.failedFirst} initially failed tasks`, true, 'Initially failed English-production tasks that ended in correct independent English after scaffolding')}
    ${kpi('Hidden knowledge recovered', k.hiddenKnowledge, 'static tutor would log as "doesn\'t know"', true, 'Tasks failed at first, recovered, and never diagnosed as a genuine knowledge gap')}
    ${kpi('Turns to recovery', fix(k.turnsToRecovery, 1), 'mean extra turns per recovered task')}
    ${kpi('Scaffold depth', fix(k.avgScaffoldDepth, 1), 'mean highest rung per task (0–5)')}
  </div>`;

  const charts = `<div class="section-title"><h2>Load and support over time</h2><p>Each point is one graded answer. Support should rise with load, then return to English-only.</p></div>
  <div class="card"><h3>Estimated cognitive load</h3>${loadChart(m.timeline)}</div>
  <div class="card" style="margin-top:12px"><h3>Communication mode (support level)</h3>${supportChart(m.timeline)}</div>`;

  const eff = m.effectiveness.map(e => ({ key: e.mode, label: e.label, value: e.ok / e.n, sub: `${e.ok}/${e.n} next answers succeeded` }));
  const bottTotal = Object.values(m.bottlenecks).reduce((s, x) => s + x, 0);
  const bott = BOTTLENECK_IDS.map(b => ({ key: b, label: BOTTLENECKS[b].label, value: bottTotal ? m.bottlenecks[b] / bottTotal : 0, sub: BOTTLENECKS[b].short, n: m.bottlenecks[b] })).sort((a, b) => b.value - a.value);
  const why = `<div class="grid-2" style="margin-top:12px">
    <div class="card"><h3>Intervention effectiveness <span class="hint">P(next answer succeeds | mode)</span></h3>${barList(eff)}</div>
    <div class="card"><h3>Why answers failed <span class="hint">diagnosed bottleneck, ${bottTotal} failed answers</span></h3>${barList(bott, { format: (v, r) => `${r.n}` })}</div>
  </div>`;

  const gapRows = m.gapLexicon.map(g => `<tr><td class="ta">${esc(g.source)}</td><td><b>${esc(g.en)}</b></td><td>${g.kind}</td><td class="num">${g.count}</td><td>${g.resolved ? '<span class="pill ok">✓ used in English</span>' : '<span class="pill neutral">open</span>'}</td></tr>`).join('');
  const learner = `<div class="section-title"><h2>Learner</h2><p>What ${esc(session.learnerName)} knows vs. what they can currently say in English.</p></div>
  <div class="grid-2">
    <div class="card"><h3>Knowledge vs. production by concept</h3>${skillDumbbell(m.concepts)}</div>
    <div class="card"><h3>Expression gap map <span class="hint">Tamil the learner used → English they needed</span></h3>
      ${gapRows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Said</th><th>Needed</th><th>Type</th><th>×</th><th>Status</th></tr></thead><tbody>${gapRows}</tbody></table></div>` : '<p class="empty">No code-switched words yet.</p>'}</div>
    <div class="card"><h3>Tamil-structure transfer patterns</h3>${barList(m.transfer.map(([l, c]) => ({ key: l, label: l, value: c, tip: l })), { max: Math.max(1, ...m.transfer.map(t => t[1])), format: v => `${v}×` })}</div>
    <div class="card"><h3>Reliance on Tamil</h3>
      <div class="kpis">${kpi('First half of session', pct(m.tamil.early), 'mean share of Tamil tokens')}${kpi('Second half', pct(m.tamil.late), m.tamil.late != null && m.tamil.early != null ? (m.tamil.early === 0 && m.tamil.late === 0 ? 'no Tamil needed' : m.tamil.late <= m.tamil.early ? 'falling — scaffold is temporary' : 'rising — watch this') : '')}</div>
      <p class="note">Code-switching is used as a diagnostic, not a crutch: the target is for this number to fall as gaps get bridged.</p></div>
  </div>`;

  const ruleRows = Object.entries(m.rules).sort((a, b) => b[1] - a[1]).map(([r, c]) => `<tr><td><span class="decision-rule">${esc(r)}</span></td><td>${esc(RULES[r] || '')}</td><td class="num">${c}</td></tr>`).join('');
  const model = `<div class="section-title"><h2>Model validity</h2><p>Is the load estimate tracking real struggle? With one learner the sample is small, so read these as directional.</p></div>
  <div class="kpis">
    ${kpi('Load AUC', fix(v.auc), `separates failed (n=${v.nFail}) from correct (n=${v.nOk}) answers`, false, 'Probability that a randomly chosen failed answer had higher estimated load than a correct one. 0.5 = chance.')}
    ${kpi('Mean load: failed', fix(v.meanLoadFail), `vs ${fix(v.meanLoadOk)} on correct answers`)}
    ${kpi('Load vs self-report', v.rho == null ? '—' : `ρ ${fix(v.rho)}`, `Spearman, ${v.nRated} rated tasks${v.nRated < 3 ? ' (need ≥3)' : ''}`, false, 'Rank correlation between mean task load and the learner\'s own 1–5 difficulty rating')}
    ${kpi('Mode switches', k.switches, `${k.oscillations} oscillations (A→B→A)`, false, 'Oscillation means flip-flopping between modes; hysteresis should keep this near zero')}
    ${kpi('Hints per task', fix(k.hintsPerTask, 1), `${k.abandoned} abandoned`)}
    ${kpi('Mean load', fix(k.meanLoad), `${m.graded} graded answers`)}
  </div>
  <div class="card" style="margin-top:12px"><h3>Policy rules fired</h3><div class="table-wrap"><table class="data"><thead><tr><th>Rule</th><th>Meaning</th><th>Count</th></tr></thead><tbody>${ruleRows}</tbody></table></div></div>`;

  el.innerHTML = header(session, 'Dashboard') + perf + charts + why + learner + model;
}

export function renderDecisions(el, session, filter = 'all') {
  const decs = [...session.decisions].reverse().filter(d => filter === 'all' || String(d.taskIndex) === filter);
  const opts = session.tasks.filter(Boolean).map(t => `<option value="${t.index}" ${String(t.index) === filter ? 'selected' : ''}>Task ${t.index + 1}: ${esc(TASK[t.taskId].conceptLabel)}</option>`).join('');
  const cards = decs.map(d => {
    const turn = d.turnId ? session.turns.find(t => t.id === d.turnId) : null;
    const time = new Date(d.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="decision-card"><div class="when">${time}<br>Task ${d.taskIndex + 1}</div><div>
      <div class="head"><span class="decision-rule">${esc(d.rule)}</span>${modeTag(d.from)}<span>→</span>${d.to ? modeTag(d.to) : '<span class="pill neutral">next task</span>'}
        ${d.correct == null ? '' : `<span class="pill ${d.correct ? 'ok' : 'bad'}">${d.correct ? '✓' : '✗'}</span>`}
        ${d.load != null ? `<span class="pill neutral">load ${fix(d.load)} ${d.level}</span>` : ''}
        ${d.diagTop ? `<span class="pill neutral">${d.uncertain ? 'uncertain' : esc(BOTTLENECKS[d.diagTop].label)} ${pct(d.diagP)}</span>` : ''}</div>
      ${turn ? `<div style="margin-top:6px">Learner: <i>“${esc(turn.text)}”</i></div>` : ''}
      <div style="margin-top:4px">${esc(d.rationale)}</div>
      ${d.evidence.length ? `<div class="ev">${d.evidence.map(e => `<span>${esc(e)}</span>`).join('')}</div>` : ''}
      <div class="static-alt"><b>Static tutor:</b> ${esc(d.staticAlt)}</div></div></div>`;
  }).join('');
  el.innerHTML = header(session, 'Decision log', '') + `<p class="muted" style="margin-top:-6px">Every adaptation, with the data that triggered it. Newest first.</p>
    <div class="filters"><label class="field">Task <select id="decFilter"><option value="all">All tasks</option>${opts}</select></label><span class="small faint">${decs.length} decisions</span></div>
    <div class="card">${cards || '<p class="empty">No decisions yet.</p>'}</div>`;
}

export function renderCounterfactual(el, session) {
  const m = computeMetrics(session);
  const tasks = m.tasks;
  if (!tasks.length) { el.innerHTML = header(session, 'Static vs adaptive') + '<p class="empty">Complete at least one task to compare.</p>'; return; }
  const staticGaps = tasks.filter(t => t.staticVerdict.startsWith("Doesn't")).length;
  const confirmed = tasks.filter(t => t.knowledgeConfirmed || t.dominant === 'KNOWLEDGE').length;
  const rows = tasks.map(t => {
    const first = session.turns.find(x => x.taskIndex === t.index);
    const path = t.modes.map((mm, i) => (i ? '<span class="arr">→</span>' : '') + modeTag(mm)).join('');
    return `<tr><td><b>${esc(TASK[t.taskId].conceptLabel)}</b><div class="small faint">${esc(TASK[t.taskId].situation)}</div></td>
      <td><i>“${esc(first?.text || '—')}”</i></td>
      <td><span class="pill ${t.staticVerdict.startsWith('Knows') ? 'ok' : 'bad'}">${esc(t.staticVerdict)}</span></td>
      <td><div class="path">${path}</div></td>
      <td>${esc(t.adaptiveVerdict)}<div style="margin-top:4px"><span class="pill ${OUTCOME[t.outcome][1]}">${OUTCOME[t.outcome][0]}</span> ${t.hiddenKnowledge ? '<span class="pill ok">hidden knowledge</span>' : ''}</div></td></tr>`;
  }).join('');
  const compare = `<div class="compare">
    <div class="card"><h3>Static tutor</h3><div class="kpis">${kpi('Knowledge gaps logged', staticGaps, 'every first-attempt miss')}${kpi('English production', pct(m.kpi.firstAttemptAcc), 'first attempt only')}</div>
      <p class="note">Sees one answer per question. A wrong answer is recorded as a missing concept, and the learner is shown the model answer.</p></div>
    <div class="card"><h3>Adaptive tutor</h3><div class="kpis">${kpi('Genuine gaps confirmed', confirmed, 'recognition also failed, or taught explicitly')}${kpi('English production', pct(m.kpi.independentRate), 'independent, after scaffolding')}</div>
      <p class="note">Tests <i>why</i> the answer failed, lowers only the language barrier, then removes the support and re-checks English.
      <b>${m.kpi.hiddenKnowledge}</b> of the ${staticGaps} "gaps" were knowledge the learner already had.</p></div></div>`;
  el.innerHTML = header(session, 'Static vs adaptive') + `<p class="muted" style="margin-top:-6px">"What if the learner isn't failing the question — what if the question is failing to measure what they know?"</p>` + compare +
    `<div class="card" style="margin-top:12px"><h3>Per task</h3><div class="table-wrap"><table class="data"><thead><tr><th>Concept</th><th>First answer</th><th>Static verdict</th><th>Adaptive path</th><th>Adaptive verdict</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

export function renderSessions(el, sessions, currentId) {
  if (!sessions.length) { el.innerHTML = '<h2>Sessions</h2><p class="empty">No saved sessions yet.</p>'; return; }
  const all = sessions.map(s => ({ s, m: computeMetrics(s) }));
  const pooledFail = all.reduce((x, { m }) => x + m.kpi.failedFirst, 0);
  const pooledRec = all.reduce((x, { m }) => x + m.tasks.filter(t => t.outcome === 'recovered' && !t.firstAttempt?.correct).length, 0);
  const turns = all.flatMap(({ s }) => s.turns.filter(t => t.kind !== 'hint'));
  const pooledAuc = auc(turns.filter(t => !t.correct).map(t => t.est.load), turns.filter(t => t.correct).map(t => t.est.load));
  const rows = all.slice().reverse().map(({ s, m }) => `<tr>
    <td>${new Date(s.startedAt).toLocaleString()}${s.id === currentId ? ' <span class="pill neutral">current</span>' : ''}</td><td>${esc(s.learnerName)}${s.demo ? ' <span class="pill neutral">demo</span>' : ''}</td>
    <td class="num">${m.n}/${s.taskIds.length}</td><td class="num">${pct(m.kpi.firstAttemptAcc)}</td><td class="num">${pct(m.kpi.independentRate)}</td>
    <td class="num">${pct(m.kpi.recoveryRate)}</td><td class="num">${m.kpi.hiddenKnowledge}</td><td class="num">${fix(m.validity.auc)}</td>
    <td><button class="btn" data-open="${s.id}">Open</button> <button class="btn ghost" data-del="${s.id}" aria-label="Delete session">Delete</button></td></tr>`).join('');
  el.innerHTML = `<div class="dash-head"><div><h2>Sessions</h2><div class="small muted">Saved in this browser. Export for analysis across learners.</div></div>
    <div><button class="btn" id="exportAll">Export JSON</button> <label class="btn">Import JSON<input type="file" id="importFile" accept="application/json" hidden></label></div></div>
    <div class="kpis">${kpi('Sessions', all.length, `${all.reduce((x, { m }) => x + m.n, 0)} tasks`)}${kpi('Pooled recovery rate', pct(pooledFail ? pooledRec / pooledFail : null), `${pooledRec}/${pooledFail} initially failed tasks`, true)}${kpi('Pooled load AUC', fix(pooledAuc), `${turns.length} graded answers`)}</div>
    <div class="card" style="margin-top:12px"><div class="table-wrap"><table class="data"><thead><tr><th>Started</th><th>Learner</th><th>Tasks</th><th>First-attempt</th><th>Independent</th><th>Recovery</th><th>Hidden knowl.</th><th>Load AUC</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
