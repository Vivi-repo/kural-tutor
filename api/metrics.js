import { loadSessions, backend } from '../lib/store.js';
import { aggregate } from '../lib/aggregate.js';

let cache = { at: 0, docs: null };

export default async function handler(req, res) {
  const demo = ['include', 'exclude', 'only'].includes(req.query.demo) ? req.query.demo : 'exclude';
  const days = Math.max(0, Math.min(365, Number(req.query.days ?? 30) || 0));
  try {
    if (!cache.docs || Date.now() - cache.at > 10000) cache = { at: Date.now(), docs: await loadSessions() };
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).json({ backend, ...aggregate(cache.docs, { demo, days }) });
  } catch (e) {
    console.error('metrics failed:', e.message);
    res.status(500).json({ error: 'metrics unavailable' });
  }
}
