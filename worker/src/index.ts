interface Env { DB: D1Database; DISCORD_WEBHOOK_URL?: string; MONITOR_START_AT?: string; }
export const TARGETS = [
  { id: 'app', name: 'Autopilot app', url: 'https://app.aplt.ai/api/health', status: 204 },
  { id: 'sign', name: 'Signing', url: 'https://sign.aplt.ai/api/health', status: 204 },
  { id: 'docs', name: 'Documentation', url: 'https://docs.aplt.ai/docs/', status: 200 },
] as const;
type Current = { target_id: string; minute: number; ok: number; latency_ms: number; status_code: number | null; failure_streak: number };
type Recent = { minute: number; target_id: string; ok: number; latency_ms: number };
type Hourly = { bucket: number; target_id: string; up: number; total: number; latency_sum: number };
type Daily = { bucket: number; target_id: string; up: number; total: number };
type Snapshot = { checkedAt: string; historyUpdatedAt: string; targets: Array<Current & { name: string }>; recent: Recent[]; hourly: Hourly[]; daily: Daily[] };
const MINUTE = 60_000;
const DAY = 1440;
const STALE_MS = 3 * MINUTE;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' };

async function check(t: typeof TARGETS[number]): Promise<{ ok: number; latency_ms: number; status_code: number | null }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(t.url, { method: 'HEAD', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'AutopilotUptime/2.0 (+https://status.aplt.ai)' } });
    return { ok: Number(response.status === t.status), latency_ms: Date.now() - start, status_code: response.status };
  } catch {
    return { ok: 0, latency_ms: Date.now() - start, status_code: null };
  } finally { clearTimeout(timer); }
}

// Exported so tests exercise the exact production queries against real SQLite.
export function resultStatements(db: D1Database, row: Current): D1PreparedStatement[] {
  const { target_id: id, minute, ok, latency_ms: ms, status_code: code, failure_streak: streak } = row;
  const hour = Math.floor(minute / 60) * 60;
  const day = Math.floor(minute / DAY) * DAY;
  const missing = 'NOT EXISTS (SELECT 1 FROM monitor_recent WHERE minute = ? AND target_id = ?)';
  return [
    db.prepare(`INSERT INTO monitor_hourly (bucket, target_id, up, total, latency_sum)
      SELECT ?, ?, ?, 1, ? WHERE ${missing}
      ON CONFLICT (bucket, target_id) DO UPDATE SET up = up + excluded.up, total = total + 1, latency_sum = latency_sum + excluded.latency_sum`).bind(hour, id, ok, ms, minute, id),
    db.prepare(`INSERT INTO monitor_daily (bucket, target_id, up, total)
      SELECT ?, ?, ?, 1 WHERE ${missing}
      ON CONFLICT (bucket, target_id) DO UPDATE SET up = up + excluded.up, total = total + 1`).bind(day, id, ok, minute, id),
    db.prepare(`INSERT INTO monitor_current VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (target_id) DO UPDATE SET minute = excluded.minute, ok = excluded.ok,
      latency_ms = excluded.latency_ms, status_code = excluded.status_code, failure_streak = excluded.failure_streak
      WHERE excluded.minute > monitor_current.minute`).bind(id, minute, ok, ms, code, streak),
    db.prepare('INSERT OR IGNORE INTO monitor_recent VALUES (?, ?, ?, ?)').bind(minute, id, ok, ms),
  ];
}

export async function runChecks(env: Env, scheduledTime: number): Promise<void> {
  if (env.MONITOR_START_AT && scheduledTime < Date.parse(env.MONITOR_START_AT)) return;
  const minute = Math.floor(scheduledTime / MINUTE);
  // Ignore delayed events instead of labelling a present check as historical.
  if (Date.now() - scheduledTime > STALE_MS) return;
  const previous = (await env.DB.prepare('SELECT * FROM monitor_current').all<Current>()).results;
  if (TARGETS.every(t => (previous.find(p => p.target_id === t.id)?.minute ?? -1) >= minute)) return;
  const results = await Promise.all(TARGETS.map(check));
  const rows = TARGETS.map((t, i): Current => {
    const prior = previous.find(p => p.target_id === t.id);
    // A monitoring gap breaks a consecutive failure streak.
    const consecutive = prior?.minute === minute - 1;
    return { target_id: t.id, minute, ...results[i]!, failure_streak: results[i]!.ok ? 0 : (consecutive ? prior!.failure_streak : 0) + 1 };
  });
  const committed = await env.DB.batch(rows.flatMap(row => resultStatements(env.DB, row)));
  // Retain seven days of raw samples. Ordered primary keys bound cleanup work.
  if (minute % 60 === 0) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM monitor_recent WHERE minute < ?').bind(minute - 7 * DAY),
      env.DB.prepare('DELETE FROM monitor_hourly WHERE bucket < ?').bind(Math.floor(minute / 60) * 60 - 30 * DAY),
      env.DB.prepare('DELETE FROM monitor_daily WHERE bucket < ?').bind(Math.floor(minute / DAY) * DAY - 180 * DAY),
    ]);
  }
  await publish(env, minute);
  // Existing operational webhook only; tests never contact Discord.
  if (env.DISCORD_WEBHOOK_URL) {
    const transitions = rows.filter((r, i) => {
      if (!committed[i * 4 + 2]?.meta.changes) return false;
      const prior = previous.find(p => p.target_id === r.target_id);
      return r.failure_streak === 3 || (r.ok && prior?.minute === minute - 1 && prior.failure_streak >= 3);
    });
    if (transitions.length) {
      const response = await fetch(env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: transitions.map(r => `${r.ok ? 'Recovered' : 'Unavailable'}: ${TARGETS.find(t => t.id === r.target_id)!.name} (${r.status_code ?? 'timeout/network error'}). Public reachability check: https://status.aplt.ai`).join('\n') }) });
      if (!response.ok) console.error('Status webhook delivery failed', response.status);
    }
  }
}

export async function publish(env: Env, minute: number): Promise<void> {
  const current = (await env.DB.prepare('SELECT * FROM monitor_current').all<Current>()).results;
  const saved = await env.DB.prepare('SELECT payload FROM monitor_published WHERE id = 1').first<{ payload: string }>();
  let snapshot = saved ? JSON.parse(saved.payload) as Snapshot : undefined;
  if (!snapshot || minute % 5 === 0) {
    const [recent, hourly, daily] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM monitor_recent WHERE minute >= ? ORDER BY minute').bind(minute - 59),
      env.DB.prepare('SELECT * FROM monitor_hourly WHERE bucket >= ? ORDER BY bucket').bind(Math.floor(minute / 60) * 60 - 719 * 60),
      env.DB.prepare('SELECT * FROM monitor_daily WHERE bucket >= ? ORDER BY bucket').bind(Math.floor(minute / DAY) * DAY - 89 * DAY),
    ]);
    snapshot = { checkedAt: '', targets: [], historyUpdatedAt: new Date(minute * MINUTE).toISOString(), recent: recent!.results as Recent[], hourly: hourly!.results as Hourly[], daily: daily!.results as Daily[] };
  }
  snapshot.checkedAt = new Date(Math.max(minute, ...current.map(row => row.minute)) * MINUTE).toISOString();
  snapshot.targets = current.map(row => ({ ...row, name: TARGETS.find(t => t.id === row.target_id)?.name ?? row.target_id }));
  await env.DB.prepare("INSERT INTO monitor_published VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET payload = excluded.payload WHERE json_extract(excluded.payload, '$.checkedAt') >= json_extract(monitor_published.payload, '$.checkedAt')").bind(JSON.stringify(snapshot)).run();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store' } });
}
export default {
  async scheduled(event: ScheduledController, env: Env): Promise<void> { await runChecks(env, event.scheduledTime); },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    const url = new URL(request.url);
    if (url.pathname !== '/status') return json({ error: 'Not found' }, 404);
    if (env.MONITOR_START_AT && Date.now() < Date.parse(env.MONITOR_START_AT)) {
      return json({ error: 'Status updates are temporarily unavailable', startsAt: env.MONITOR_START_AT }, 503);
    }
    // Canonical key ignores arbitrary query strings; all viewers share one snapshot.
    const key = new Request(`${url.origin}/status`, { method: 'GET' });
    let response = await caches.default.match(key);
    if (!response) {
      let row: { payload: string } | null;
      try {
        row = await env.DB.prepare('SELECT payload FROM monitor_published WHERE id = 1').first<{ payload: string }>();
      } catch {
        return json({ error: 'Monitoring data is temporarily unavailable' }, 503);
      }
      if (!row) return json({ error: 'Monitoring has not started yet' }, 503);
      response = new Response(row.payload, { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
      ctx.waitUntil(caches.default.put(key, response.clone()));
    }
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  },
};
