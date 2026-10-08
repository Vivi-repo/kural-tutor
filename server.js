// Kural server: serves the frontend and (optionally) a Claude-backed analysis
// endpoint. The adaptive engine runs entirely in the browser; Claude is only asked
// to (a) map unknown Tamil/Tanglish words to the English the learner needed and
// (b) give a second opinion when the rule-based grader can't decide.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, llmStatus, analyze, MODEL } from './lib/analyze.js';
import { sanitize, saveSession, loadSessions, backend } from './lib/store.js';
import { aggregate } from './lib/aggregate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 250000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (url.pathname === '/api/health') return json(200, { llm: !!client, model: client ? MODEL : null, status: llmStatus });
  if (url.pathname === '/api/track' && req.method === 'POST') {
    try { const doc = sanitize(await readBody(req)); if (!doc) return json(400, { error: 'invalid session' }); await saveSession(doc); res.writeHead(204); return res.end(); }
    catch (e) { return json(500, { error: e.message }); }
  }
  if (url.pathname === '/api/metrics') {
    const demo = ['include', 'exclude', 'only'].includes(url.searchParams.get('demo')) ? url.searchParams.get('demo') : 'exclude';
    const days = Math.max(0, Math.min(365, Number(url.searchParams.get('days') ?? 30) || 0));
    return json(200, { backend, ...aggregate(await loadSessions(), { demo, days }) });
  }
  if (url.pathname === '/api/analyze' && req.method === 'POST') {
    if (!client) return json(503, { error: 'LLM disabled' });
    try {
      const body = await readBody(req);
      if (typeof body.text !== 'string' || !body.task) return json(400, { error: 'bad request' });
      return json(200, await analyze(body));
    } catch (e) {
      console.error('analyze failed:', e.status || '', e.message);
      return json(502, { error: 'analysis failed' });
    }
  }

  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const file = join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Kural running at http://localhost:${PORT}`);
  console.log(`Claude analysis: ${llmStatus}`);
});
