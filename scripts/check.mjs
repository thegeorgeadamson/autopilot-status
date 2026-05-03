import fs from 'node:fs/promises';
import path from 'node:path';

const TIMEOUT_MS = 10_000;
const HISTORY_MAX_PER_TARGET = 2016; // ~7 days at 5-min cadence
const DATA_DIR = 'docs/data';

const root = JSON.parse(await fs.readFile('targets.json', 'utf8'));
const targets = root.targets ?? [];

async function check(target) {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.url, {
      method: target.method ?? 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'AutopilotUptime/1.0 (+https://github.com/thegeorgeadamson/AutopilotUptime)',
      },
    });
    const latencyMs = Date.now() - start;
    const accept = target.acceptStatus ?? [200];
    const ok = accept.includes(res.status);
    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok,
      status: ok ? 'up' : 'degraded',
      statusCode: res.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok: false,
      status: 'down',
      statusCode: null,
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
      error: err?.name === 'AbortError' ? 'timeout' : (err?.message ?? String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(targets.map(check));

await fs.mkdir(DATA_DIR, { recursive: true });

const current = {
  checkedAt: new Date().toISOString(),
  targets: Object.fromEntries(results.map((r) => [r.id, r])),
};
await fs.writeFile(
  path.join(DATA_DIR, 'current.json'),
  JSON.stringify(current, null, 2)
);

let history = {};
try {
  const buf = await fs.readFile(path.join(DATA_DIR, 'history.json'), 'utf8');
  const parsed = JSON.parse(buf);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    history = parsed;
  }
} catch {}

for (const r of results) {
  const arr = Array.isArray(history[r.id]) ? history[r.id] : [];
  arr.push({
    t: r.checkedAt,
    ok: r.ok,
    status: r.status,
    code: r.statusCode,
    ms: r.latencyMs,
  });
  if (arr.length > HISTORY_MAX_PER_TARGET) {
    arr.splice(0, arr.length - HISTORY_MAX_PER_TARGET);
  }
  history[r.id] = arr;
}

await fs.writeFile(path.join(DATA_DIR, 'history.json'), JSON.stringify(history));

const downCount = results.filter((r) => !r.ok).length;
console.log(
  `${results.length} targets checked, ${downCount} not OK at ${current.checkedAt}`
);
for (const r of results) {
  console.log(
    `  [${r.ok ? 'OK ' : '!! '}] ${r.name.padEnd(24)} ${String(r.statusCode ?? '---').padStart(3)} ${String(r.latencyMs).padStart(5)}ms${r.error ? ' ' + r.error : ''}`
  );
}

if (downCount > 0) process.exit(1);
