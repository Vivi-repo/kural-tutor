import { client, llmStatus, MODEL } from '../lib/analyze.js';

export default function handler(req, res) {
  res.status(200).json({ llm: !!client, model: client ? MODEL : null, status: llmStatus });
}
