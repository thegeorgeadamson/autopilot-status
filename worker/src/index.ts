interface Env {
  DB: D1Database;
  // Optional — set via `wrangler secret put DISCORD_WEBHOOK_URL`.
  // When present, the Worker posts to it on sustained up<->down transitions.
  DISCORD_WEBHOOK_URL?: string;
}

type Target = {
  id: string;
  name: string;
  url: string;
  method?: "GET" | "HEAD";
  redirect?: "follow" | "manual";
  acceptStatus?: number[];
};

const TARGETS: Target[] = [
  {
    id: "app",
    name: "Autopilot App",
    url: "https://app.aplt.ai/api/health",
    method: "HEAD",
    redirect: "manual",
    acceptStatus: [204],
  },
  {
    id: "www",
    name: "aplt.ai",
    url: "https://www.aplt.ai",
    acceptStatus: [200],
  },
  {
    id: "backend",
    name: "Autopilot's Backend",
    url: "https://odoujghomokcenzuacdo.supabase.co/rest/v1/",
    acceptStatus: [200, 401],
  },
  {
    id: "companion",
    name: "Autopilot Companion",
    url: "https://api.anthropic.com",
    acceptStatus: [200, 401, 404, 405],
  },
];

const TIMEOUT_MS = 10_000;
const CONSECUTIVE_FAILURES_TO_ALERT = 3;

type CheckResult = {
  id: string;
  name: string;
  url: string;
  ok: boolean;
  status: "up" | "degraded" | "down";
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
  checkedAt: string;
};

type AlertTransition = {
  result: CheckResult;
  recovered: boolean;
  failureStreak: number;
};

async function checkTarget(t: Target): Promise<CheckResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(t.url, {
      method: t.method ?? "GET",
      signal: ctrl.signal,
      redirect: t.redirect ?? "follow",
      headers: {
        "User-Agent":
          "AutopilotUptime/1.0 (+https://github.com/thegeorgeadamson/autopilot-status)",
      },
    });
    const latencyMs = Date.now() - start;
    const accept = t.acceptStatus ?? [200];
    const ok = accept.includes(res.status);
    return {
      id: t.id,
      name: t.name,
      url: t.url,
      ok,
      status: ok ? "up" : "degraded",
      statusCode: res.status,
      latencyMs,
      error: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return {
      id: t.id,
      name: t.name,
      url: t.url,
      ok: false,
      status: "down",
      statusCode: null,
      latencyMs: Date.now() - start,
      error: e?.name === "AbortError" ? "timeout" : (e?.message ?? "fetch failed"),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getPreviousFailureStreaks(env: Env): Promise<Map<string, number>> {
  const targetIds = TARGETS.map((t) => `'${t.id.replaceAll("'", "''")}'`).join(", ");
  const { results } = await env.DB.prepare(
    `SELECT target_id, ok, rn
     FROM (
       SELECT
         target_id,
         ok,
         ROW_NUMBER() OVER (
           PARTITION BY target_id
           ORDER BY checked_at DESC, id DESC
         ) AS rn
       FROM checks
       WHERE target_id IN (${targetIds})
     )
     WHERE rn <= ?`
  )
    .bind(CONSECUTIVE_FAILURES_TO_ALERT)
    .all<{ target_id: string; ok: number; rn: number }>();

  const byTarget = new Map<string, Array<{ ok: number; rn: number }>>();
  for (const row of results) {
    const rows = byTarget.get(row.target_id) ?? [];
    rows.push(row);
    byTarget.set(row.target_id, rows);
  }

  const streaks = new Map<string, number>();
  for (const [targetId, rows] of byTarget) {
    rows.sort((a, b) => a.rn - b.rn);
    let streak = 0;
    for (const row of rows) {
      if (row.ok) break;
      streak += 1;
    }
    streaks.set(targetId, streak);
  }

  return streaks;
}

async function runChecks(env: Env): Promise<CheckResult[]> {
  // Snapshot recent history BEFORE inserting new rows so Discord alerts only
  // fire after a sustained outage, while the public page still shows raw data.
  const previousFailureStreaks = await getPreviousFailureStreaks(env);

  const results = await Promise.all(TARGETS.map(checkTarget));

  const stmts = results.map((r) =>
    env.DB.prepare(
      `INSERT INTO checks (target_id, ok, status, status_code, latency_ms, error, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      r.id,
      r.ok ? 1 : 0,
      r.status,
      r.statusCode,
      r.latencyMs,
      r.error,
      r.checkedAt
    )
  );
  await env.DB.batch(stmts);

  if (env.DISCORD_WEBHOOK_URL) {
    const transitions = results.flatMap<AlertTransition>((r) => {
      const previousFailureStreak = previousFailureStreaks.get(r.id) ?? 0;
      if (!r.ok) {
        const failureStreak = previousFailureStreak + 1;
        if (failureStreak === CONSECUTIVE_FAILURES_TO_ALERT) {
          return [{ result: r, recovered: false, failureStreak }];
        }
        return [];
      }
      if (previousFailureStreak >= CONSECUTIVE_FAILURES_TO_ALERT) {
        return [{ result: r, recovered: true, failureStreak: 0 }];
      }
      return [];
    });
    if (transitions.length > 0) {
      await postDiscordAlerts(env.DISCORD_WEBHOOK_URL, transitions, results);
    }
  }

  return results;
}

function summarizeSnapshot(results: CheckResult[]): string {
  return results
    .map((r) => {
      const state = r.ok ? "OK" : "FAIL";
      const detail = r.statusCode != null ? `HTTP ${r.statusCode}` : (r.error ?? "no response");
      return `${state} ${r.name}: ${detail}, ${r.latencyMs}ms`;
    })
    .join("\n");
}

function describeAlertContext(
  transition: AlertTransition,
  results: CheckResult[]
): string {
  const { result, recovered } = transition;
  const byId = new Map(results.map((r) => [r.id, r]));
  const failing = results.filter((r) => !r.ok);

  if (recovered) {
    if (failing.length === 0) {
      return "All monitored targets are passing again.";
    }
    return `Recovered, but still failing: ${failing.map((r) => r.name).join(", ")}.`;
  }

  const backendOk = byId.get("backend")?.ok;
  const appOk = byId.get("app")?.ok;

  if (result.id === "app") {
    if (backendOk) {
      return "Supabase is passing, so this points more toward the app edge, Vercel routing, middleware, or runtime.";
    }
    return "Supabase is also failing, so this may be broader than the app runtime.";
  }

  if (result.id === "backend") {
    if (appOk) {
      return "The app edge is reachable, but Supabase is failing; likely backend dependency impact.";
    }
    return "The app check is also failing, so customer impact may be broad.";
  }

  if (result.id === "companion") {
    return "The app and backend checks show whether this is isolated to AI companion dependency access.";
  }

  if (result.id === "www") {
    return "This affects the public marketing site separately from the app and backend checks.";
  }

  return "Check the status snapshot below to see which other targets are affected.";
}

async function postDiscordAlerts(
  webhookUrl: string,
  transitions: AlertTransition[],
  results: CheckResult[]
) {
  // Discord allows up to 10 embeds per message — well within for 4 targets.
  const snapshot = summarizeSnapshot(results);
  const embeds = transitions.map((transition) => {
    const { result, recovered, failureStreak } = transition;
    const detailLines: string[] = [];
    if (result.statusCode != null) detailLines.push(`HTTP ${result.statusCode}`);
    if (result.error) detailLines.push(result.error);
    detailLines.push(`${result.latencyMs}ms`);
    if (!recovered) detailLines.push(`${failureStreak} consecutive failed checks`);
    return {
      title: recovered
        ? `🟢 ${result.name} recovered`
        : `🔴 ${result.name} is down`,
      url: "https://status.aplt.ai",
      description: detailLines.join(" · "),
      color: recovered ? 0x57f287 : 0xed4245,
      timestamp: result.checkedAt,
      footer: { text: result.url },
      fields: [
        {
          name: recovered ? "Recovery context" : "Likely signal",
          value: describeAlertContext(transition, results),
          inline: false,
        },
        {
          name: "Current snapshot",
          value: snapshot,
          inline: false,
        },
      ],
    };
  });

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds }),
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Time-range presets for the /series endpoint. Picks a bucket size that
// keeps the rendered bar count between 30 and 100 — enough resolution
// to spot incidents without overcrowding the chart.
type RangeKey = "1h" | "6h" | "24h" | "7d" | "30d";
const RANGES: Record<RangeKey, { hours: number; bucketSecs: number; buckets: number; label: string }> = {
  "1h":  { hours: 1,   bucketSecs: 60,    buckets: 60,  label: "Last hour" },
  "6h":  { hours: 6,   bucketSecs: 300,   buckets: 72,  label: "Last 6 hours" },
  "24h": { hours: 24,  bucketSecs: 900,   buckets: 96,  label: "Last 24 hours" },
  "7d":  { hours: 168, bucketSecs: 7200,  buckets: 84,  label: "Last 7 days" },
  "30d": { hours: 720, bucketSecs: 43200, buckets: 60,  label: "Last 30 days" },
};
const DEFAULT_RANGE: RangeKey = "24h";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10",
      ...CORS,
      ...(init.headers ?? {}),
    },
  });
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runChecks(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/current") {
      const { results } = await env.DB.prepare(
        `SELECT c.target_id, c.ok, c.status, c.status_code, c.latency_ms, c.error, c.checked_at
         FROM checks c
         INNER JOIN (
           SELECT target_id, MAX(checked_at) AS max_t
           FROM checks
           GROUP BY target_id
         ) latest ON latest.target_id = c.target_id AND latest.max_t = c.checked_at`
      ).all<{
        target_id: string;
        ok: number;
        status: string;
        status_code: number | null;
        latency_ms: number;
        error: string | null;
        checked_at: string;
      }>();

      const byId: Record<string, unknown> = {};
      for (const t of TARGETS) {
        const row = results.find((r) => r.target_id === t.id);
        byId[t.id] = row
          ? {
              id: t.id,
              name: t.name,
              url: t.url,
              ok: !!row.ok,
              status: row.status,
              statusCode: row.status_code,
              latencyMs: row.latency_ms,
              error: row.error,
              checkedAt: row.checked_at,
            }
          : {
              id: t.id,
              name: t.name,
              url: t.url,
              ok: false,
              status: "unknown",
              statusCode: null,
              latencyMs: null,
              error: null,
              checkedAt: null,
            };
      }

      return json({ checkedAt: new Date().toISOString(), targets: byId });
    }

    if (url.pathname === "/series") {
      const rangeKey = (url.searchParams.get("range") ?? DEFAULT_RANGE) as RangeKey;
      const range = RANGES[rangeKey] ?? RANGES[DEFAULT_RANGE];
      const sinceUnix = Math.floor(Date.now() / 1000) - range.hours * 3600;

      // Bucket by integer-divide of unix seconds so bucket starts align
      // to clock boundaries (top of the minute, hour, etc).
      // Inlining bucketSecs and sinceUnix (both server-side trusted values
      // sourced from the RANGES whitelist) — D1's parameter binding inside
      // arithmetic expressions on aggregate columns is unreliable.
      const { results } = await env.DB.prepare(
        `SELECT
           target_id,
           (CAST(strftime('%s', checked_at) AS INTEGER) / ${range.bucketSecs}) * ${range.bucketSecs} AS bucket_unix,
           SUM(ok) AS up,
           COUNT(*) AS total,
           AVG(latency_ms) AS avg_ms
         FROM checks
         WHERE CAST(strftime('%s', checked_at) AS INTEGER) >= ${sinceUnix}
         GROUP BY target_id, bucket_unix
         ORDER BY bucket_unix ASC`
      ).all<{
        target_id: string;
        bucket_unix: number;
        up: number;
        total: number;
        avg_ms: number;
      }>();

      // Index incoming buckets so we can fill empty windows. D1 sometimes
      // hands back numeric columns as strings, so normalize to Number for
      // reliable Map.get().
      const byTargetByBucket: Record<string, Map<number, typeof results[number]>> = {};
      for (const t of TARGETS) byTargetByBucket[t.id] = new Map();
      for (const row of results) {
        byTargetByBucket[row.target_id]?.set(Number(row.bucket_unix), row);
      }

      // Walk backwards from the most recent aligned bucket so all targets
      // share the same x-axis even when some have gaps.
      const nowUnix = Math.floor(Date.now() / 1000);
      const lastBucket =
        Math.floor(nowUnix / range.bucketSecs) * range.bucketSecs;
      const bucketStarts: number[] = [];
      for (let i = range.buckets - 1; i >= 0; i--) {
        bucketStarts.push(lastBucket - i * range.bucketSecs);
      }

      const out: Record<string, unknown[]> = {};
      for (const t of TARGETS) {
        const map = byTargetByBucket[t.id]!;
        out[t.id] = bucketStarts.map((startUnix) => {
          const row = map.get(startUnix);
          if (!row) {
            return { t: new Date(startUnix * 1000).toISOString(), status: "none", up: 0, total: 0, avgMs: null };
          }
          const up = row.up;
          const total = row.total;
          let status: "up" | "degraded" | "down";
          if (up === total) status = "up";
          else if (up === 0) status = "down";
          else status = "degraded";
          return {
            t: new Date(startUnix * 1000).toISOString(),
            status,
            up,
            total,
            avgMs: Math.round(row.avg_ms),
          };
        });
      }

      return json({
        range: rangeKey,
        label: range.label,
        bucketSecs: range.bucketSecs,
        buckets: range.buckets,
        targets: out,
      });
    }

    if (url.pathname === "/calendar") {
      const days = Math.min(
        180,
        Math.max(7, Number(url.searchParams.get("days") ?? 90))
      );
      const since = new Date(Date.now() - days * 86400_000)
        .toISOString()
        .slice(0, 10);

      const { results } = await env.DB.prepare(
        `SELECT
           target_id,
           DATE(checked_at) AS day,
           SUM(ok) AS up,
           COUNT(*) AS total
         FROM checks
         WHERE DATE(checked_at) >= ?
         GROUP BY target_id, day
         ORDER BY day ASC`
      )
        .bind(since)
        .all<{ target_id: string; day: string; up: number; total: number }>();

      // Index by target+day for O(1) lookup.
      const byTargetByDay: Record<string, Map<string, { up: number; total: number }>> = {};
      for (const t of TARGETS) byTargetByDay[t.id] = new Map();
      for (const row of results) {
        byTargetByDay[row.target_id]?.set(row.day, {
          up: Number(row.up),
          total: Number(row.total),
        });
      }

      // Build the day axis (UTC) so all targets share the same X positions.
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const dayList: string[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        dayList.push(d.toISOString().slice(0, 10));
      }

      const out: Record<string, unknown[]> = {};
      for (const t of TARGETS) {
        const map = byTargetByDay[t.id]!;
        out[t.id] = dayList.map((date) => {
          const cell = map.get(date);
          if (!cell || cell.total === 0) {
            return { date, status: "none", up: 0, total: 0 };
          }
          let status: "up" | "degraded" | "down";
          if (cell.up === cell.total) status = "up";
          else if (cell.up === 0) status = "down";
          else status = "degraded";
          return { date, status, up: cell.up, total: cell.total };
        });
      }

      return json({ days, targets: out });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        "Autopilot Uptime API\n\n" +
          "GET /current — latest check per target\n" +
          "GET /series?range=1h|6h|24h|7d|30d — bucketed time series (default 24h)\n" +
          "GET /calendar?days=N — daily uptime aggregates (max 180, default 90)\n",
        { headers: { "Content-Type": "text/plain", ...CORS } }
      );
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
