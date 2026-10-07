// Browser adapter for the optional Claude analysis endpoint.
export async function connectLLM() {
  try {
    const r = await fetch('/api/health');
    const health = await r.json();
    if (!health.llm) return { adapter: null, health };
    const adapter = {
      model: health.model,
      async analyze(payload) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 15000);
        try {
          const res = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
          return res.ok ? await res.json() : null;
        } finally { clearTimeout(timer); }
      },
    };
    return { adapter, health };
  } catch {
    return { adapter: null, health: { llm: false, status: 'server unreachable (open via `npm start`)' } };
  }
}
