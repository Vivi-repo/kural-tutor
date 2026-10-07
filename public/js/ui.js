// Learner view: chat transcript + live "model reasoning" panel.
import { MODES, MODE, BOTTLENECKS, BOTTLENECK_IDS, TASK } from './content.js';
import { LOAD_HIGH, LOAD_LOW } from './estimator.js';
import { esc, pct, fix, modeTag, barList } from './charts.js';

const LETTERS = 'ABCD';

function block(b, ctx) {
  switch (b.type) {
    case 'situation': return `<div class="situation">${esc(b.en)}</div>`;
    case 'text': return `<p>${esc(b.en)}</p>${b.ta ? `<p class="ta-line" lang="ta">${esc(b.ta)}</p>` : ''}`;
    case 'tamil': return `<p class="tamil" lang="ta">${esc(b.ta)}</p>`;
    case 'starter': return `<div class="starter">${esc(b.en).replace('___', '<b>___</b>')}</div>`;
    case 'keyword': return `<span class="keyword">${esc(b.en)}</span>`;
    case 'praise': return `<p class="praise">${esc(b.en)}</p>`;
    case 'insight': return `<p class="insight">${esc(b.en)}</p>`;
    case 'model': return `<p class="model-answer">${esc(b.en)}</p>`;
    case 'wordbank': return `<div class="wordbank">${b.items.map(g => `<span class="chip-gap"><span class="src">${esc(g.source)}</span><span class="arrow">→</span><span class="en">${esc(g.en)}</span></span>`).join('')}</div>`;
    case 'explain': return `<div class="explain"><div class="ta" lang="ta">${esc(b.ta)}</div><div>${esc(b.en)}</div></div>`;
    case 'rule': return `<div class="rule-card"><b>${esc(b.rule)}</b><table>${b.pairs.map(p => `<tr><td>${esc(p[0])}</td><td>→ <b>${esc(p[1])}</b></td>${p[2] ? `<td class="ta faint">${esc(p[2])}</td>` : ''}</tr>`).join('')}</table>
      <div>${esc(b.exampleEn)}</div><div class="ta-line" lang="ta">${esc(b.exampleTa)}</div></div>`;
    case 'options': {
      const live = ctx.live && ctx.session.awaiting === 'choice';
      return `<div class="options"><div class="stem">${esc(b.en)}</div>${b.options.map((o, i) =>
        `<button class="option ${ctx.picked === o ? 'picked' : ''}" data-choice="${i}" ${live ? '' : 'disabled'}><span class="letter">${LETTERS[i]}</span>${esc(o)}</button>`).join('')}</div>`;
    }
    case 'rate': {
      const ts = ctx.session.tasks[b.taskIndex];
      const sel = ts?.selfRating;
      return `<div class="rate"><span>How hard was that? <span class="ta">எவ்வளவு கடினம்?</span></span>${[1, 2, 3, 4, 5].map(n =>
        `<button data-rate="${b.taskIndex}:${n}" class="${sel === n ? 'sel' : ''}" ${sel != null ? 'disabled' : ''} aria-label="Difficulty ${n} of 5">${n}</button>`).join('')}<span class="faint">1 easy · 5 very hard</span></div>`;
    }
  }
  return '';
}

function annotations(turn) {
  if (!turn) return '';
  const a = [];
  a.push(`<span class="${turn.correct ? 'ok' : 'bad'}">${turn.correct ? '✓ correct' : turn.meaningConveyed ? '✗ meaning OK, English not yet' : '✗ incorrect'}</span>`);
  a.push(`<span>load ${fix(turn.est.load)} · ${turn.est.level}</span>`);
  if (turn.diag && !turn.correct) a.push(`<span>${turn.diag.uncertain ? 'diagnosis uncertain' : esc(BOTTLENECKS[turn.diag.top].label)}</span>`);
  if (turn.tamilRatio > 0) a.push(`<span>Tamil ${pct(turn.tamilRatio)}</span>`);
  for (const g of turn.gaps.slice(0, 3)) a.push(`<span><span class="ta">${esc(g.source)}</span> → ${esc(g.en)}</span>`);
  if (turn.llm) a.push(`<span data-tip="${esc(turn.llm.note || '')}">Claude-assisted</span>`);
  return `<div class="annot">${a.join('')}</div>`;
}

export function renderChat(el, session, { showAnnotations = true, pending = false } = {}) {
  const msgs = session.transcript;
  const lastTutor = [...msgs].reverse().find(m => m.role === 'tutor');
  const html = msgs.map((m, i) => {
    if (m.role === 'learner') {
      const turn = m.turnId ? session.turns.find(t => t.id === m.turnId) : null;
      const label = m.kind === 'hint' ? 'Hint please' : m.kind === 'skip' ? 'Skip' : m.text || '(no answer)';
      return `<div class="msg learner"><div class="bubble ${m.kind === 'choice' ? 'choice' : ''}">${esc(label)}</div>${showAnnotations ? annotations(turn) : ''}</div>`;
    }
    const next = msgs[i + 1];
    const picked = next && next.role === 'learner' && next.kind === 'choice' ? next.text : null;
    const ctx = { session, live: m === lastTutor, picked };
    return `<div class="msg tutor">${modeTag(m.mode)}<div class="bubble">${m.blocks.map(b => block(b, ctx)).join('')}</div></div>`;
  }).join('');
  el.innerHTML = html + (pending ? '<div class="msg tutor"><div class="bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div></div>' : '');
  el.scrollTop = el.scrollHeight;
}

export function renderModelPanel(el, session, live) {
  const ts = session.ts;
  const task = session.idx >= 0 && session.idx < session.taskIds.length ? TASK[session.taskIds[session.idx]] : null;
  const turn = session.turns[session.turns.length - 1];
  const decision = [...session.decisions].reverse().find(d => d.action !== 'baseline');
  const baseline = [...session.decisions].reverse().find(d => d.action === 'baseline');
  const visited = new Set(ts?.modes || []);

  const ladder = `<div class="card"><h3>Communication mode <span class="hint">${task ? esc(task.conceptLabel) : ''}</span></h3><div class="ladder">${MODES.map(m => {
    const cur = m.id === session.mode && session.awaiting !== 'done';
    const style = cur ? `style="background:var(--rung-${m.rung});color:var(--rung-${m.rung}-ink)"` : '';
    return `<div class="rung ${cur ? 'current' : ''} ${visited.has(m.id) ? 'visited' : ''}" ${style} data-tip="${esc(m.desc)}"><span class="dot"></span><span>${esc(m.label)}</span><span class="ta">${esc(m.ta)}</span></div>`;
  }).join('')}</div>
  <p class="small faint" style="margin:8px 0 0">Next tasks start in: <b>${session.hyst.base ? 'Guided English' : 'English-only'}</b> · high-load streak ${session.hyst.high} · low-load streak ${session.hyst.low}${baseline ? ` · last change: ${esc(baseline.rule)}` : ''}</p></div>`;

  const liveCard = `<div class="card"><h3>Live signals <span class="hint">typing behaviour only — no camera, no mic</span></h3><div id="liveSig" class="small num">${live || '<span class="empty">Start typing to see latency, pauses and revisions.</span>'}</div></div>`;

  let loadCard = '<div class="card"><h3>Cognitive load</h3><p class="empty">No answers yet.</p></div>';
  if (turn) {
    const e = turn.est;
    loadCard = `<div class="card"><h3>Cognitive load <span class="hint">last answer · confidence ${fix(e.confidence)}</span></h3>
      <div class="load-head"><span class="load-num">${fix(e.load)}</span><span class="level ${e.level}">${e.level}</span></div>
      <div class="gauge"><span class="fill" style="width:${e.load * 100}%"></span><span class="tick" style="left:${LOAD_LOW * 100}%"></span><span class="tick" style="left:${LOAD_HIGH * 100}%"></span></div>
      <div class="gauge-scale"><span>0</span><span>low ${LOAD_LOW}</span><span>high ${LOAD_HIGH}</span><span>1</span></div>
      <h3 style="margin-top:12px">Signal contributions</h3>
      ${barList(e.contributions.slice(0, 7).map(c => ({ key: c.key, label: c.label, value: c.value, sub: c.raw, tip: `${c.label}: normalised ${fix(c.value)} × weight ${c.weight}` })), { format: v => fix(v) })}</div>`;
  }

  let diagCard = '<div class="card"><h3>Bottleneck diagnosis</h3><p class="empty">Runs when an answer is wrong or load is high.</p></div>';
  if (turn?.diag) {
    const dg = turn.diag;
    diagCard = `<div class="card"><h3>Why are they struggling? <span class="hint">${dg.uncertain ? 'uncertain — will probe' : `top ${pct(dg.p)}`}</span></h3>
      ${barList(BOTTLENECK_IDS.map(b => ({ key: b, label: BOTTLENECKS[b].label, value: dg.dist[b] })).sort((a, b) => b.value - a.value), { highlight: dg.uncertain ? null : dg.top })}
      ${dg.evidence.length ? `<ul class="evidence">${dg.evidence.map(e => `<li><b>${esc(BOTTLENECKS[e.b].label)}</b> +${e.w}: ${esc(e.why)}</li>`).join('')}</ul>` : ''}</div>`;
  } else if (turn) {
    diagCard = `<div class="card"><h3>Bottleneck diagnosis</h3><p class="empty">Last answer was correct at manageable load — no diagnosis needed.</p></div>`;
  }

  const decCard = decision ? `<div class="card"><h3>Decision <span class="decision-rule">${esc(decision.rule)}</span></h3>
      <div class="small muted">${esc(decision.ruleText)}</div>
      <div class="transition">${modeTag(decision.from)}<span>→</span>${decision.to ? modeTag(decision.to) : '<span class="pill neutral">next task</span>'}</div>
      <div>${esc(decision.rationale)}</div>
      <div class="static-alt"><b>A static tutor would:</b> ${esc(decision.staticAlt)}</div></div>`
    : '<div class="card"><h3>Decision</h3><p class="empty">The adaptation policy\'s choices appear here.</p></div>';

  let skillCard = '';
  if (task) {
    const v = session.learner.view(task.concept);
    skillCard = `<div class="card"><h3>Learner state <span class="hint">${esc(task.conceptLabel)}</span></h3>
      ${barList([['comprehension', 'Comprehension'], ['recognition', 'Recognition'], ['guided', 'Guided production'], ['production', 'Free production']].map(([k, l]) => ({ key: k, label: l, value: v[k].mean, sub: `evidence weight ${+v[k].n.toFixed(1)}` })))}
      <p class="small muted" style="margin:8px 0 0">Knows-but-can't-produce gap: <b>${v.hiddenKnowledge > 0 ? '+' + pct(v.hiddenKnowledge) : '—'}</b></p></div>`;
  }
  el.innerHTML = ladder + liveCard + loadCard + diagCard + decCard + skillCard;
}
