export type Attempt = { ok: number; latency_ms: number; status_code: number | null; error: 'timeout' | 'network' | 'http' | null; request_id: string };
export type Probe = Attempt & { outcome: 'healthy' | 'transient' | 'failed'; attempts: Attempt[] };
export async function probe(target: { url: string; status: number }, options: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {}): Promise<Probe> {
  const request = options.fetch ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const attempts: Attempt[] = [];
  for (let i = 0; i < 3; i++) {
    if (i) await sleep(2000);
    const start = Date.now(), controller = new AbortController();
    const request_id = `1-${Math.floor(Date.now() / 1000).toString(16).padStart(8, "0")}-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    let attempt: Attempt;
    try {
      const response = await request(target.url, { method: 'HEAD', redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { 'User-Agent': 'AutopilotUptime/3.0 (+https://status.aplt.ai)', 'X-Autopilot-Probe-ID': request_id, 'X-Amzn-Trace-Id': `Root=${request_id}` } });
      attempt = { ok: Number(response.status === target.status), latency_ms: Date.now() - start, status_code: response.status, error: response.status === target.status ? null : 'http', request_id };
    } catch {
      attempt = { ok: 0, latency_ms: Date.now() - start, status_code: null, error: controller.signal.aborted ? 'timeout' : 'network', request_id };
    } finally { clearTimeout(timer); }
    attempts.push(attempt);
    if (attempt.ok) return { ...attempt, outcome: i ? 'transient' : 'healthy', attempts };
  }
  return { ...attempts[attempts.length - 1]!, outcome: 'failed', attempts };
}
