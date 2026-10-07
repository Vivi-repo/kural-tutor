// Small dependency-free chart helpers (SVG + HTML) with a shared hover tooltip.
import { MODES, MODE } from './content.js';
import { LOAD_HIGH, LOAD_LOW } from './estimator.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (x, d = 0) => x == null ? '—' : `${(x * 100).toFixed(d)}%`;
export const fix = (x, d = 2) => x == null ? '—' : Number(x).toFixed(d);

export function modeTag(id, extra = '') {
  const m = MODE[id];
  return `<span class="mode-tag ${extra}" style="background:var(--rung-${m.rung});color:var(--rung-${m.rung}-ink)">${esc(m.label)}</span>`;
}

export function barList(rows, { max = 1, format = v => pct(v), highlight = null } = {}) {
  if (!rows.length) return '<p class="empty">No data yet.</p>';
  return `<div class="barlist">${rows.map(r => `
    <div class="barrow ${highlight === r.key ? 'top' : ''}" ${r.tip ? `data-tip="${esc(r.tip)}"` : ''}>
      <span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="track"><span class="bar" style="width:${Math.max(0, Math.min(1, r.value / max)) * 100}%;${r.color ? `background:${r.color}` : ''}"></span></span>
      <span class="val">${format(r.value, r)}</span>
      ${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}
    </div>`).join('')}</div>`;
}

const W = 1100, PADL = 120, PADR = 16;
const xAt = (i, n) => PADL + (n <= 1 ? (W - PADL - PADR) / 2 : (i * (W - PADL - PADR)) / (n - 1));

function taskBands(tl, top, bottom) {
  let out = '';
  for (let i = 0; i < tl.length; i++) {
    if (i === 0 || tl[i].taskIndex !== tl[i - 1].taskIndex) {
      const x = i === 0 ? PADL - 8 : (xAt(i, tl.length) + xAt(i - 1, tl.length)) / 2;
      if (i > 0) out += `<line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" stroke="var(--grid)" stroke-dasharray="3 3"/>`;
      const right = x + 60 > W - PADR;
      out += `<text x="${right ? W - PADR : x + 6}" y="${top + 10}" ${right ? 'text-anchor="end"' : ''}>Task ${tl[i].taskIndex + 1}</text>`;
    }
  }
  return out;
}

// Cognitive load over graded turns. Filled marker = correct, hollow = incorrect.
export function loadChart(tl) {
  if (!tl.length) return '<p class="empty">Answer a few questions to see the load timeline.</p>';
  const H = 220, top = 14, bottom = H - 26, y = v => bottom - v * (bottom - top);
  const n = tl.length;
  const pts = tl.map((t, i) => [xAt(i, n), y(t.load)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cognitive load per answer">`;
  s += `<rect x="${PADL}" y="${y(1)}" width="${W - PADL - PADR}" height="${y(LOAD_HIGH) - y(1)}" fill="var(--critical)" opacity=".06"/>`;
  for (const [v, lbl] of [[0, '0'], [LOAD_LOW, `low < ${LOAD_LOW}`], [LOAD_HIGH, `high ≥ ${LOAD_HIGH}`], [1, '1.0']]) {
    s += `<line x1="${PADL}" x2="${W - PADR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" ${v === LOAD_LOW || v === LOAD_HIGH ? 'stroke-dasharray="4 4"' : ''}/>`;
    s += `<text x="${PADL - 8}" y="${y(v) + 4}" text-anchor="end" class="axis-label">${lbl}</text>`;
  }
  s += taskBands(tl, top, bottom);
  s += `<path d="${path}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/>`;
  tl.forEach((t, i) => {
    const [cx, cy] = pts[i];
    const tip = `Answer ${i + 1} · Task ${t.taskIndex + 1}\nMode: ${MODE[t.mode].label}\nLoad ${t.load.toFixed(2)} (${t.level}) · ${t.correct ? 'correct' : 'incorrect'}${t.diag ? `\nDiagnosis: ${t.diag}` : ''}\n“${(t.text || '').slice(0, 60)}”`;
    s += `<circle cx="${cx}" cy="${cy}" r="5" fill="${t.correct ? 'var(--series-1)' : 'var(--surface)'}" stroke="${t.correct ? 'var(--surface)' : 'var(--series-1)'}" stroke-width="2"/>`;
    s += `<circle class="hit" cx="${cx}" cy="${cy}" r="13" data-tip="${esc(tip)}"/>`;
  });
  s += `<text x="${PADL}" y="${H - 6}">answers in order →</text></svg>`;
  return `<div class="chart-wrap">${s}</div><div class="legend"><span><span class="sw" style="background:var(--series-1)"></span>Correct</span><span><span class="sw hollow"></span>Incorrect</span><span>Shaded band = high load</span></div>`;
}

// Support level (mode rung) per graded turn — same x positions as the load chart.
export function supportChart(tl) {
  if (!tl.length) return '';
  const rungs = MODES.length, H = 190, top = 10, bottom = H - 14;
  const y = r => top + ((rungs - 1 - r) * (bottom - top)) / (rungs - 1);
  const n = tl.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Support level per answer">`;
  MODES.forEach(m => {
    s += `<line x1="${PADL}" x2="${W - PADR}" y1="${y(m.rung)}" y2="${y(m.rung)}" stroke="var(--grid)"/>`;
    s += `<text x="${PADL - 8}" y="${y(m.rung) + 4}" text-anchor="end" class="axis-label">${esc(m.label)}</text>`;
  });
  let d = '';
  tl.forEach((t, i) => {
    const x = xAt(i, n), yy = y(t.rung);
    if (i === 0) d += `M${x},${yy}`;
    else { const xm = (x + xAt(i - 1, n)) / 2; d += `L${xm},${y(tl[i - 1].rung)}L${xm},${yy}L${x},${yy}`; }
  });
  s += `<path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="2"/>`;
  tl.forEach((t, i) => {
    const x = xAt(i, n), yy = y(t.rung);
    s += `<circle cx="${x}" cy="${yy}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="1.5"/>`;
    s += `<circle class="hit" cx="${x}" cy="${yy}" r="12" data-tip="${esc(`Answer ${i + 1}: ${MODE[t.mode].label}\n${t.correct ? 'correct' : 'incorrect'}`)}"/>`;
  });
  return `<div class="chart-wrap">${s}</svg></div>`;
}

// Dumbbell: production vs recognition vs comprehension per concept.
export function skillDumbbell(concepts) {
  if (!concepts.length) return '<p class="empty">No concepts practised yet.</p>';
  const series = [['production', 'Free production', 'var(--series-2)'], ['recognition', 'Recognition', 'var(--series-1)'], ['comprehension', 'Comprehension', 'var(--series-3)']];
  const rows = concepts.map(c => {
    const vals = series.map(([k]) => c[k].mean);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const dots = series.map(([k, lbl, col]) => `<span class="db-dot" style="left:${c[k].mean * 100}%;background:${col}" data-tip="${esc(`${c.label}\n${lbl}: ${pct(c[k].mean)} (n=${c[k].n})`)}"></span>`).join('');
    return `<div class="db-row"><span>${esc(c.label)}</span><span class="db-track"><span class="db-line" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></span>${dots}</span>
      <span class="db-val" data-tip="Hidden knowledge = what they know (recognition / comprehension) minus what they can produce">${c.hiddenKnowledge > 0.05 ? `+${pct(c.hiddenKnowledge)}` : '—'}</span></div>`;
  }).join('');
  return `<div class="dumbbell">${rows}</div><div class="legend">${series.map(([, l, c]) => `<span><span class="sw" style="background:${c}"></span>${l}</span>`).join('')}<span>Right column: hidden knowledge gap</span></div>`;
}

export function installTooltip() {
  const tip = document.getElementById('tooltip');
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
  });
  document.addEventListener('mousemove', e => {
    if (tip.hidden) return;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  });
}
