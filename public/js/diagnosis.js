// Bottleneck diagnosis: WHY is the learner struggling?
// Additive evidence scores → softmax distribution over six hypotheses.
// Each piece of evidence is recorded so the dashboard can show the reasoning.
import { BOTTLENECK_IDS } from './content.js';

export function diagnose({ kind, analysis, choice, task, est, taskState, skill }) {
  const score = Object.fromEntries(BOTTLENECK_IDS.map(b => [b, 0]));
  const evidence = [];
  const add = (b, w, why) => { score[b] += w; evidence.push({ b, w, why }); };
  const high = est.level === 'HIGH', elevated = est.load >= 0.45;

  if (kind === 'choice') {
    const why = task.recognition.why[choice] || '';
    if (/tamil/i.test(why)) { add('L1_TRANSFER', 2.2, `Chose the Tamil-structure distractor (${why})`); add('KNOWLEDGE', 1.5, 'Recognition failed'); }
    else add('KNOWLEDGE', 3, `Recognition failed: picked "${task.recognition.options[choice]}" (${why})`);
    return finish(score, evidence);
  }

  const a = analysis, h = a.hedges, gapsFromTask = a.lang.gaps.filter(g => g.fromTask || g.kind === 'grammatical');

  if (h.dontUnderstand) add('MISUNDERSTANDING', 3.2, 'Said they did not understand the question');
  if (!a.meaningConveyed && a.contentWords >= 2 && !h.any) add('MISUNDERSTANDING', 1.6, 'Answer is off-topic for the question');
  if (h.cantSay) add('EXPRESSION', 3, 'Said they know it but cannot say it in English');
  if (a.lang.tamilRatio > 0 && a.meaningConveyed) {
    add('EXPRESSION', 2.2 + Math.min(1.2, 0.5 * gapsFromTask.length), `Conveyed the meaning using Tamil (${a.lang.gaps.map(g => g.source).join(', ') || a.lang.unknownTamil.join(', ')})`);
  }
  const transfer = a.errors.filter(e => e.transfer);
  if (transfer.length) add('L1_TRANSFER', 2.5, `Tamil-structure error: ${transfer.map(e => e.label).join('; ')}`);
  if (h.forgot) add('RETRIEVAL', 2.5, 'Said they forgot the word');
  if (a.disfluency.selfCorrections + a.disfluency.restarts + a.disfluency.fillers >= 2) add('RETRIEVAL', 1.5, 'Self-corrections and restarts: searching for a form');
  // History is a prior, not an observation: when the answer itself shows a specific
  // error pattern, that direct evidence should dominate (halve the history weight).
  const histW = a.errors.length ? 0.5 : 1;
  if (skill && skill.recognition.mean >= 0.65 && skill.production.mean < 0.55) add('RETRIEVAL', 1.5 * histW, 'History: recognises this concept but production lags');
  if (taskState.recognitionResult === true) add('RETRIEVAL', 1.2 * histW, 'Recognised the correct form earlier in this task');
  const nonTransfer = a.errors.filter(e => !e.transfer);
  if (nonTransfer.length && est.level === 'LOW') add('KNOWLEDGE', 1.6, `Fast, confident error (${nonTransfer[0].label}) — looks like a rule not yet learned`);
  if (h.dontKnow) { add('KNOWLEDGE', 1.2, 'Said "I don\'t know"'); add('RETRIEVAL', 0.6, '"I don\'t know" can also mean "can\'t recall right now"'); }
  if (taskState.recognitionResult === false) add('KNOWLEDGE', 3, 'Failed the recognition check in this task');
  if (elevated && a.meaningConveyed && !transfer.length) add('OVERLOAD', high ? 2 : 1.6, 'Elevated load while the meaning is right');
  if (high && taskState.attempts >= 2) add('OVERLOAD', 1, 'Load stayed high across attempts');
  if (skill && skill.production.mean >= 0.65 && high) add('OVERLOAD', 1.2, 'Usually produces this concept fine — today\'s task is the problem');
  if (a.empty) { add('OVERLOAD', 0.8, 'Gave up (empty answer)'); add('RETRIEVAL', 0.5, 'Empty answer'); add('KNOWLEDGE', 0.5, 'Empty answer'); }
  for (const b of taskState.bottlenecks.slice(-2)) add(b, 0.3, 'Consistent with earlier diagnosis in this task');

  return finish(score, evidence);
}

function finish(score, evidence) {
  const ids = Object.keys(score);
  const exps = ids.map(b => Math.exp(score[b]));
  const z = exps.reduce((s, x) => s + x, 0);
  const dist = Object.fromEntries(ids.map((b, i) => [b, +(exps[i] / z).toFixed(3)]));
  const ranked = ids.sort((x, y) => dist[y] - dist[x]);
  const top = ranked[0];
  const margin = dist[ranked[0]] - dist[ranked[1]];
  return { dist, top, p: dist[top], margin: +margin.toFixed(3), uncertain: dist[top] < 0.4 || evidence.length === 0, evidence };
}
