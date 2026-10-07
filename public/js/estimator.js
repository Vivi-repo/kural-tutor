// Cognitive-load estimator: a transparent weighted model over passive behavioural
// signals. Every feature is normalised to 0..1 and reported with its contribution,
// so each mode switch can be traced back to evidence.

export const WEIGHTS = {
  latency:    0.22, // time before first keystroke / to answer
  pauses:     0.14, // mid-answer pauses > 2 s
  revisions:  0.14, // deletion ratio (backspaces / keystrokes)
  disfluency: 0.12, // um / uh / "... no" / restarts in the text
  hedging:    0.10, // "I don't know", "puriyala", "solla theriyala"
  retries:    0.08, // attempts already spent on this task
  hints:      0.06, // hint requests on this task
  brevity:    0.04, // answer much shorter than the learner's own baseline
  l1drift:    0.04, // unprompted switch into Tamil
  error:      0.06, // the answer was wrong
};
export const FEATURE_LABELS = {
  latency: 'Response latency', pauses: 'Pauses', revisions: 'Revisions / deletions', disfluency: 'Disfluency',
  hedging: 'Hedging', retries: 'Retries', hints: 'Hint requests', brevity: 'Answer shrinkage', l1drift: 'Switch to Tamil', error: 'Error',
};
export const LOAD_HIGH = 0.6, LOAD_LOW = 0.35;
export const MEAN_W = 0.6, PEAK_W = 0.4;

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const norm = (x, lo, hi) => clamp((x - lo) / (hi - lo));
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export function summarizeTelemetry(tel) {
  if (!tel) return null;
  const keys = tel.keys || [];
  let pauses = 0, longestPause = 0;
  for (let i = 1; i < keys.length; i++) {
    const gap = keys[i] - keys[i - 1];
    if (gap > 2000) pauses++;
    longestPause = Math.max(longestPause, gap);
  }
  return {
    firstKeyMs: tel.firstKeyAt != null ? tel.firstKeyAt - tel.promptAt : null,
    totalMs: tel.submitAt - tel.promptAt,
    keystrokes: tel.keystrokes || 0, deletions: tel.deletions || 0, pastes: tel.pastes || 0,
    pauses, longestPause,
  };
}

// baseline: { firstKey: number[], words: number[] } from the learner's own calm, correct turns.
export function estimateLoad({ kind, mode, tel, analysis, attempt, hints, baseline, taskId }) {
  const f = {}; const raw = {};
  const isChoice = kind === 'choice';
  const s = tel;
  if (s) {
    if (isChoice) {
      f.latency = norm(s.totalMs, 3000, 14000); raw.latency = `${(s.totalMs / 1000).toFixed(1)}s to choose`;
    } else if (s.firstKeyMs != null) {
      const b = median(baseline.firstKey);
      const lo = b ? Math.max(1500, b * 1.1) : 1500;
      const typingBudget = (s.keystrokes || 0) * 260;
      f.latency = 0.65 * norm(s.firstKeyMs, lo, lo + 9000) + 0.35 * norm(s.totalMs - typingBudget - s.firstKeyMs, 2000, 20000);
      raw.latency = `${(s.firstKeyMs / 1000).toFixed(1)}s before typing${b ? ` (your usual ≈ ${(b / 1000).toFixed(1)}s)` : ''}`;
    }
    if (!isChoice && s.keystrokes > 0) {
      f.pauses = 0.5 * Math.min(s.pauses / 3, 1) + 0.5 * norm(s.longestPause, 1500, 8000);
      raw.pauses = `${s.pauses} pause${s.pauses === 1 ? '' : 's'} > 2s, longest ${(s.longestPause / 1000).toFixed(1)}s`;
      const ratio = s.deletions / Math.max(1, s.keystrokes);
      f.revisions = norm(ratio, 0.04, 0.4);
      raw.revisions = `${s.deletions} deletions / ${s.keystrokes} keys`;
    }
  }
  if (!isChoice && analysis) {
    f.disfluency = analysis.disfluency.score;
    const d = analysis.disfluency;
    raw.disfluency = `${d.fillers} fillers, ${d.selfCorrections} self-corrections, ${d.ellipses} trail-offs`;
    const h = analysis.hedges;
    f.hedging = h.any ? 1 : (h.unsure && !analysis.passed && taskId !== 'questions' ? 0.5 : 0);
    raw.hedging = Object.entries(h).filter(([k, v]) => v && k !== 'any').map(([k]) => k).join(', ') || 'none';
    if (mode !== 'GUIDED') {
      const bw = median(baseline.words) || 6;
      f.brevity = analysis.empty ? 1 : norm(bw - analysis.lang.words, 0, bw);
      raw.brevity = `${analysis.lang.words} words (baseline ≈ ${bw})`;
    }
    if (mode !== 'CODESWITCH' && mode !== 'BILINGUAL') {
      f.l1drift = analysis.lang.tamilRatio;
      raw.l1drift = `${Math.round(analysis.lang.tamilRatio * 100)}% Tamil tokens`;
    }
  }
  f.retries = Math.min((attempt - 1) / 4, 1); raw.retries = `attempt ${attempt}`;
  f.hints = Math.min(hints / 2, 1); raw.hints = `${hints} hint${hints === 1 ? '' : 's'}`;
  if (analysis) { f.error = analysis.correct ? 0 : 1; raw.error = analysis.correct ? 'correct' : 'incorrect'; }

  let num = 0, den = 0;
  const contributions = [];
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (f[k] == null || Number.isNaN(f[k])) continue;
    num += w * f[k]; den += w;
    contributions.push({ key: k, label: FEATURE_LABELS[k], value: f[k], weight: w, raw: raw[k] });
  }
  // Struggle rarely lights up every signal at once; a few strong signals matter more than
  // many quiet ones. Blend the weighted mean with the mean of the three strongest signals.
  const top3 = [...contributions].sort((a, b) => b.value - a.value).slice(0, 3);
  const peak = top3.length ? top3.reduce((s, c) => s + c.value, 0) / 3 : 0;
  const load = den ? MEAN_W * (num / den) + PEAK_W * peak : 0;
  for (const c of contributions) c.contribution = MEAN_W * (c.weight * c.value) / den + (top3.includes(c) ? PEAK_W * c.value / 3 : 0);
  contributions.sort((a, b) => b.contribution - a.contribution);
  const calibration = Math.min(1, 0.55 + 0.09 * baseline.firstKey.length);
  const confidence = +(den * calibration).toFixed(2);
  const level = load >= LOAD_HIGH ? 'HIGH' : load >= LOAD_LOW ? 'MED' : 'LOW';
  return { load: +load.toFixed(3), level, confidence, contributions };
}
