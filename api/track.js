import { sanitize, saveSession } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { if (body.length > 250000) return res.status(413).end(); try { body = JSON.parse(body); } catch { return res.status(400).end(); } }
  const doc = sanitize(body);
  if (!doc) return res.status(400).json({ error: 'invalid session' });
  try { await saveSession(doc); res.status(204).end(); }
  catch (e) { console.error('track failed:', e.message); res.status(500).json({ error: 'store failed' }); }
}
