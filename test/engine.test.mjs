// Headless run of every demo persona through the real engine. Prints the decision
// trace and asserts the pathways each persona was written to demonstrate.
import assert from 'node:assert/strict';
import { Session } from '../public/js/engine.js';
import { PERSONAS, simulate, nextResponse } from '../public/js/demo.js';
import { computeMetrics } from '../public/js/metrics.js';
import { grade, analyzeLanguage } from '../public/js/lang.js';
import { TASK } from '../public/js/content.js';

async function run(key) {
  const p = PERSONAS[key];
  const s = new Session({ learnerName: p.name, taskIds: p.taskIds });
  s.start();
  const queues = {};
  let guard = 0;
  while (s.awaiting !== 'done' && guard++ < 80) {
    const r = nextResponse(s, p, queues);
    const idx = s.idx;
    if (r.kind === 'choice') await s.submit({ kind: 'choice', choice: r.choice, tel: { promptAt: 0, firstKeyAt: null, keys: [], submitAt: r.wait } });
    else { const { text, tel } = simulate(r.steps); await s.submit({ kind: 'text', text, tel }); }
    if (s.idx !== idx && p.ratings[idx] != null) s.rate(idx, p.ratings[idx]);
  }
  console.log(`\n=== ${p.name} ===`);
  for (const d of s.decisions) {
    const t = s.turns.find(t => t.id === d.turnId);
    console.log(`[${d.taskId}] ${(t?.text || '').slice(0, 42).padEnd(42)} load=${d.load?.toFixed(2)} ${(d.level || '').padEnd(4)} dx=${(d.diagTop || '-').padEnd(16)} ${d.rule.padEnd(15)} ${d.from}→${d.to || 'next'}`);
  }
  const m = computeMetrics(s.toJSON());
  console.log('KPI', JSON.stringify(m.kpi));
  console.log('validity', JSON.stringify(m.validity));
  console.log('outcomes', m.tasks.map(t => `${t.taskId}:${t.outcome}:${t.adaptiveVerdict}`).join(' | '));
  return { s, m };
}

const k = await run('kavya');
const rules = k.s.decisions.map(d => d.rule);
assert.deepEqual(k.s.decisions.filter(d => d.taskId === 'past-go').map(d => d.rule).slice(0, 2), ['R8-PROBE', 'R3-STEP-DOWN']);
assert.ok(rules.includes('R4-HOLD'), 'articles: calm error held');
assert.ok(rules.includes('R10-CONTRAST'), 'transfer → bilingual contrast');
assert.ok(rules.includes('R6-BRIDGE'), 'code-switch gaps bridged');
assert.ok(rules.includes('R5-CLARIFY'), 'puriyala → Tamil clarification');
assert.equal(k.m.kpi.hiddenKnowledge, 5);
assert.equal(k.s.tasks.find(t => t.taskId === 'third-person').outcome, 'first-try');

const a = await run('arun');
const past = a.s.tasks.find(t => t.taskId === 'past-go');
assert.equal(past.knowledgeConfirmed, true);
assert.ok(a.s.decisions.some(d => d.rule === 'R12-TEACH'));
assert.equal(past.hiddenKnowledge, false, 'genuine gap must not count as hidden knowledge');

const mn = await run('meena');
assert.ok(mn.s.decisions.every(d => d.rule === 'R1-INDEPENDENT'), 'fluent learner: no adaptation');

// Language analysis unit checks
const g = analyzeLanguage('I keep phone table-la', {});
assert.equal(g.caseMarkers.length, 1);
assert.equal(analyzeLanguage('I want to engage', {}).gaps.length, 0, 'no false Tanglish hit on English words');
assert.equal(grade(TASK['past-go'], 'went to the market', 'GUIDED').correct, true);
assert.equal(grade(TASK['articles'], 'There is a apple on the table.', 'ENGLISH').correct, false);
assert.equal(grade(TASK['questions'], 'நான் எங்க', 'ENGLISH').lang.tamilRatio, 1);
console.log('\nAll assertions passed.');
