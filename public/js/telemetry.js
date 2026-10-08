// Anonymous session metrics for the live Monitor. Sends numbers and labels only:
// no learner name and no typed answers ever leave the browser.
const ANON_KEY = 'kural.anon.v1';

function anonId() {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) { id = 'a' + crypto.getRandomValues(new Uint32Array(3)).reduce((s, x) => s + x.toString(36), ''); localStorage.setItem(ANON_KEY, id); }
    return id;
  } catch { return 'a' + Math.random().toString(36).slice(2, 12); }
}

export function summarize(session, { llm = false } = {}) {
  return {
    id: session.id, anon: anonId(), demo: !!session.demo, llm, done: session.awaiting === 'done', startedAt: session.startedAt,
    tasks: session.tasks.filter(Boolean).map(t => ({
      taskId: t.taskId, concept: t.concept, outcome: t.outcome, firstCorrect: t.firstAttempt ? (t.firstAttempt.correct && t.firstAttempt.mode === 'ENGLISH') : null,
      maxRung: t.maxRung, modes: t.modes, attempts: t.attempts, failures: t.failures, hints: t.hints, hidden: !!t.hiddenKnowledge,
      knowledgeConfirmed: !!t.knowledgeConfirmed, dominant: t.dominant ?? null, rating: t.selfRating,
      meanLoad: t.loads.length ? t.loads.reduce((a, b) => a + b, 0) / t.loads.length : null, endedAt: t.endedAt ?? null,
    })),
    turns: session.turns.map(t => ({ ti: t.taskIndex, mode: t.mode, kind: t.kind, ok: t.correct, mc: t.meaningConveyed, load: t.est.load, diag: t.diag?.top ?? null, unc: t.diag ? t.diag.uncertain : null, tamil: t.tamilRatio, t: t.t })),
    decisions: session.decisions.map(d => ({ rule: d.rule, from: d.from, to: d.to, ti: d.taskIndex, seq: d.seq, action: d.action })),
  };
}

let timer = null, lastSig = '', latest = null;
const signature = s => `${s.id}|${s.tasks.filter(t => t?.outcome).length}|${s.tasks.map(t => t?.selfRating ?? '').join(',')}|${s.awaiting === 'done'}|${Math.floor(s.turns.length / 5)}`;

function send(body, beacon = false) {
  const payload = JSON.stringify(body);
  try {
    if (beacon && navigator.sendBeacon) return navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
    fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  } catch { /* monitoring is best-effort */ }
}

// Debounced: sends when a task completes, a rating changes, the session ends, or every 5 answers.
export function track(session, opts) {
  if (!session || !session.turns.length) return;
  latest = { session, opts };
  const sig = signature(session);
  if (sig === lastSig) return;
  clearTimeout(timer);
  timer = setTimeout(() => { lastSig = sig; send(summarize(session, opts)); }, 2000);
}

addEventListener('pagehide', () => {
  if (!latest || !latest.session.turns.length) return;
  send(summarize(latest.session, latest.opts), true);
});
