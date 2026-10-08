// Session orchestrator: Observe → estimate load → diagnose bottleneck → adapt mode
// → measure recovery → update learner model. Pure logic (no DOM) so it runs in Node tests.
import { TASKS, TASK, MODE, BOTTLENECKS } from './content.js';
import { grade } from './lang.js';
import { estimateLoad, summarizeTelemetry } from './estimator.js';
import { diagnose } from './diagnosis.js';
import { decide, dominant, staticTutorAction, RULES } from './policy.js';
import { LearnerModel } from './learner.js';

let _id = 0;
const lcFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const uid = p => `${p}${Date.now().toString(36)}${(_id++).toString(36)}`;

function newTaskState(task, index, startMode, turnIndex) {
  return {
    index, taskId: task.id, concept: task.concept, startMode, phase: 'main',
    attempts: 0, failures: 0, hints: 0, held: false, clarified: false, contrasted: false, keywordShown: false,
    recognitionResult: null, knowledgeConfirmed: false, modes: [startMode], maxRung: MODE[startMode].rung,
    bottlenecks: [], gaps: [], transferErrors: [], loads: [], firstAttempt: null,
    outcome: null, selfRating: null, startedTurn: turnIndex, endedTurn: null, turnsToRecovery: null, wordBank: null,
  };
}

export class Session {
  constructor({ learnerName = 'Learner', taskIds = TASKS.map(t => t.id), llm = null, data = null, policyOpts = {} } = {}) {
    this.policyOpts = policyOpts;
    this.llm = llm;
    if (data) { Object.assign(this, data); this.learner = new LearnerModel(data.learner); return; }
    this.id = uid('s');
    this.learnerName = learnerName;
    this.startedAt = Date.now();
    this.taskIds = taskIds;
    this.learner = new LearnerModel();
    this.turns = []; this.decisions = []; this.tasks = []; this.transcript = [];
    this.hyst = { high: 0, low: 0, base: 0 };
    this.idx = -1; this.mode = 'ENGLISH'; this.awaiting = 'text';
  }

  get task() { return TASK[this.taskIds[this.idx]]; }
  get ts() { return this.tasks[this.idx]; }

  toJSON() {
    const { llm, policyOpts, ...rest } = this;
    return structuredClone({ ...rest, learner: { ...this.learner } });
  }

  start() { return this._startTask(0); }

  _push(msg) { const m = { id: uid('m'), t: Date.now(), ...msg }; this.transcript.push(m); return m; }

  _startTask(i) {
    if (i >= this.taskIds.length) {
      this.awaiting = 'done'; this.endedAt = Date.now();
      return [this._push({ role: 'tutor', mode: 'ENGLISH', blocks: [{ type: 'text', en: 'Session complete — நன்றி! Open the Dashboard to see what the model learned about you.' }], end: true })];
    }
    this.idx = i;
    const task = this.task;
    const startMode = this.hyst.base === 1 ? 'GUIDED' : 'ENGLISH';
    this.mode = startMode;
    this.tasks[i] = newTaskState(task, i, startMode, this.turns.length);
    this.awaiting = 'text';
    const blocks = [{ type: 'situation', en: `${i + 1}/${this.taskIds.length} · ${task.situation}` }, { type: 'text', en: task.prompt }];
    if (startMode === 'GUIDED') blocks.push({ type: 'starter', en: task.starter });
    return [this._push({ role: 'tutor', mode: startMode, blocks })];
  }

  rate(taskIndex, n) {
    if (this.tasks[taskIndex]) this.tasks[taskIndex].selfRating = n;
  }

  async submit({ kind, text = '', choice = null, tel = null }) {
    if (this.awaiting === 'done') return { messages: [] };
    const task = this.task, ts = this.ts, mode = this.mode;
    const learnerMsg = this._push({ role: 'learner', kind, text: kind === 'choice' ? task.recognition.options[choice] : text, mode });

    if (kind === 'hint' || kind === 'skip') {
      if (kind === 'hint') ts.hints++;
      const decision = decide({ kind, mode, ts, task, opts: this.policyOpts });
      this._logDecision(decision, null, null, null, task, ts, kind);
      return { decision, messages: [learnerMsg, ...this._apply(decision, null)] };
    }

    ts.attempts++;
    const telS = summarizeTelemetry(tel);
    let analysis;
    if (kind === 'choice') {
      analysis = { correct: choice === task.recognition.answer, choice, composed: task.recognition.options[choice], meaningConveyed: true, errors: [], lang: { gaps: [], tamilRatio: 0, words: 0 } };
    } else {
      analysis = grade(task, text, mode, { useRetry: ts.phase === 'retry' });
      if (this.llm && (analysis.uncertain || analysis.lang.unknownTamil.length)) await this._llmAssist(task, text, mode, analysis);
    }

    const est = estimateLoad({ kind, mode, tel: telS, analysis: kind === 'choice' ? null : analysis, attempt: ts.attempts, hints: ts.hints, baseline: this.learner.baseline, taskId: task.id });
    est.firstKeyMs = telS?.firstKeyMs ?? null;
    const correct = analysis.correct;
    const skill = this.learner.view(task.concept);
    const diag = (!correct || est.level === 'HIGH') ? diagnose({ kind, analysis, choice, task, est, taskState: ts, skill }) : null;

    if (!ts.firstAttempt) ts.firstAttempt = { correct, mode, load: est.load };
    if (!correct) { ts.failures++; if (diag && !diag.uncertain) ts.bottlenecks.push(diag.top); }
    if (kind === 'choice') { ts.recognitionResult = correct; if (!correct) ts.knowledgeConfirmed = true; }
    ts.loads.push(est.load);
    if (analysis.lang) for (const g of analysis.lang.gaps) if (!ts.gaps.some(x => x.source === g.source)) ts.gaps.push(g);
    for (const e of analysis.errors || []) if (e.transfer && !ts.transferErrors.includes(e.label)) ts.transferErrors.push(e.label);

    this.learner.observe({ concept: task.concept, mode, kind, correct, analysis: kind === 'choice' ? null : analysis, diag, est });

    const turn = {
      id: uid('t'), t: Date.now(), taskIndex: this.idx, taskId: task.id, concept: task.concept, mode, phase: ts.phase, kind,
      text: kind === 'choice' ? task.recognition.options[choice] : text, composed: analysis.composed, correct,
      meaningConveyed: analysis.meaningConveyed, errors: analysis.errors, gaps: analysis.lang?.gaps || [], tamilRatio: analysis.lang?.tamilRatio || 0,
      llm: analysis.llm || null, tel: telS, est, diag,
    };
    this.turns.push(turn);
    learnerMsg.turnId = turn.id;

    const decision = decide({ kind, mode, analysis, est, diag, ts, task, opts: this.policyOpts });
    this._logDecision(decision, turn, est, diag, task, ts, kind);
    this._hysteresis(est, turn, task);
    return { turn, decision, messages: [learnerMsg, ...this._apply(decision, analysis)] };
  }

  async _llmAssist(task, text, mode, analysis) {
    try {
      const r = await this.llm.analyze({ task: { prompt: task.prompt, model: task.model, concept: task.conceptLabel }, text, mode });
      if (!r) return;
      analysis.llm = r;
      if (analysis.uncertain && r.english_correct) { analysis.correct = true; analysis.passed = true; }
      if (r.meaning_conveyed) analysis.meaningConveyed = true;
      for (const g of r.gaps || []) if (!analysis.lang.gaps.some(x => x.source === g.source)) analysis.lang.gaps.push({ source: g.source, en: g.english, kind: g.kind || 'lexical', fromTask: true, viaLLM: true });
    } catch { /* LLM is optional; local analysis stands */ }
  }

  _hysteresis(est, turn, task) {
    const h = this.hyst;
    if (est.level === 'HIGH') { h.high++; h.low = 0; } else if (est.level === 'LOW') { h.low++; h.high = 0; } else { h.high = 0; h.low = 0; }
    if (h.high >= 2 && h.base === 0) {
      h.base = 1;
      this._logDecision({ rule: 'H1-RAISE-BASE', ruleText: RULES['H1-RAISE-BASE'], action: 'baseline', from: 'ENGLISH', to: 'GUIDED', rationale: 'Two consecutive high-load interactions — upcoming tasks open with a sentence starter.' }, turn, est, null, task, this.ts, 'system');
    } else if (h.low >= 3 && h.base === 1) {
      h.base = 0;
      this._logDecision({ rule: 'H2-LOWER-BASE', ruleText: RULES['H2-LOWER-BASE'], action: 'baseline', from: 'GUIDED', to: 'ENGLISH', rationale: 'Three consecutive low-load interactions — upcoming tasks return to English-only.' }, turn, est, null, task, this.ts, 'system');
    }
  }

  _logDecision(decision, turn, est, diag, task, ts, kind) {
    const evidence = [];
    if (est) for (const c of est.contributions.slice(0, 3)) if (c.value > 0.05) evidence.push(`${c.label}: ${c.raw}`);
    if (diag) for (const e of diag.evidence.filter(e => e.b === diag.top).slice(0, 2)) evidence.push(e.why);
    this.decisions.push({
      id: uid('d'), t: Date.now(), seq: this.turns.length, turnId: turn?.id || null, taskIndex: this.idx, taskId: task.id, concept: task.conceptLabel, kind,
      rule: decision.rule, ruleText: decision.ruleText, action: decision.action, from: decision.from, to: decision.to, rationale: decision.rationale,
      load: est?.load ?? null, level: est?.level ?? null, diagTop: diag?.top ?? null, diagP: diag?.p ?? null, uncertain: diag?.uncertain ?? null,
      correct: turn ? turn.correct : null, evidence,
      staticAlt: kind === 'system' ? 'No equivalent — a static tutor has no learner state' : kind === 'hint' ? 'Show the full answer' : kind === 'skip' ? 'Next question' : staticTutorAction(turn.correct, task),
    });
  }

  _finishTask(outcome) {
    const ts = this.ts, task = this.task;
    ts.outcome = outcome; ts.endedTurn = this.turns.length; ts.endedAt = Date.now();
    const dom = dominant(ts);
    const firstOk = ts.firstAttempt?.correct && ts.firstAttempt.mode === 'ENGLISH';
    ts.dominant = dom;
    ts.staticVerdict = ts.firstAttempt == null ? 'No answer' : firstOk ? `Knows ${task.conceptLabel}` : `Doesn't know ${task.conceptLabel}`;
    ts.adaptiveVerdict = outcome === 'skipped' ? 'Abandoned — no evidence either way'
      : outcome === 'first-try' ? 'Knows it — produces it independently'
      : outcome === 'independent' ? 'Produces it independently (started with support)'
      : outcome === 'recovered' ? (ts.knowledgeConfirmed || dom === 'KNOWLEDGE' ? 'Genuine gap — taught, now produces it' : `Knew it — blocked by ${BOTTLENECKS[dom]?.label || 'production pressure'}`)
      : `${BOTTLENECKS[dom]?.label || 'Struggling'} — not yet independent`;
    ts.hiddenKnowledge = !firstOk && outcome === 'recovered' && !ts.knowledgeConfirmed && dom !== 'KNOWLEDGE';
    if (outcome === 'recovered') ts.turnsToRecovery = ts.attempts - 1;
    return { type: 'rate', taskIndex: this.idx };
  }

  _apply(dec, analysis) {
    const task = this.task, ts = this.ts;
    const out = [];
    const say = (mode, blocks, extra = {}) => out.push(this._push({ role: 'tutor', mode, blocks, rule: dec.rule, ...extra }));
    const moveTo = to => { this.mode = to; ts.modes.push(to); ts.maxRung = Math.max(ts.maxRung, MODE[to].rung); };
    const next = () => out.push(...this._startTask(this.idx + 1));
    const starter = { type: 'starter', en: task.starter };

    switch (dec.action) {
      case 'next-task': {
        const rate = dec.rule === 'R18-SKIP' ? this._finishTask('skipped') : this._finishTask(ts.failures === 0 && ts.startMode === 'ENGLISH' && ts.maxRung === 0 ? 'first-try' : 'independent');
        if (dec.rule !== 'R18-SKIP') say('ENGLISH', [{ type: 'praise', en: `Correct — “${analysis.composed}”` }, rate]);
        else say(this.mode, [{ type: 'text', en: "No problem — let's try something else." }, rate]);
        next(); break;
      }
      case 'recovered': {
        const dom = dominant(ts);
        const rate = this._finishTask('recovered');
        const insight = ts.knowledgeConfirmed || dom === 'KNOWLEDGE'
          ? `You've just learned ${task.conceptLabel.toLowerCase()} — and produced it on your own.`
          : `You knew this. What was blocking you was ${lcFirst(BOTTLENECKS[dom]?.short || 'producing it under pressure')} — not the grammar itself.`;
        say('ENGLISH', [{ type: 'praise', en: `Exactly — “${analysis.composed}”` }, { type: 'insight', en: insight }, rate]);
        next(); break;
      }
      case 'reveal': {
        const rate = this._finishTask('not-yet');
        say(this.mode, [{ type: 'text', en: "Here's one way to say it — we'll come back to this:" }, { type: 'model', en: task.model }, rate]);
        next(); break;
      }
      case 'hold':
        ts.held = true;
        say('ENGLISH', [{ type: 'text', en: `Almost! Look again at this part: ${dec.focus ? dec.focus.toLowerCase() : 'the verb'}.` }, { type: 'text', en: `Try once more: ${ts.phase === 'retry' ? task.retry : task.prompt}` }]);
        break;
      case 'guided': {
        moveTo('GUIDED');
        const lead = dec.from === 'RECOGNITION' ? 'Right — so you do know it. Now say it yourself:' : dec.rule === 'R17-HINT' ? 'Start like this:' : "Let's build it together.";
        say('GUIDED', [{ type: 'text', en: lead }, { type: 'text', en: task.rephrase }, starter]);
        break;
      }
      case 'keyword':
        moveTo('GUIDED'); ts.keywordShown = true;
        say('GUIDED', [{ type: 'text', en: 'Here is a cue:' }, { type: 'keyword', en: task.keyword }, starter]);
        break;
      case 'recognition':
        moveTo('RECOGNITION'); this.awaiting = 'choice';
        say('RECOGNITION', [{ type: 'text', en: "Let me ask it differently — no typing needed." }, { type: 'options', en: task.recognition.stem, options: task.recognition.options }]);
        return out;
      case 'clarify':
        moveTo('CODESWITCH'); ts.clarified = true;
        say('CODESWITCH', [{ type: 'text', en: 'Here is the question in Tamil:' }, { type: 'tamil', ta: task.promptTa }, { type: 'text', en: 'Answer in English — Tamil words are OK if you get stuck.' }]);
        break;
      case 'codeswitch':
        moveTo('CODESWITCH');
        say('CODESWITCH', [{ type: 'text', en: task.codeSwitch.en, ta: task.codeSwitch.ta }, { type: 'text', en: task.prompt }]);
        break;
      case 'bridge': {
        moveTo('GUIDED');
        const gaps = (dec.gaps || ts.gaps).filter(g => g.en);
        ts.wordBank = gaps;
        say('GUIDED', [{ type: 'text', en: 'You know what you want to say! Here is the English you were missing:' }, { type: 'wordbank', items: gaps.map(g => ({ source: g.source, en: g.en })) }, { type: 'text', en: 'Now put it together in English:' }, starter]);
        break;
      }
      case 'bilingual': {
        moveTo('BILINGUAL'); ts.contrasted = true;
        const blocks = [{ type: 'explain', ta: task.bilingual.ta, en: task.bilingual.en }];
        const tr = analysis?.errors?.find(e => e.transfer);
        if (tr) blocks.unshift({ type: 'text', en: `I noticed: ${tr.label.toLowerCase()}. That's Tamil grammar doing its job — English just works differently here.` });
        blocks.push({ type: 'text', en: 'Now try in English:' }, starter);
        say('BILINGUAL', blocks);
        break;
      }
      case 'explicit':
        moveTo('EXPLICIT'); ts.contrasted = true;
        say('EXPLICIT', [{ type: 'rule', rule: task.explicit.rule, pairs: task.explicit.pairs, exampleEn: task.explicit.exampleEn, exampleTa: task.explicit.exampleTa }, { type: 'text', en: 'Now you try:' }, starter]);
        break;
      case 'recheck':
        moveTo('ENGLISH'); ts.phase = 'retry';
        say('ENGLISH', [{ type: 'praise', en: analysis ? `Yes — “${analysis.composed}”` : 'OK.' }, { type: 'text', en: 'Now without any help:' }, { type: 'text', en: task.retry }]);
        break;
    }
    if (this.awaiting !== 'done') this.awaiting = this.mode === 'RECOGNITION' ? 'choice' : 'text';
    return out;
  }
}
