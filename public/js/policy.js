// Adaptation policy: (load, diagnosis, task state) → next communication mode.
// Principles:
//   • Scaffold, don't substitute — minimum intervention that addresses the diagnosed bottleneck.
//   • Lower the linguistic barrier, never the intellectual task.
//   • Climb back down toward English-only as soon as the learner recovers.
//   • Don't switch modes on one calm mistake (hysteresis).
import { MODE, BOTTLENECKS } from './content.js';

export const MAX_ATTEMPTS = 7;

export const RULES = {
  'R1-INDEPENDENT':  'Correct English with no support → move on',
  'R2-RECOVERED':    'Correct independent English after scaffolding → recovery confirmed',
  'R3-STEP-DOWN':    'Succeeded with support → withdraw one layer of support',
  'R4-HOLD':         'One calm, fast mistake → targeted feedback, keep the mode (hysteresis)',
  'R5-CLARIFY':      'Misunderstood the question → ask it in Tamil, answer stays English',
  'R6-BRIDGE':       'Expression gap with located missing words → word bank + guided English',
  'R7-INVITE-L1':    'Expression gap, words not located → invite code-switching to find the gap',
  'R8-PROBE':        'Retrieval hypothesis → test with recognition (knowledge without production pressure)',
  'R9-KEYWORD':      'Retrieval gap, recognition already passed → guided English + keyword cue',
  'R10-CONTRAST':    'Tamil-structure transfer → bilingual contrastive explanation',
  'R11-CONFIRM':     'Knowledge-gap hypothesis untested → recognition check before teaching',
  'R12-TEACH':       'Knowledge gap confirmed → explicit bilingual teaching',
  'R13-SIMPLIFY':    'Overload → simplify the interaction (rephrase + sentence starter)',
  'R14-UNCERTAIN':   'Diagnosis uncertain → probe with recognition (most informative next step)',
  'R15-ESCALATE':    'No specific rule fits → one rung more support',
  'R16-CAP':         'Attempt cap reached → model answer, revisit later',
  'R17-HINT':        'Learner asked for a hint → next minimal hint',
  'R18-SKIP':        'Learner skipped → log abandonment, move on',
  'H1-RAISE-BASE':   'Load > high threshold for 2+ interactions → start next tasks with a sentence starter',
  'H2-LOWER-BASE':   'Load < low threshold for 3 interactions → return to English-only start',
};

export function dominant(ts) {
  const c = {};
  for (const b of ts.bottlenecks) c[b] = (c[b] || 0) + 1;
  return Object.keys(c).sort((x, y) => c[y] - c[x] || ts.bottlenecks.lastIndexOf(y) - ts.bottlenecks.lastIndexOf(x))[0] || null;
}

const nextUp = m => ({ ENGLISH: 'GUIDED', GUIDED: 'RECOGNITION', RECOGNITION: 'CODESWITCH', CODESWITCH: 'BILINGUAL', BILINGUAL: 'EXPLICIT', EXPLICIT: 'EXPLICIT' }[m]);

export function staticTutorAction(correct, task) {
  return correct ? 'Mark correct → next question' : `Mark wrong → show "${task.model}" → log knowledge gap in ${task.conceptLabel}`;
}

function decideCore({ kind, mode, analysis, est, diag, ts, task, opts = {} }) {
  const d = (rule, action, to, rationale, extra = {}) => ({ rule, ruleText: RULES[rule], action, from: mode, to, rationale, ...extra });

  if (kind === 'skip') return d('R18-SKIP', 'next-task', null, 'Learner abandoned the task; recorded as an abandonment signal.');
  if (kind === 'hint') {
    if (mode === 'ENGLISH') return d('R17-HINT', 'guided', 'GUIDED', 'Smallest available help: a sentence starter.');
    if (mode === 'GUIDED' && !ts.keywordShown) return d('R17-HINT', 'keyword', 'GUIDED', 'Starter already shown → add a keyword cue.');
    const to = nextUp(mode);
    return d('R17-HINT', actionFor(to), to, `Hint requested again → one rung up to ${MODE[to].label}.`);
  }

  const correct = kind === 'choice' ? analysis.correct : analysis.correct;

  // ---- success paths -------------------------------------------------------
  if (correct) {
    if (mode === 'ENGLISH') {
      if (ts.failures > 0) {
        return d('R2-RECOVERED', 'recovered', null,
          `Independent English after support. The block was ${BOTTLENECKS[dominant(ts)]?.label.toLowerCase() || 'production pressure'}, not the concept.`);
      }
      return d('R1-INDEPENDENT', 'next-task', null,
        est.level === 'HIGH' ? 'Correct but effortful (high load) — noted as fragile; no support needed.' : 'Correct and fluent.');
    }
    if (mode === 'RECOGNITION') return d('R3-STEP-DOWN', 'guided', 'GUIDED', 'Recognised the correct form → knowledge is present. Back to production with a starter.');
    if (mode === 'GUIDED') return d('R3-STEP-DOWN', 'recheck', 'ENGLISH', 'Produced it with a starter → remove the starter and check independent English.');
    if (est.level === 'HIGH') return d('R3-STEP-DOWN', 'guided', 'GUIDED', `Correct in ${MODE[mode].label} mode but load is still high → step down gently to guided English.`);
    return d('R3-STEP-DOWN', 'recheck', 'ENGLISH', `Correct with ${MODE[mode].label.toLowerCase()} support and load is manageable → straight back to English-only.`);
  }

  // Code-switched answer that carried the meaning is a *partial* success: it located the gap.
  if (mode === 'CODESWITCH' && analysis.meaningConveyed && analysis.lang.gaps.length) {
    return d('R6-BRIDGE', 'bridge', 'GUIDED', 'Meaning conveyed in mixed Tamil–English → the gap is located; give exactly those English words and ask again.', { gaps: analysis.lang.gaps });
  }

  if (ts.attempts >= MAX_ATTEMPTS) return d('R16-CAP', 'reveal', null, 'Too many attempts — show the model answer and revisit this concept later.');

  // ---- hysteresis: one calm mistake is not a reason to change channel ------
  if (!opts.noHold && kind === 'text' && mode === 'ENGLISH' && !ts.held && est.level === 'LOW' && !analysis.hedges.any && !analysis.empty && analysis.lang.tamilRatio === 0) {
    return d('R4-HOLD', 'hold', 'ENGLISH', 'Low load, single error → targeted feedback in English; no mode switch yet.', { focus: analysis.errors[0]?.label });
  }

  // ---- struggle: route by diagnosed bottleneck -----------------------------
  const top = diag.uncertain ? null : diag.top;
  switch (top) {
    case 'MISUNDERSTANDING':
      if (!ts.clarified) return d('R5-CLARIFY', 'clarify', 'CODESWITCH', 'The question, not the English, was the barrier → restate it in Tamil.');
      return d('R13-SIMPLIFY', 'guided', 'GUIDED', 'Already clarified in Tamil → simplify further with a starter.');
    case 'EXPRESSION':
      if (analysis.lang.gaps.length) return d('R6-BRIDGE', 'bridge', 'GUIDED', 'Knows the meaning; missing English words are located → word bank.', { gaps: analysis.lang.gaps });
      if (mode !== 'CODESWITCH') return d('R7-INVITE-L1', 'codeswitch', 'CODESWITCH', 'Knows what to say but not how → allow Tamil to pinpoint the missing English.');
      return d('R10-CONTRAST', 'bilingual', 'BILINGUAL', 'Code-switching did not surface the gap → explain bilingually.');
    case 'RETRIEVAL':
      if (ts.recognitionResult == null) return d('R8-PROBE', 'recognition', 'RECOGNITION', 'Hesitation + self-correction suggest the form exists but won\'t come out → test recognition.');
      return d('R9-KEYWORD', 'keyword', 'GUIDED', 'Recognition already passed → cue retrieval with a keyword and starter.');
    case 'L1_TRANSFER':
      if (!ts.contrasted) return d('R10-CONTRAST', 'bilingual', 'BILINGUAL', 'Error follows Tamil grammar → contrast Tamil and English structure directly.');
      return d('R13-SIMPLIFY', 'guided', 'GUIDED', 'Contrast already given → practise the structure with a starter.');
    case 'KNOWLEDGE':
      if (ts.recognitionResult == null && mode !== 'RECOGNITION') return d('R11-CONFIRM', 'recognition', 'RECOGNITION', 'Before concluding "doesn\'t know", check recognition — a static tutor would stop here.');
      return d('R12-TEACH', 'explicit', 'EXPLICIT', 'Recognition also failed → this is a genuine knowledge gap; teach it explicitly.');
    case 'OVERLOAD':
      if (mode === 'ENGLISH') return d('R13-SIMPLIFY', 'guided', 'GUIDED', 'High load with the meaning intact → reduce demands: rephrase + starter.');
      if (ts.recognitionResult == null) return d('R8-PROBE', 'recognition', 'RECOGNITION', 'Still overloaded with a starter → drop production pressure entirely.');
      return d('R10-CONTRAST', 'bilingual', 'BILINGUAL', 'Overload persists → move explanation into Tamil.');
    default:
      if (ts.recognitionResult == null && mode !== 'RECOGNITION') return d('R14-UNCERTAIN', 'recognition', 'RECOGNITION', `No hypothesis above 40% (top: ${diag.top} ${(diag.p * 100) | 0}%) → recognition separates knowledge from production.`);
      { const to = nextUp(mode); return d('R15-ESCALATE', actionFor(to), to, 'Struggle continues without a clear signature → one rung more support.'); }
  }
}

function actionFor(mode) {
  return { GUIDED: 'guided', RECOGNITION: 'recognition', CODESWITCH: 'codeswitch', BILINGUAL: 'bilingual', EXPLICIT: 'explicit', ENGLISH: 'recheck' }[mode];
}

// Policy variants for ablation studies. opts:
//   noHold      – switch modes on the first calm mistake (no hysteresis)
//   noProbe     – never use recognition to test a hypothesis
//   englishOnly – never communicate through Tamil (no clarify / code-switch / bridge / bilingual)
//   ladder      – ignore the diagnosis: every failure climbs one rung
export function decide(ctx) {
  const opts = ctx.opts || {};
  const { kind, mode, analysis, ts, task } = ctx;
  const d = (rule, action, to, rationale) => ({ rule, ruleText: RULES[rule], action, from: mode, to, rationale });
  const struggling = kind !== 'hint' && kind !== 'skip' && analysis && !analysis.correct;
  if (opts.ladder && struggling && ts.attempts < MAX_ATTEMPTS) {
    const core = decideCore(ctx);
    if (core.rule === 'R4-HOLD' || core.rule === 'R16-CAP') return core;
    const to = nextUp(mode);
    return d('R15-ESCALATE', actionFor(to), to, 'Ladder ablation: diagnosis ignored, one rung up.');
  }
  let res = decideCore(ctx);
  if (opts.englishOnly && (['CODESWITCH', 'BILINGUAL'].includes(res.to) || res.rule === 'R6-BRIDGE')) {
    res = ts.keywordShown ? d('R12-TEACH', 'explicit', 'EXPLICIT', 'English-only ablation: explain explicitly instead of using Tamil.')
                          : d('R9-KEYWORD', 'keyword', 'GUIDED', 'English-only ablation: English cue instead of Tamil.');
  }
  if (opts.noProbe && res.to === 'RECOGNITION' && kind !== 'hint') {
    res = ctx.diag && ctx.diag.top === 'KNOWLEDGE' ? d('R12-TEACH', 'explicit', 'EXPLICIT', 'No-probe ablation: teach without checking recognition.')
        : ts.keywordShown ? d('R10-CONTRAST', 'bilingual', 'BILINGUAL', 'No-probe ablation.') : d('R9-KEYWORD', 'keyword', 'GUIDED', 'No-probe ablation: cue instead of probing.');
    if (opts.englishOnly && res.to === 'BILINGUAL') res = d('R12-TEACH', 'explicit', 'EXPLICIT', 'No-probe + English-only ablation.');
  }
  return res;
}
