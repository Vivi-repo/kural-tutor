// Live monitoring of real usage: polls /api/metrics and compares against simulation expectations.
import { TASKS, MODE, MODES, BOTTLENECKS } from './content.js';
import { RULES } from './policy.js';
import { esc, pct, fix, modeTag, barList } from './charts.js';

const REFRESH_MS = 15000;
const state = { el: null, timer: null, tick: null, demo: 'exclude', days: 30, data: null, sim: null, error: null, fetchedAt: 0 };
const CONCEPT = Object.fromEntries(TASKS.map(t => [t.concept, t.conceptLabel]));
const OUTCOME = { 'first-try': ['First try', 'ok'], independent: ['Independent', 'ok'], recovered: ['Recovered', 'ok'], 'not-yet': ['Not yet', 'bad'], skipped: ['Skipped', 'neutral'] };

const ago = t => { if (!t) return '—'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const kpi = (label, val, sub, tip = '') => `<div class="kpi" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-sub">${sub}</div></div>`;
const simRef = (k, f = pct) => state.sim?.[k] != null ? `simulation expects ${f(state.sim[k])}` : '';

export function stopMonitor() { clearInterval(state.timer); clearInterval(state.tick); state.timer = state.tick = null; }

export function renderMonitor(el) {
  if (state.timer && state.el === el) return; // already live
  state.el = el;
  el.innerHTML = '<p class="empty">Loading live metrics…</p>';
  el.onchange = e => {
    if (e.target.id === 'monDemo') state.demo = e.target.value;
    if (e.target.id === 'monDays') state.days = Number(e.target.value);
    load();
  };
  el.onclick = e => { if (e.target.id === 'monRefresh') load(); };
  if (!state.sim) fetch('eval/results.json').then(r => r.json()).then(r => { const a = r.byCond.adaptive; state.sim = { firstAttemptAcc: a.firstAttempt, independentRate: a.independent, recoveryRate: a.recoveryRate, loadAuc: a.loadAuc, uncertainRate: a.uncertainRate, rho: a.rho }; draw(); }).catch(() => {});
  load();
  state.timer = setInterval(load, REFRESH_MS);
  state.tick = setInterval(() => { const s = el.querySelector('#monAgo'); if (s) s.textContent = ago(state.fetchedAt); }, 1000);
}

async function load() {
  try {
    const r = await fetch(`/api/metrics?demo=${state.demo}&days=${state.days}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state.data = await r.json(); state.error = null; state.fetchedAt = Date.now();
  } catch (e) { state.error = e.message; }
  draw();
}

function dailyChart(daily) {
  if (!daily.some(d => d.tasks)) return '<p class="empty">No completed tasks in this window.</p>';
  const W = 1100, H = 200, L = 46, Rr = 12, top = 12, bottom = H - 26;
  const x = i => L + (i * (W - L - Rr)) / Math.max(1, daily.length - 1);
  const y = v => bottom - v * (bottom - top);
  const maxT = Math.max(...daily.map(d => d.tasks), 1);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily tasks and outcome rates">`;
  for (const v of [0, 0.5, 1]) s += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="axis-label">${v * 100}%</text>`;
  const bw = Math.max(3, (W - L - Rr) / daily.length * 0.55);
  daily.forEach((d, i) => {
    const h = (d.tasks / maxT) * (bottom - top) * 0.45;
    s += `<rect x="${x(i) - bw / 2}" y="${bottom - h}" width="${bw}" height="${h}" rx="2" fill="var(--surface-2)" stroke="var(--border)"/>`;
    s += `<rect class="hit" x="${x(i) - 10}" y="${top}" width="20" height="${bottom - top}" data-tip="${esc(`${d.day}\n${d.tasks} tasks · ${d.sessions} sessions\nIndependent English: ${pct(d.independentRate)}\nFirst attempt: ${pct(d.firstAttemptAcc)}`)}"/>`;
  });
  const line = (k, col) => {
    const pts = daily.map((d, i) => d[k] == null ? null : [x(i), y(d[k])]);
    let path = '', pen = false;
    for (const p of pts) { if (!p) { pen = false; continue; } path += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; pen = true; }
    return `<path d="${path}" fill="none" stroke="${col}" stroke-width="2"/>` + pts.filter(Boolean).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${col}" stroke="var(--surface)" stroke-width="1.5"/>`).join('');
  };
  s += line('firstAttemptAcc', 'var(--series-2)') + line('independentRate', 'var(--series-1)');
  [0, Math.floor(daily.length / 2), daily.length - 1].forEach(i => { s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${daily[i].day.slice(5)}</text>`; });
  s += '</svg>';
  return `<div class="chart-wrap">${s}</div><div class="legend"><span><span class="sw" style="background:var(--series-1)"></span>Independent English</span><span><span class="sw" style="background:var(--series-2)"></span>First-attempt accuracy</span><span>Grey bars: tasks per day</span></div>`;
}

function draw() {
  const el = state.el; if (!el) return;
  const d = state.data;
  const controls = `<div class="dash-head"><div><h2>Live monitor <span class="live-dot" aria-hidden="true"></span></h2>
    <div class="small muted">Real usage of the deployed tutor · refreshes every 15s · updated <span id="monAgo">${ago(state.fetchedAt)}</span>${d ? ` · storage: ${esc(d.backend)} · ${d.totals.real} real / ${d.totals.demo} demo sessions stored` : ''}</div></div>
    <div class="filters" style="margin:0"><label class="field">Sessions <select id="monDemo">
      <option value="exclude" ${state.demo === 'exclude' ? 'selected' : ''}>Real learners</option><option value="include" ${state.demo === 'include' ? 'selected' : ''}>Real + demo</option><option value="only" ${state.demo === 'only' ? 'selected' : ''}>Demo only</option></select></label>
      <label class="field">Window <select id="monDays">${[[1, '24 hours'], [7, '7 days'], [30, '30 days'], [0, 'All time']].map(([v, l]) => `<option value="${v}" ${state.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn" id="monRefresh">Refresh</button></div></div>`;
  if (state.error && !d) { el.innerHTML = controls + `<div class="note">Live metrics unavailable (${esc(state.error)}). The Monitor needs the server: use the deployed site or <code>npm start</code>.</div>`; return; }
  if (!d) return;
  const k = d.kpi, h = d.health;
  const alerts = d.alerts.length ? `<div class="alerts">${d.alerts.map(a => `<div class="alert ${a.level}"><b>${a.level === 'critical' ? '⛔' : a.level === 'warning' ? '⚠️' : 'ℹ️'} ${a.level}</b> ${esc(a.msg)}</div>`).join('')}</div>` : '<div class="alert ok"><b>✓ healthy</b> No alerts: estimator, mode switching and recovery are within thresholds.</div>';

  const kpis = `<div class="kpis">
    ${kpi('Learners', k.learners, `${k.sessions} sessions · ${k.active24h} active in 24h`)}
    ${kpi('Tasks completed', k.tasks, `${k.answers} graded answers`)}
    ${kpi('First-attempt accuracy', pct(k.firstAttemptAcc), simRef('firstAttemptAcc'))}
    ${kpi('Independent English', pct(k.independentRate), simRef('independentRate'), 'Share of tasks finished with unaided correct English')}
    ${kpi('Recovery rate', pct(k.recoveryRate), simRef('recoveryRate'), 'Initially failed tasks that ended in independent English')}
    ${kpi('Hidden knowledge', pct(k.hiddenKnowledgeRate), 'of failed-first tasks: knew it, recovered', 'Tasks a static tutor would have marked as "doesn\'t know"')}
    ${kpi('Abandonment', pct(k.abandonRate), `${fix(k.hintsPerTask, 2)} hints / task`)}
    ${kpi('Mean load', fix(k.meanLoad), `scaffold depth ${fix(k.avgScaffoldDepth, 1)} / 5`)}
  </div>`;

  const healthCard = `<div class="card"><h3>Is the model still valid? <span class="hint">estimator health on real behaviour</span></h3><div class="kpis">
    ${kpi('Load AUC', fix(h.loadAuc), `failed (n=${h.nFail}) vs correct (n=${h.nOk}) · ${simRef('loadAuc', fix)}`, 'Below 0.65 means typing behaviour no longer predicts struggle')}
    ${kpi('Load vs self-rating', h.ratingRho == null ? '—' : `ρ ${fix(h.ratingRho)}`, `${h.nRated} rated tasks (need ≥ 5)`)}
    ${kpi('Diagnosis uncertain', pct(h.uncertainRate), simRef('uncertainRate'))}
    ${kpi('Oscillation', fix(h.oscillationPerTask), 'A→B→A switches per task (alert > 0.3)')}
  </div><p class="note">These are the live checks for H1 (signals track struggle) and the hysteresis design. The simulation reference shows what the tutor achieved on synthetic learners.</p></div>`;

  const bottTotal = Object.values(d.bottlenecks).reduce((s, x) => s + x, 0);
  const modeTotal = Object.values(d.modes).reduce((s, x) => s + x, 0);
  const grid = `<div class="grid-2" style="margin-top:12px">
    <div class="card"><h3>Strategy effectiveness <span class="hint">P(next answer succeeds | rule)</span></h3>${barList(d.rules.filter(r => r.nextSuccess != null).map(r => ({ key: r.rule, label: r.rule, value: r.nextSuccess, sub: `${RULES[r.rule] || ''} · ${r.nextOk}/${r.nextN}` })))}</div>
    <div class="card"><h3>Why answers fail <span class="hint">${bottTotal} diagnosed</span></h3>${barList(Object.entries(d.bottlenecks).sort((a, b) => b[1] - a[1]).map(([b, n]) => ({ key: b, label: BOTTLENECKS[b]?.label || b, value: n / bottTotal, sub: `${n} answers` })))}
      <h3 style="margin-top:14px">Communication mode usage <span class="hint">${modeTotal} answers</span></h3>${barList(MODES.filter(m => d.modes[m.id]).map(m => ({ key: m.id, label: m.label, value: d.modes[m.id] / modeTotal })))}</div>
  </div>`;

  const conceptRows = d.concepts.map(c => `<tr><td>${esc(CONCEPT[c.concept] || c.concept)}</td><td class="num">${c.n}</td><td class="num">${pct(c.firstAttemptAcc)}</td><td class="num">${pct(c.independentRate)}</td><td class="num">${pct(c.hiddenRate)}</td><td class="num">${fix(c.meanLoad)}</td></tr>`).join('');
  const recentRows = d.recent.map(r => `<tr><td class="faint small">${ago(r.at)}</td><td>${esc(CONCEPT[r.concept] || r.concept)}${r.demo ? ' <span class="pill neutral">demo</span>' : ''}</td>
    <td><div class="path">${(r.modes || []).map((m, i) => (i ? '<span class="arr">→</span>' : '') + modeTag(m)).join('')}</div></td>
    <td><span class="pill ${OUTCOME[r.outcome]?.[1] || 'neutral'}">${OUTCOME[r.outcome]?.[0] || esc(r.outcome)}</span>${r.hidden ? ' <span class="pill ok">hidden knowledge</span>' : ''}</td><td class="small">${esc(BOTTLENECKS[r.dominant]?.label || '')}</td></tr>`).join('');

  el.innerHTML = controls + alerts + kpis +
    `<div class="card" style="margin-top:12px"><h3>Daily activity and outcomes</h3>${dailyChart(d.daily)}</div>` +
    `<div style="margin-top:12px">${healthCard}</div>` + grid +
    `<div class="grid-2" style="margin-top:12px">
      <div class="card"><h3>By concept</h3>${conceptRows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Concept</th><th>Tasks</th><th>First attempt</th><th>Independent</th><th>Hidden knowl.</th><th>Load</th></tr></thead><tbody>${conceptRows}</tbody></table></div>` : '<p class="empty">No data.</p>'}</div>
      <div class="card"><h3>Recent tasks <span class="hint">anonymous</span></h3>${recentRows ? `<div class="table-wrap"><table class="data"><tbody>${recentRows}</tbody></table></div>` : '<p class="empty">No data.</p>'}</div>
    </div>`;
}
