// Session-metrics store for live monitoring.
// Production (Vercel): private Vercel Blob store. Local dev: JSON files in ./data/sessions.
// Only anonymous metrics are stored: no learner names, no typed answers.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const DIR = join(process.cwd(), 'data', 'sessions');
export const backend = USE_BLOB ? 'vercel-blob' : 'local-files';

const ID = /^s[a-z0-9]{4,40}$/, ANON = /^a[a-z0-9]{6,40}$/;
const MODES = new Set(['ENGLISH', 'GUIDED', 'RECOGNITION', 'CODESWITCH', 'BILINGUAL', 'EXPLICIT']);
const num = (x, lo = 0, hi = 1e15) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null);
const str = (x, max = 40) => (typeof x === 'string' ? x.slice(0, max) : null);
const mode = x => (MODES.has(x) ? x : null);
const bool = x => !!x;

// Rebuild the document field by field, so nothing unexpected (e.g. free text) can be stored.
export function sanitize(d) {
  if (!d || !ID.test(d.id) || !ANON.test(d.anon)) return null;
  return {
    v: 1, id: d.id, anon: d.anon, demo: bool(d.demo), llm: bool(d.llm), done: bool(d.done),
    startedAt: num(d.startedAt), updatedAt: Date.now(),
    tasks: (Array.isArray(d.tasks) ? d.tasks : []).slice(0, 20).map(t => ({
      taskId: str(t.taskId), concept: str(t.concept), outcome: str(t.outcome, 20), firstCorrect: t.firstCorrect == null ? null : bool(t.firstCorrect),
      maxRung: num(t.maxRung, 0, 5), modes: (Array.isArray(t.modes) ? t.modes : []).slice(0, 20).map(mode).filter(Boolean),
      attempts: num(t.attempts, 0, 50), failures: num(t.failures, 0, 50), hints: num(t.hints, 0, 50), hidden: bool(t.hidden),
      knowledgeConfirmed: bool(t.knowledgeConfirmed), dominant: str(t.dominant, 20), rating: num(t.rating, 1, 5), meanLoad: num(t.meanLoad, 0, 1), endedAt: num(t.endedAt),
    })),
    turns: (Array.isArray(d.turns) ? d.turns : []).slice(0, 400).map(t => ({
      ti: num(t.ti, 0, 20), mode: mode(t.mode), kind: str(t.kind, 8), ok: bool(t.ok), mc: bool(t.mc), load: num(t.load, 0, 1),
      diag: str(t.diag, 20), unc: t.unc == null ? null : bool(t.unc), tamil: num(t.tamil, 0, 1), t: num(t.t),
    })),
    decisions: (Array.isArray(d.decisions) ? d.decisions : []).slice(0, 600).map(x => ({
      rule: str(x.rule, 20), from: mode(x.from), to: mode(x.to), ti: num(x.ti, 0, 20), seq: num(x.seq, 0, 1000), action: str(x.action, 20),
    })),
  };
}

export async function saveSession(doc) {
  const body = JSON.stringify(doc);
  if (USE_BLOB) {
    const { put } = await import('@vercel/blob');
    await put(`sessions/${doc.id}.json`, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  } else {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, `${doc.id}.json`), body);
  }
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export async function loadSessions(limit = 2000) {
  if (USE_BLOB) {
    const { list, get } = await import('@vercel/blob');
    const blobs = []; let cursor;
    do { const r = await list({ prefix: 'sessions/', cursor, limit: 1000 }); blobs.push(...r.blobs); cursor = r.hasMore ? r.cursor : null; } while (cursor && blobs.length < limit * 2);
    blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    const docs = await pool(blobs.slice(0, limit), 24, async b => {
      try { const r = await get(b.pathname, { access: 'private', useCache: false }); return r ? JSON.parse(await new Response(r.stream).text()) : null; } catch { return null; }
    });
    return docs.filter(Boolean);
  }
  try {
    const files = (await readdir(DIR)).filter(f => f.endsWith('.json'));
    const docs = await pool(files, 24, async f => { try { return JSON.parse(await readFile(join(DIR, f), 'utf8')); } catch { return null; } });
    return docs.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  } catch { return []; }
}
