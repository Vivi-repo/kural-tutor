// Explicit learner state. Separates what the learner KNOWS (comprehension,
// recognition) from what they can currently PRODUCE (guided, free production).
// Each skill is a Beta(α, β) posterior; mean = α / (α + β).

const SKILLS = ['comprehension', 'recognition', 'guided', 'production'];
const beta = () => ({ a: 1, b: 1 });
export const mean = s => s.a / (s.a + s.b);

export class LearnerModel {
  constructor(data) {
    this.concepts = {};
    this.baseline = { firstKey: [], words: [] };
    this.gapLexicon = {};   // source → { en, kind, count, resolved, concept }
    this.transfer = {};     // error label → count
    if (data) Object.assign(this, structuredClone(data));
  }

  skill(concept) {
    if (!this.concepts[concept]) this.concepts[concept] = { ...Object.fromEntries(SKILLS.map(k => [k, beta()])), bottlenecks: {}, evidence: [] };
    return this.concepts[concept];
  }

  view(concept) {
    const s = this.skill(concept);
    const out = { bottlenecks: s.bottlenecks };
    for (const k of SKILLS) out[k] = { mean: +mean(s[k]).toFixed(3), n: s[k].a + s[k].b - 2 };
    out.hiddenKnowledge = +(Math.max(out.recognition.mean, out.comprehension.mean * 0.9) - out.production.mean).toFixed(3);
    return out;
  }

  bump(concept, skill, success, w = 1, note) {
    const s = this.skill(concept);
    if (success) s[skill].a += w; else s[skill].b += w;
    if (note) s.evidence.push(note);
  }

  // Update from one graded turn.
  observe({ concept, mode, kind, correct, analysis, diag, est }) {
    if (kind === 'choice') {
      this.bump(concept, 'recognition', correct, 1, `${correct ? '✓' : '✗'} recognition`);
      this.bump(concept, 'comprehension', true, 0.5);
    } else if (mode === 'ENGLISH') {
      this.bump(concept, 'production', correct, 1, `${correct ? '✓' : '✗'} free production`);
      const understood = correct || (analysis && analysis.meaningConveyed && diag?.top !== 'MISUNDERSTANDING');
      this.bump(concept, 'comprehension', understood, 0.5);
    } else if (mode === 'CODESWITCH') {
      this.bump(concept, 'comprehension', !!analysis?.meaningConveyed, 1, analysis?.meaningConveyed ? '✓ meaning conveyed (code-switched)' : '✗ meaning not conveyed');
      if (correct) this.bump(concept, 'production', true, 0.5);
    } else {
      this.bump(concept, 'guided', correct, 1, `${correct ? '✓' : '✗'} guided production`);
      if (correct) this.bump(concept, 'comprehension', true, 0.5);
    }
    if (diag && !correct) {
      const s = this.skill(concept);
      s.bottlenecks[diag.top] = (s.bottlenecks[diag.top] || 0) + 1;
    }
    if (analysis) {
      for (const g of analysis.lang.gaps) {
        const k = g.source.toLowerCase();
        const e = this.gapLexicon[k] || (this.gapLexicon[k] = { source: g.source, en: g.en, kind: g.kind, count: 0, resolved: false, concept });
        e.count++;
      }
      for (const e of analysis.errors) if (e.transfer) this.transfer[e.label] = (this.transfer[e.label] || 0) + 1;
      // A gap is resolved when the learner later produces its English form in a correct English answer.
      if (correct && analysis.lang.tamilRatio === 0) {
        const text = analysis.composed.toLowerCase();
        for (const e of Object.values(this.gapLexicon)) {
          if (e.resolved || e.concept !== concept) continue;
          const targets = e.en.toLowerCase().split(/[\/(),+]/).map(x => x.trim().replace(/^the /, '')).filter(x => x.length >= 2);
          if (targets.some(t => text.includes(t))) e.resolved = true;
        }
      }
    }
    // Personal baseline = the learner's own calm, correct answers.
    if (correct && est && est.level === 'LOW' && kind === 'text' && analysis) {
      if (est.firstKeyMs != null) this.baseline.firstKey.push(est.firstKeyMs);
      if (mode === 'ENGLISH') this.baseline.words.push(analysis.lang.words);
      this.baseline.firstKey = this.baseline.firstKey.slice(-12);
      this.baseline.words = this.baseline.words.slice(-12);
    }
  }
}
