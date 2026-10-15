type Env = { DB: D1Database; INDEPENDENT_CHECK_KEY?: string };
const encoder = new TextEncoder();
export async function ingestIndependent(request: Request, env: Env): Promise<Response> {
  if (!env.INDEPENDENT_CHECK_KEY) return new Response('Unavailable', { status: 503 });
  if (Number(request.headers.get('Content-Length') ?? 0) > 16000) return new Response('Too large', { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response('Invalid report', { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 16000) { await reader.cancel(); return new Response('Too large', { status: 413 }); }
    chunks.push(value);
  }
  const combined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  const body = new TextDecoder().decode(combined);
  const signature = request.headers.get('X-Monitor-Signature') ?? '';
  if (!/^[a-f0-9]{64}$/.test(signature)) return new Response('Unauthorized', { status: 401 });
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.INDEPENDENT_CHECK_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g)!, x => parseInt(x, 16));
  if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(body))) return new Response('Unauthorized', { status: 401 });
  let data;
  try { data = JSON.parse(body); } catch { return new Response('Invalid report', { status: 400 }); }
  const timestamp = Date.parse(data.checkedAt);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60000 ||
      !Array.isArray(data.targets) || data.targets.length !== 3 ||
      new Set(data.targets.map((x: {target_id: string}) => x?.target_id)).size !== 3 ||
      data.targets.some((x: {target_id: string; ok: number; attempts: number; latency_ms: number}) => !['app', 'sign', 'docs'].includes(x?.target_id) || ![0, 1].includes(x.ok) || !Number.isFinite(x.latency_ms) || x.latency_ms < 0 || ![1, 2, 3].includes(x.attempts)) ||
      !['passed', 'failed', 'not_configured'].includes(data.browser?.status)) return new Response('Invalid report', { status: 400 });
  // Only store the public summary, never arbitrary caller fields or credentials.
  const payload = JSON.stringify({ checkedAt: new Date(timestamp).toISOString(), source: 'github',
    targets: data.targets.map((x: {target_id: string; ok: number; attempts: number; latency_ms: number}) => ({ target_id: x.target_id, ok: x.ok, attempts: x.attempts, latency_ms: x.latency_ms })),
    browser: { status: data.browser.status } });
  await env.DB.prepare('INSERT INTO monitor_independent VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET checked_at=excluded.checked_at, payload=excluded.payload WHERE excluded.checked_at > monitor_independent.checked_at').bind(new Date(timestamp).toISOString(), payload).run();
  return new Response('Accepted', { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
