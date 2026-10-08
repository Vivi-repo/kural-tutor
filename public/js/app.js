// App wiring: telemetry capture, session lifecycle, persistence, demo playback, views.
import { Session } from './engine.js';
import { TASKS } from './content.js';
import { PERSONAS, simulate, nextResponse } from './demo.js';
import { renderChat, renderModelPanel } from './ui.js';
import { renderDashboard, renderDecisions, renderCounterfactual, renderSessions } from './dashboard.js';
import { installTooltip, modeTag } from './charts.js';
import { connectLLM } from './llm.js';
import { renderEval } from './eval.js';
import { renderReport } from './report.js';
import { renderMonitor, stopMonitor } from './monitor.js';
import { track } from './telemetry.js';

const $ = id => document.getElementById(id);
const STORE = 'kural.sessions.v1', PREFS = 'kural.prefs.v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: session stays in memory */ } },
};

// ---- passive telemetry: timing of input events only -------------------------
class Telemetry {
  reset() { this.d = { promptAt: performance.now(), firstKeyAt: null, keys: [], keystrokes: 0, deletions: 0, pastes: 0 }; }
  onInput(e) {
    const t = performance.now(), it = e.inputType || '';
    if (it.startsWith('delete')) this.d.deletions++;
    else if (it === 'insertFromPaste') this.d.pastes++;
    else if (it.startsWith('insert')) this.d.keystrokes++;
    else return;
    this.d.keys.push(t);
    this.d.firstKeyAt ??= t;
  }
  finish() { return { ...this.d, submitAt: performance.now() }; }
}
function describeLive(d, now) {
  const since = (now - d.promptAt) / 1000;
  const first = d.firstKeyAt != null ? `${((d.firstKeyAt - d.promptAt) / 1000).toFixed(1)}s` : 'waiting…';
  let pauses = 0, gapNow = d.keys.length ? (now - d.keys[d.keys.length - 1]) / 1000 : 0;
  for (let i = 1; i < d.keys.length; i++) if (d.keys[i] - d.keys[i - 1] > 2000) pauses++;
  return `⏱ ${since.toFixed(1)}s since prompt · first key ${first} · ${d.keystrokes} keys · ${d.deletions} deletions · ${pauses} pauses >2s${d.keys.length && gapNow > 2 ? ` · idle ${gapNow.toFixed(1)}s` : ''}`;
}

let session, llm = null, view = 'learn', pending = false, demo = null, decFilter = 'all';
const tel = new Telemetry();
const prefs = store.get(PREFS, { showModel: true });

function persist() {
  track(session, { llm: !!llm });
  const list = store.get(STORE, []).filter(s => s.id !== session.id);
  list.push(session.toJSON());
  store.set(STORE, list.slice(-40));
}

function newSession({ name, taskIds = TASKS.map(t => t.id), isDemo = false }) {
  session = new Session({ learnerName: name, taskIds, llm });
  session.demo = isDemo;
  session.start();
  tel.reset();
  persist();
  renderAll();
}

// ---- rendering ---------------------------------------------------------------
const PLACEHOLDER = {
  ENGLISH: 'Type your answer in English…', GUIDED: 'Complete the sentence — just the missing part is fine…',
  CODESWITCH: 'English, with தமிழ் words where you need them…', BILINGUAL: 'Now try it in English…', EXPLICIT: 'Now try it in English…', RECOGNITION: 'Choose an option above',
};
function renderLearn() {
  renderChat($('chat'), session, { showAnnotations: prefs.showModel, pending });
  if (prefs.showModel) renderModelPanel($('modelPanel'), session, null);
  const done = session.awaiting === 'done', choice = session.awaiting === 'choice', locked = !!demo || pending;
  $('modeChip').innerHTML = done ? '<span class="pill neutral">Session complete</span>' : modeTag(session.mode);
  const inp = $('input');
  inp.placeholder = done ? 'Session complete — start a new one above' : PLACEHOLDER[session.mode];
  inp.disabled = done || choice; inp.readOnly = locked;
  $('hintBtn').disabled = $('skipBtn').disabled = done || locked;
  $('sendBtn').disabled = done || locked || choice;
}
function renderView() {
  const el = $(`view-${view}`);
  if (view === 'dashboard') renderDashboard(el, session);
  if (view === 'decisions') renderDecisions(el, session, decFilter);
  if (view === 'counterfactual') renderCounterfactual(el, session);
  if (view === 'sessions') renderSessions(el, store.get(STORE, []), session.id);
  if (view === 'eval' && !el.dataset.loaded) { el.dataset.loaded = '1'; renderEval(el); }
  if (view === 'report' && !el.dataset.loaded) { el.dataset.loaded = '1'; renderReport(el); }
  if (view === 'monitor') renderMonitor(el);
}
function renderAll() { renderLearn(); if (view !== 'learn') renderView(); }

function setView(v) {
  if (view === 'monitor' && v !== 'monitor') stopMonitor();
  view = v;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  document.querySelectorAll('.view').forEach(s => s.dataset.active = String(s.id === `view-${v}`));
  if (v === 'learn') renderLearn(); else renderView();
}

// ---- interaction -------------------------------------------------------------
async function submit(kind, { text = '', choice = null, simTel = null } = {}) {
  if (pending || session.awaiting === 'done') return;
  if (kind === 'text' && !text.trim()) return;
  pending = true;
  const p = session.submit({ kind, text, choice, tel: simTel || tel.finish() });
  renderLearn();
  try { await p; } finally {
    pending = false;
    $('input').value = '';
    tel.reset();
    persist();
    renderAll();
  }
}

$('composer').addEventListener('submit', e => { e.preventDefault(); if (!demo) submit('text', { text: $('input').value }); });
$('input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
$('input').addEventListener('input', e => { if (!demo) tel.onInput(e); });
$('hintBtn').addEventListener('click', () => submit('hint'));
$('skipBtn').addEventListener('click', () => submit('skip'));
$('chat').addEventListener('click', e => {
  const c = e.target.closest('[data-choice]');
  if (c && !c.disabled && !demo) return submit('choice', { choice: Number(c.dataset.choice) });
  const r = e.target.closest('[data-rate]');
  if (r && !r.disabled) { const [i, n] = r.dataset.rate.split(':').map(Number); session.rate(i, n); persist(); renderLearn(); }
});
$('newSession').addEventListener('click', () => { stopDemo(); newSession({ name: $('learnerName').value.trim() || 'Learner' }); $('input').focus(); });
$('showModel').checked = prefs.showModel;
$('learnGrid').classList.toggle('no-model', !prefs.showModel);
$('showModel').addEventListener('change', e => { prefs.showModel = e.target.checked; store.set(PREFS, prefs); $('learnGrid').classList.toggle('no-model', !prefs.showModel); renderLearn(); });
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });

// Views with their own controls
document.querySelector('main').addEventListener('change', async e => {
  if (e.target.id === 'decFilter') { decFilter = e.target.value; renderView(); }
  if (e.target.id === 'importFile' && e.target.files[0]) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      const incoming = Array.isArray(data) ? data : [data];
      const list = store.get(STORE, []);
      for (const s of incoming) if (s && s.id && s.turns && !list.some(x => x.id === s.id)) list.push(s);
      store.set(STORE, list); renderView();
    } catch { e.target.value = ''; }
  }
});
document.querySelector('main').addEventListener('click', e => {
  const open = e.target.closest('[data-open]'), del = e.target.closest('[data-del]');
  if (open) { const data = store.get(STORE, []).find(s => s.id === open.dataset.open); if (data) { stopDemo(); session = new Session({ data, llm }); tel.reset(); decFilter = 'all'; setView('dashboard'); renderLearn(); } }
  if (del) { store.set(STORE, store.get(STORE, []).filter(s => s.id !== del.dataset.del)); renderView(); }
  if (e.target.id === 'exportAll') {
    const blob = new Blob([JSON.stringify(store.get(STORE, []), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kural-sessions-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  }
});

// Live signal readout while the learner types
setInterval(() => {
  if (demo || view !== 'learn' || session.awaiting !== 'text' || pending) return;
  const s = describeLive(tel.d, performance.now());
  $('liveTel').textContent = s;
  const el = $('liveSig'); if (el) el.textContent = s;
}, 400);

// ---- demo playback -------------------------------------------------------------
function stopDemo() { if (demo) demo.stop = true; }
async function runDemo() {
  if (demo) { stopDemo(); return; }
  const p = PERSONAS[$('persona').value];
  newSession({ name: `${p.name} (demo)`, taskIds: p.taskIds, isDemo: true });
  demo = { stop: false };
  $('runDemo').textContent = '■ Stop demo';
  renderLearn();
  const speed = Number($('speed').value), queues = {};
  const live = s => { $('liveTel').textContent = s; const el = $('liveSig'); if (el) el.textContent = s; };
  try {
    while (!demo.stop && session.awaiting !== 'done') {
      await sleep(2400 / Math.sqrt(speed));
      const r = nextResponse(session, p, queues), idx = session.idx;
      if (r.kind === 'choice') {
        live(`⏱ reading options… (${(r.wait / 1000).toFixed(1)}s)`);
        await sleep(r.wait / speed);
        document.querySelector(`.option[data-choice="${r.choice}"]`)?.classList.add('picked');
        await sleep(350);
        await submit('choice', { choice: r.choice, simTel: { promptAt: 0, firstKeyAt: null, keys: [], submitAt: r.wait } });
      } else {
        const inp = $('input'); inp.value = '';
        const d = { promptAt: 0, firstKeyAt: null, keys: [], keystrokes: 0, deletions: 0 };
        let vt = 0;
        for (const [op, arg] of r.steps) {
          if (demo.stop) break;
          if (op === 'wait') { vt += arg; live(describeLive(d, vt)); await sleep(arg / speed); }
          if (op === 'type') for (const ch of arg) { vt += 170; d.keys.push(vt); d.keystrokes++; d.firstKeyAt ??= vt; inp.value += ch; live(describeLive(d, vt)); await sleep(170 / speed); }
          if (op === 'del') for (let i = 0; i < arg; i++) { vt += 140; d.keys.push(vt); d.deletions++; inp.value = inp.value.slice(0, -1); live(describeLive(d, vt)); await sleep(140 / speed); }
        }
        if (demo.stop) break;
        const { text, tel: simTel } = simulate(r.steps);
        await sleep(300);
        await submit('text', { text, simTel });
      }
      if (session.idx !== idx && p.ratings[idx] != null) { await sleep(500); session.rate(idx, p.ratings[idx]); persist(); renderLearn(); }
    }
  } finally {
    demo = null;
    $('runDemo').textContent = '▶ Play demo';
    $('input').value = '';
    renderAll();
  }
}
$('runDemo').addEventListener('click', runDemo);

// ---- boot ------------------------------------------------------------------------
installTooltip();
const { adapter, health } = await connectLLM();
llm = adapter;
$('llmBadge').textContent = llm ? `Claude analysis on · ${llm.model}` : 'Rule-based analysis';
$('llmBadge').classList.toggle('on', !!llm);
$('llmBadge').title = health.status || '';
const saved = store.get(STORE, []);
const last = saved[saved.length - 1];
if (last && last.awaiting !== 'done' && !last.demo) { session = new Session({ data: last, llm }); $('learnerName').value = session.learnerName; tel.reset(); renderAll(); }
else newSession({ name: $('learnerName').value });

// Shareable autoplay: ?demo=kavya&speed=16&view=dashboard
const params = new URLSearchParams(location.search);
if (params.get('view') && !params.get('demo')) setView(params.get('view'));
if (PERSONAS[params.get('demo')]) {
  $('persona').value = params.get('demo');
  if (params.get('speed')) { const o = new Option(`${params.get('speed')}×`, params.get('speed'), true, true); $('speed').add(o); }
  await runDemo();
  if (params.get('view')) setView(params.get('view'));
}
