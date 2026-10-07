// Synthetic learners with hidden ground truth.
//
// Per concept the learner has:
//   K  knows the concept (bool)            – can it be produced at all?
//   R  retrieval under pressure (0..1)     – P(producing it in free English when known)
//   L  lexical gap (bool)                  – missing English words for this situation
//   T  Tamil-structure transfer (0..1)     – P(building the sentence with Tamil grammar)
//   U  comprehension of English prompts    – P(understanding the question)
// Learner-wide: O overload susceptibility, speed, and noise (typos, slips, random Tamil,
// skipping, hint spam, inconsistent latency).
//
// Every generated wrong answer carries its true cause, so the tutor's diagnosis can be
// scored against ground truth. Learning effects (EFFECTS) are MODELLED ASSUMPTIONS.
import { TASK } from '../public/js/content.js';
import { BANK, HEDGES } from './bank.mjs';

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = { next, chance: p => next() < p, pick: arr => arr[Math.floor(next() * arr.length)], range: (lo, hi) => lo + next() * (hi - lo), int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    normal: () => { const u = Math.max(1e-9, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } };
  r.lognormal = sigma => Math.exp(sigma * r.normal());
  return r;
}

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const BASE_NOISE = { typo: 0.03, slip: 0.04, style: 0.3, randomTamil: 0.03, skip: 0.01, hint: 0.03, sigma: 0.35, rateMissing: 0.15 };

// Archetype priors. [lo, hi] ranges are sampled per concept → every learner is inconsistent across concepts.
export const ARCHETYPES = {
  fluent:        { label: 'Fluent', pKnow: 0.95, R: [0.85, 0.97], pL: 0.05, T: [0, 0.08], U: [0.93, 0.99], O: [0, 0.15], speed: 1 },
  slowFluent:    { label: 'Slow but fluent', pKnow: 0.93, R: [0.82, 0.95], pL: 0.05, T: [0, 0.1], U: [0.9, 0.98], O: [0.05, 0.2], speed: 2.3 },
  silentKnower:  { label: 'Knows it, freezes', pKnow: 0.88, R: [0.2, 0.45], pL: 0.15, T: [0.05, 0.2], U: [0.85, 0.95], O: [0.3, 0.5], speed: 1.2 },
  lexicalGap:    { label: 'Missing English words', pKnow: 0.85, R: [0.5, 0.75], pL: 0.7, T: [0.05, 0.2], U: [0.8, 0.92], O: [0.2, 0.4], speed: 1.2 },
  transferHeavy: { label: 'Tamil-structure transfer', pKnow: 0.82, R: [0.55, 0.8], pL: 0.2, T: [0.5, 0.8], U: [0.82, 0.94], O: [0.1, 0.3], speed: 1 },
  beginner:      { label: 'Genuine beginner', pKnow: 0.25, R: [0.3, 0.6], pL: 0.5, T: [0.3, 0.6], U: [0.5, 0.75], O: [0.3, 0.5], speed: 1.3 },
  anxious:       { label: 'Anxious / overloaded', pKnow: 0.82, R: [0.35, 0.6], pL: 0.2, T: [0.1, 0.3], U: [0.8, 0.92], O: [0.7, 0.9], speed: 1.5 },
  misreader:     { label: 'Misreads questions', pKnow: 0.75, R: [0.55, 0.75], pL: 0.2, T: [0.1, 0.3], U: [0.35, 0.6], O: [0.2, 0.4], speed: 1.1 },
  careless:      { label: 'Fast and careless', pKnow: 0.85, R: [0.75, 0.9], pL: 0.1, T: [0.05, 0.2], U: [0.85, 0.95], O: [0, 0.2], speed: 0.6, noise: { slip: 0.2, typo: 0.15, style: 0.6 } },
  erratic:       { label: 'Erratic / inconsistent', pKnow: 0.6, R: [0.3, 0.9], pL: 0.35, T: [0.1, 0.6], U: [0.5, 0.95], O: [0.1, 0.8], speed: 1.2, noise: { slip: 0.15, typo: 0.1, randomTamil: 0.15, skip: 0.1, hint: 0.2, sigma: 0.7, rateMissing: 0.4 } },
  mixed:         { label: 'Mixed per concept', mixed: ['silentKnower', 'lexicalGap', 'transferHeavy', 'beginner', 'fluent'] },
};

// MODELLED learning effects of each tutor action on the hidden state (assumptions, not data).
export const EFFECTS = {
  teachK: { explicit: 0.55, bilingual: 0.3, keyword: 0.15, hold: 0.1, reveal: 0.15 },
  transferMult: { explicit: 0.6, bilingual: 0.45, hold: 0.85, reveal: 0.85, retry: 0.95 },
  closeLexical: { bridge: 0.65, reveal: 0.2, explicit: 0.25 },
  retrieval: { recognition: 0.02, guided: 0.02, keyword: 0.04, explicit: 0.05, bilingual: 0.03, successEnglish: 0.06, successAfterStruggle: 0.06, successSupported: 0.03 },
  comprehension: { clarify: 0.15 },
};
export function scaleEffects(f) {
  const out = structuredClone(EFFECTS);
  for (const grp of Object.values(out)) for (const k of Object.keys(grp)) {
    if (grp === out.transferMult) grp[k] = 1 - (1 - grp[k]) * f; else grp[k] *= f;
  }
  return out;
}

export function makeLearner(id, archetype, seed, taskIds) {
  const r = rng(seed);
  const arch = ARCHETYPES[archetype];
  const concepts = {};
  let speed = 1, O = 0, noise = { ...BASE_NOISE };
  for (const tid of taskIds) {
    const a = arch.mixed ? ARCHETYPES[r.pick(arch.mixed)] : arch;
    concepts[TASK[tid].concept] = {
      K: r.chance(a.pKnow), R: r.range(...a.R), L: r.chance(a.pL), T: r.range(...a.T), U: r.range(...a.U), _O: r.range(...a.O), _speed: a.speed,
    };
  }
  const cs = Object.values(concepts);
  O = cs.reduce((s, c) => s + c._O, 0) / cs.length;
  speed = cs.reduce((s, c) => s + c._speed, 0) / cs.length * r.lognormal(0.2);
  if (arch.noise) Object.assign(noise, arch.noise);
  return { id, archetype, label: arch.label, seed, concepts, O, speed, noise };
}

export const cloneLearner = l => structuredClone(l);

// ---------- text + keystroke generation ----------
function typo(r, s) {
  const words = s.split(' ');
  const idx = words.map((w, i) => [w, i]).filter(([w]) => /^[a-z]{4,}$/i.test(w));
  if (!idx.length) return s;
  const [w, i] = r.pick(idx);
  const p = r.int(0, w.length - 2);
  words[i] = w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2);
  return words.join(' ');
}
function style(r, s) { let t = s; if (r.chance(0.5)) t = t.toLowerCase(); if (r.chance(0.5)) t = t.replace(/[.!]$/, ''); return t; }

const LAT = { null: 1, NOISE: 1, RETRIEVAL: 2.6, OVERLOAD: 3.2, EXPRESSION: 2.0, KNOWLEDGE: 0.9, KNOWLEDGE_HEDGE: 1.8, L1_TRANSFER: 1.0, MISUNDERSTANDING: 2.2 };

function keystrokes(r, learner, text, cause) {
  const n = learner.noise;
  const base = 2000 * learner.speed * (LAT[cause] ?? 1) * r.lognormal(n.sigma);
  const steps = [['wait', Math.round(base)]];
  const chunks = text.split(/(?<= )/);
  const pauses = cause === 'RETRIEVAL' ? r.int(2, 3) : cause === 'OVERLOAD' ? r.int(3, 4) : cause === 'EXPRESSION' || cause === 'KNOWLEDGE_HEDGE' ? r.int(1, 2) : learner.speed > 1.8 ? r.int(0, 1) : (r.chance(0.1) ? 1 : 0);
  let revisions = cause === 'RETRIEVAL' || cause === 'OVERLOAD' ? r.int(1, 2) : r.chance(0.08 + 0.2 * learner.O) ? 1 : 0;
  const pauseAt = new Set(Array.from({ length: pauses }, () => r.int(0, Math.max(0, chunks.length - 1))));
  chunks.forEach((c, i) => {
    if (revisions > 0 && r.chance(0.5)) { const wrong = r.pick(['go ', 'is ', 'the ', 'I ', 'no ']); steps.push(['type', wrong], ['wait', r.int(300, 1200)], ['del', wrong.length]); revisions--; }
    if (pauseAt.has(i)) steps.push(['wait', Math.round(r.range(2200, 6500) * (cause === 'OVERLOAD' ? 1.3 : 1))]);
    steps.push(['type', c]);
  });
  return steps;
}

// Generate one learner action for the tutor's current state.
// ctx: { task, mode, awaiting, taskFlags: { wordBank, keyword, contrasted, clarified, hints }, pressure }
export function respond(r, learner, ctx) {
  const { task, mode, awaiting, flags } = ctx;
  const c = learner.concepts[task.concept];
  const n = learner.noise;
  const B = BANK[task.id];

  if (awaiting === 'choice') {
    let choice, cause = null;
    if (c.K && r.chance(0.92)) choice = task.recognition.answer;
    else if (!c.K && r.chance(1 / 3)) choice = task.recognition.answer;
    else {
      const wrong = task.recognition.options.map((_, i) => i).filter(i => i !== task.recognition.answer);
      const tamilIdx = wrong.find(i => /tamil/i.test(task.recognition.why[i] || ''));
      choice = tamilIdx != null && r.chance(c.T) ? tamilIdx : r.pick(wrong);
      cause = !c.K ? 'KNOWLEDGE' : 'NOISE';
    }
    const wait = Math.round(2500 * learner.speed * (c.K ? 1 : 1.8) * r.lognormal(n.sigma));
    return { kind: 'choice', choice, cause, wait };
  }

  const guided = ['GUIDED', 'BILINGUAL', 'EXPLICIT'].includes(mode);
  const plan = planText(r, learner, c, B, ctx, guided);
  if (plan.kind !== 'text') return plan;
  let { text, cause } = plan;
  if (r.chance(n.randomTamil)) text = `${text} ${r.pick(['romba', 'ah', 'konjam'])}`;
  if (r.chance(n.typo)) { text = typo(r, text); if (!cause) cause = 'NOISE?'; }
  if (r.chance(n.style)) text = style(r, text);
  const latCause = cause === 'KNOWLEDGE' && plan.hedge ? 'KNOWLEDGE_HEDGE' : cause === 'NOISE?' ? null : cause;
  return { kind: 'text', text, cause, steps: keystrokes(r, learner, text, latCause) };
}

function planText(r, learner, c, B, ctx, guided) {
  const { mode, flags } = ctx;
  const n = learner.noise;
  const willStruggle = !c.K || c.T > 0.5 || c.R < 0.5 || learner.O > 0.6;
  if (r.chance(n.skip * (c.K ? 1 : 2.5))) return { kind: 'skip', cause: c.K ? 'NOISE' : 'KNOWLEDGE' };
  if (flags.hints < 2 && (mode === 'ENGLISH' || mode === 'GUIDED') && r.chance(n.hint * (willStruggle ? 3 : 1))) return { kind: 'hint' };

  const understands = flags.clarified || guided || r.chance(c.U);
  if (!understands) {
    return r.chance(0.55) ? { kind: 'text', text: r.pick(HEDGES.dontUnderstand), cause: 'MISUNDERSTANDING', hedge: true }
      : { kind: 'text', text: r.pick(B.offtopic), cause: 'MISUNDERSTANDING' };
  }
  if (!c.K) {
    if (r.chance(0.08)) return { kind: 'text', text: r.pick(guided ? B.guidedCorrect : B.correct), cause: null }; // lucky guess
    const u = r.next();
    if (u < 0.7) return { kind: 'text', text: r.pick(guided ? B.guidedWrong : B.knowledge), cause: 'KNOWLEDGE' };
    if (u < 0.85) return { kind: 'text', text: r.pick(HEDGES.dontKnow), cause: 'KNOWLEDGE', hedge: true };
    return { kind: 'text', text: r.pick(B.fragments), cause: 'KNOWLEDGE', hedge: true };
  }
  const lexical = c.L && !(flags.wordBank && r.chance(0.85));
  if (lexical) {
    if (mode === 'CODESWITCH' || r.chance(0.55)) return { kind: 'text', text: r.pick(B.codeswitch), cause: 'EXPRESSION' };
    if (r.chance(0.55)) return { kind: 'text', text: r.pick(HEDGES.cantSay), cause: 'EXPRESSION' };
    return { kind: 'text', text: r.pick(B.fragments), cause: 'EXPRESSION' };
  }
  if (r.chance(c.T * (flags.contrasted ? 0.35 : 1))) {
    return { kind: 'text', text: guided ? r.pick(B.guidedWrong) : r.pick(B.transfer), cause: 'L1_TRANSFER' };
  }
  const p = guided ? clamp(c.R + 0.3 + (flags.keyword ? 0.1 : 0)) * (1 - 0.15 * learner.O)
    : clamp(c.R + (mode === 'CODESWITCH' ? 0.1 : 0)) * (1 - 0.45 * learner.O);
  if (r.chance(p)) {
    if (r.chance(n.slip)) return { kind: 'text', text: r.pick(guided ? B.guidedWrong : B.knowledge), cause: 'NOISE' };
    return { kind: 'text', text: r.pick(guided ? B.guidedCorrect : B.correct), cause: null };
  }
  if (r.chance(learner.O)) return { kind: 'text', text: r.pick(B.fragments), cause: 'OVERLOAD' };
  const u = r.next();
  if (u < 0.4) return { kind: 'text', text: r.pick(B.fragments), cause: 'RETRIEVAL' };
  if (u < 0.75) return { kind: 'text', text: `${r.pick(guided ? B.guidedWrong : B.knowledge).replace(/\.$/, '')}... no...`, cause: 'RETRIEVAL' };
  return { kind: 'text', text: r.pick(HEDGES.forgot), cause: 'RETRIEVAL', hedge: true };
}

// Apply modelled learning from a tutor action.
export function learn(r, learner, concept, action, effects = EFFECTS) {
  const c = learner.concepts[concept];
  if (!c.K && effects.teachK[action] && r.chance(effects.teachK[action])) c.K = true;
  if (effects.transferMult[action]) c.T *= effects.transferMult[action];
  if (c.L && effects.closeLexical[action] && r.chance(effects.closeLexical[action])) c.L = false;
  if (effects.retrieval[action]) c.R = clamp(c.R + effects.retrieval[action]);
  if (effects.comprehension[action]) c.U = clamp(c.U + effects.comprehension[action], 0, 0.98);
}

export function selfRating(r, learner, failures, attempts) {
  if (r.chance(learner.noise.rateMissing)) return null;
  const d = (attempts ? failures / attempts : 0) * 0.7 + learner.O * 0.3;
  return Math.max(1, Math.min(5, Math.round(1 + 4 * d + 0.8 * r.normal())));
}
