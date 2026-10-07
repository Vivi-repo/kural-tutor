import { client, analyze } from '../lib/analyze.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!client) return res.status(503).json({ error: 'LLM disabled' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (typeof body.text !== 'string' || !body.task || body.text.length > 2000) return res.status(400).json({ error: 'bad request' });
  try {
    res.status(200).json(await analyze(body));
  } catch (e) {
    console.error('analyze failed:', e.status || '', e.message);
    res.status(502).json({ error: 'analysis failed' });
  }
}
