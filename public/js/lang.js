// Language analysis for Tamil-English learner text: code-switch detection,
// gap extraction (which English the learner was missing), hedges, disfluency.
import { GLOBAL_LEXICON, FUNCTION_WORDS } from './content.js';

const TAMIL_RE = /[஀-௿]/;
const CASE_SUFFIX = /^([a-z]{3,})-(la|le|ku|kku|ukku|il|oda|kitta|ah)$/;
const NOUN_SUFFIX = /^([a-z]{3,}?)(la|ku|kku|ukku|oda|kitta)$/;
const ENGLISH_NOUNS = new Set('table school college office bag house room kitchen bus phone market shop temple hospital class beach park home pillow bed desk chair box cinema bike friend'.split(' '));
const ROMAN_SUFFIX = /^-?(ku|kku|ukku|la|le|il|oda|kitta|ah|a|u|um|ai|p|pa|nga|e|ve)?$/;
const CASE_MEANING = { la: 'in / on / at', le: 'in / on / at', il: 'in / on', ku: 'to', kku: 'to', ukku: 'to', oda: 'with', kitta: 'with / near', ah: '(emphasis)' };

const HEDGES = {
  cantSay:        [/solla\s*theriyal/i, /solla\s*therila/i, /சொல்லத்?\s*தெரிய/, /how (do|to) (you |i )?say/i, /in english\??$/i, /english\s*la\s*(eppadi|epdi)/i, /eppadi\s*sol/i, /எப்படி\s*சொல்/, /don'?t know (the|how to say|the word)/i, /what is .* in english/i],
  dontUnderstand: [/puriyal/i, /puriyala/i, /புரியல/, /புரியவில்லை/, /don'?t understand/i, /what do you mean/i, /meaning\??/i, /enna\s*artham/i, /artham/i, /can you repeat/i, /^\s*(what|sorry)\s*\?+\s*$/i],
  forgot:         [/forgot|forget|forgotten/i, /marand?h?u/i, /maranth/i, /மறந்து/, /tip of my tongue/i],
  dontKnow:       [/(i )?(don'?t|dont|do not) know/i, /no idea/i, /theriyal|theriyadhu|theriyathu|teriyala|therila/i, /தெரியல|தெரியாது/],
  unsure:         [/not sure/i, /\bmaybe\b/i, /i think/i, /\?\s*$/],
};
const FILLER_RE = /\b(um+|uh+|hmm+|mm+|er+|ah+|umm+)\b/gi;
const SELF_CORR_RE = /\b(no+,? (wait|sorry)|i mean|sorry|no no|wait)\b|\.\.\.\s*no\b/gi;

export function tokenize(text) {
  return (text || '').split(/[\s,.!?;:"“”()]+/).map(s => s.trim()).filter(Boolean)
    .map(raw => ({ raw, norm: raw.toLowerCase().replace(/[’']/g, "'") }));
}

function lookup(norm, lex) {
  if (lex[norm]) return { key: norm, en: lex[norm] };
  // Longest-prefix match handles inflected forms: சந்தைக்குப் → சந்தைக்கு, kadaiku → kadai.
  const isTamil = TAMIL_RE.test(norm);
  let best = null;
  for (const k of Object.keys(lex)) {
    if (!norm.startsWith(k) || (best && k.length <= best.key.length)) continue;
    // Romanised keys only match when the remainder is a Tamil suffix, so "engage" never matches "enga".
    if (isTamil ? k.length >= 2 : (k.length >= 4 && ROMAN_SUFFIX.test(norm.slice(k.length)))) best = { key: k, en: lex[k] };
  }
  return best;
}

export function analyzeLanguage(text, taskLexicon = {}) {
  const tokens = tokenize(text);
  const lex = { ...GLOBAL_LEXICON, ...taskLexicon };
  const gaps = [], unknownTamil = [], caseMarkers = [];
  let tamilCount = 0, taskHits = 0;
  for (const t of tokens) {
    const isTamilScript = TAMIL_RE.test(t.raw);
    const hit = lookup(t.norm, lex);
    if (hit) {
      tamilCount++;
      if (taskLexicon[hit.key]) taskHits++;
      gaps.push({ source: t.raw, en: hit.en, kind: 'lexical', fromTask: !!taskLexicon[hit.key] });
      continue;
    }
    if (isTamilScript) { tamilCount++; unknownTamil.push(t.raw); continue; }
    // English noun + Tamil case marker: "table-la", "schoolku" → missing preposition.
    const m = t.norm.match(CASE_SUFFIX) || (t.norm.match(NOUN_SUFFIX) && ENGLISH_NOUNS.has(t.norm.match(NOUN_SUFFIX)[1]) ? t.norm.match(NOUN_SUFFIX) : null);
    if (m) {
      tamilCount += 0.5;
      caseMarkers.push({ source: t.raw, noun: m[1], suffix: m[2] });
      gaps.push({ source: t.raw, en: `${CASE_MEANING[m[2]] || 'preposition'} + the ${m[1]}`, kind: 'grammatical', fromTask: true });
    }
  }
  const tamilRatio = tokens.length ? Math.min(1, tamilCount / tokens.length) : 0;
  const contentTokens = tokens.filter(t => !FUNCTION_WORDS.has(t.norm) && !/^\W+$/.test(t.norm));
  return { tokens, words: tokens.length, contentWords: contentTokens.length, tamilRatio, gaps, unknownTamil, caseMarkers, taskHits };
}

export function detectHedges(text) {
  const out = {};
  for (const [k, list] of Object.entries(HEDGES)) out[k] = list.some(re => re.test(text || ''));
  // "solla theriyala" contains "theriyala" — it is an expression hedge, not a knowledge hedge.
  if (out.cantSay) out.dontKnow = false;
  out.any = out.cantSay || out.dontUnderstand || out.forgot || out.dontKnow;
  return out;
}

export function disfluency(text) {
  const t = text || '';
  const fillers = (t.match(FILLER_RE) || []).length;
  const selfCorrections = (t.match(SELF_CORR_RE) || []).length;
  const ellipses = (t.match(/\.\.\.|…/g) || []).length;
  // Restarts: the same opening word repeated ("I... I go... I")
  const toks = tokenize(t).map(x => x.norm);
  let restarts = 0;
  for (let i = 1; i < toks.length; i++) if (toks[i] === toks[0] && toks[i].length <= 3) restarts++;
  return { fillers, selfCorrections, ellipses, restarts, score: Math.min(1, (fillers + 1.5 * selfCorrections + 0.5 * ellipses + 0.5 * restarts) / 3) };
}

// Grade a learner's answer to a task in a given mode.
export function grade(task, text, mode, { useRetry = false } = {}) {
  let composed = (text || '').trim();
  if (['GUIDED', 'BILINGUAL', 'EXPLICIT'].includes(mode) && task.starter && !useRetry) {
    const head = task.starter.split('___')[0].trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ');
    if (head && !composed.toLowerCase().includes(head)) composed = task.starter.replace('___', composed);
  }
  const lang = analyzeLanguage(composed, task.lexicon);
  const hedges = detectHedges(text);
  const dis = disfluency(text);
  const englishOnly = composed.replace(/[஀-௿]+/g, ' ');
  const passed = task.pass.some(re => re.test(englishOnly));
  const errors = task.errors.filter(e => e.re.test(englishOnly)).map(({ id, label, transfer }) => ({ id, label, transfer }));
  if (lang.caseMarkers.length) errors.push({ id: 'case-marker', label: 'Tamil case marker on an English noun (-la / -ku)', transfer: true });
  const correct = passed && errors.length === 0 && lang.tamilRatio < 0.15 && !hedges.dontUnderstand;
  const meaningConveyed = passed || task.meaningCues.test(englishOnly) || lang.taskHits > 0;
  const empty = (text || '').trim().length === 0;
  const uncertain = !passed && errors.length === 0 && meaningConveyed && lang.tamilRatio < 0.15; // regex coverage gap → ask LLM if available
  return { composed, correct, passed, errors, meaningConveyed, empty, uncertain, hedges, disfluency: dis, lang };
}
