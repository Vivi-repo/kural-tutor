// Claude-backed analysis shared by the local server (server.js) and Vercel functions (api/).
export const MODEL = process.env.TUTOR_MODEL || 'claude-opus-5-5';

export let client = null, llmStatus = 'off: set ANTHROPIC_API_KEY (or run `ant auth login` and set TUTOR_LLM=1) to enable';
if (process.env.TUTOR_LLM !== '0' && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.TUTOR_LLM === '1')) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
    llmStatus = `on (${MODEL})`;
  } catch {
    llmStatus = 'off: run `npm install` to add @anthropic-ai/sdk';
  }
}

const SYSTEM = `You assist an English tutor for native Tamil speakers. You receive one tutoring prompt, the target concept, a model answer, and the learner's reply (which may mix English with Tamil script or romanised Tamil / Tanglish).
Return:
- english_correct: true only if the reply is a correct, natural English answer to the prompt that uses the target concept correctly, with no Tamil words.
- meaning_conveyed: true if the learner communicated a relevant answer in any language mix.
- gaps: every Tamil or Tanglish word/phrase in the reply, with the English the learner needed in its place ("lexical" for a missing word, "grammatical" for a Tamil case marker or structure). Empty if none.
- note: one short sentence, addressed to the teacher, describing the learner's main issue.`;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['english_correct', 'meaning_conveyed', 'gaps', 'note'],
  properties: {
    english_correct: { type: 'boolean' },
    meaning_conveyed: { type: 'boolean' },
    gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['source', 'english', 'kind'],
      properties: { source: { type: 'string' }, english: { type: 'string' }, kind: { type: 'string', enum: ['lexical', 'grammatical'] } } } },
    note: { type: 'string' },
  },
};

export async function analyze({ task, text, mode }) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ prompt: task.prompt, target_concept: task.concept, model_answer: task.model, interaction_mode: mode, learner_reply: text }) }],
  });
  if (response.stop_reason === 'refusal') return null;
  const block = response.content.find(b => b.type === 'text');
  return block ? JSON.parse(block.text) : null;
}

