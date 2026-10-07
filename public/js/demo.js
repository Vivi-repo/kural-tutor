// Scripted demo learners. Each response is a keystroke script, so the demo
// produces the same telemetry (latency, pauses, deletions) a real learner would.
import { TASK } from './content.js';

const W = (ms) => ['wait', ms], T = (s) => ['type', s], D = (n) => ['del', n];

export const PERSONAS = {
  kavya: {
    name: 'Kavya', blurb: 'Understands English well, freezes when producing it. Mixes Tamil when stuck.',
    taskIds: ['past-go', 'articles', 'prepositions', 'advice', 'questions', 'third-person'],
    ratings: [4, 3, 3, 4, 3, 1],
    script: {
      'past-go': [
        { steps: [W(7200), T('I...'), W(3600), T(' um I go'), W(2600), D(4), T('I... no'), W(3000)] },
        { choice: 1, wait: 3200 },
        { steps: [W(2200), T('went to the market')] },
        { steps: [W(1900), T('Last Sunday I watched a movie with my friends.')] },
      ],
      articles: [
        { steps: [W(1800), T('There is apple on the table.')] },
        { steps: [W(2000), T('There is one apple on the table.')] },
        { steps: [W(2500), T('an')] },
        { steps: [W(2100), T('There is an orange on the chair.')] },
      ],
      prepositions: [
        { steps: [W(4200), T('I keep phone table'), W(2400), T(' mela')] },
        { steps: [W(2000), T('on the table')] },
        { steps: [W(2300), T('I keep my keys in my bag.')] },
      ],
      advice: [
        { steps: [W(5200), T('You should... marundhu saapdu...'), W(2600), T(' solla theriyala')] },
        { steps: [W(2400), T('take medicine and rest')] },
        { steps: [W(2000), T('You should sleep early and drink water.')] },
      ],
      questions: [
        { steps: [W(6000), T('puriyala')] },
        { steps: [W(3000), T('Where you live?')] },
        { steps: [W(2000), T('do')] },
        { steps: [W(1800), T('Where do you work?')] },
      ],
      'third-person': [
        { steps: [W(1600), T('Every morning my mother makes coffee and prays.')] },
      ],
    },
  },
  arun: {
    name: 'Arun', blurb: 'Fast and confident. Has a real gap in irregular past tense; gets overloaded by open questions.',
    taskIds: ['past-go', 'articles', 'prepositions', 'advice'],
    ratings: [5, 1, 4, 2],
    script: {
      'past-go': [
        { steps: [W(1700), T('Yesterday I go to the cinema.')] },
        { steps: [W(1900), T('Yesterday I goed to the cinema.')] },
        { choice: 0, wait: 2500 },
        { steps: [W(2600), T('went to the cinema')] },
        { steps: [W(2200), T('Last Sunday I went to the temple.')] },
      ],
      articles: [{ steps: [W(2000), T('There is an apple on the table.')] }],
      prepositions: [
        { steps: [W(9000), T('I keep... my'), W(4000), T(' phone... um'), W(3500), D(6), T('... in bag'), W(3000)] },
        { steps: [W(3000), T('in my bag')] },
        { steps: [W(2600), T('I keep my keys in my bag.')] },
      ],
      advice: [
        { steps: [W(2500), T('You should eat medicine and take rest.')] },
        { steps: [W(2000), T('You should take medicine and take rest.')] },
      ],
    },
  },
  meena: {
    name: 'Meena', blurb: 'Fluent. The tutor should stay out of her way.',
    taskIds: ['past-go', 'prepositions', 'questions', 'comparative'],
    ratings: [1, 1, 2, 1],
    script: {},
  },
};

// Turn a keystroke script into final text + telemetry on a virtual clock.
export function simulate(steps, charMs = 170) {
  let vt = 0, text = '';
  const tel = { promptAt: 0, firstKeyAt: null, keys: [], keystrokes: 0, deletions: 0, pastes: 0, submitAt: 0 };
  for (const [op, arg] of steps) {
    if (op === 'wait') vt += arg;
    if (op === 'type') for (const ch of arg) { vt += charMs; tel.keys.push(vt); tel.keystrokes++; tel.firstKeyAt ??= vt; text += ch; }
    if (op === 'del') for (let i = 0; i < arg; i++) { vt += 140; tel.keys.push(vt); tel.deletions++; text = text.slice(0, -1); }
  }
  tel.submitAt = vt + 450;
  return { text, tel };
}

// Next scripted response for the session's current state; falls back to a fluent correct answer.
export function nextResponse(session, persona, queues) {
  const task = TASK[session.taskIds[session.idx]];
  const q = queues[task.id] || (queues[task.id] = [...(persona.script[task.id] || [])]);
  while (q.length) {
    const item = q.shift();
    if (session.awaiting === 'choice' && item.choice != null) return { kind: 'choice', choice: item.choice, wait: item.wait };
    if (session.awaiting === 'text' && item.steps) return { kind: 'text', steps: item.steps };
  }
  if (session.awaiting === 'choice') return { kind: 'choice', choice: task.recognition.answer, wait: 2000 };
  const text = session.ts.phase === 'retry' ? task.retryModel : task.model;
  return { kind: 'text', steps: [W(1500), T(text)] };
}
