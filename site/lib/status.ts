export const SERVICES = [
  { id: "app", name: "Autopilot", description: "Your workspace" },
  { id: "sign", name: "Autopilot Sign", description: "Document signing" },
  { id: "docs", name: "Documentation", description: "Help and guides" },
] as const;
export type Current = {
  target_id: string;
  minute: number;
  ok: number;
  latency_ms: number;
  probe?: { outcome: "healthy" | "transient" | "failed"; attempts: Array<{ ok: number; latency_ms: number; status_code: number | null; error: string | null; request_id: string }> } | null;
};
export type Daily = {
  target_id: string;
  bucket: number;
  total: number;
  up: number;
};
export type Hour = Daily & {
  latency_sum: number;
};
export type Snapshot = {
  checkedAt: string;
  historyUpdatedAt: string;
  targets: Current[];
  hourly: Hour[];
  daily?: Daily[];
  independent?: { checkedAt: string; targets: Array<{target_id: string; ok: number}>; browser: {status: "passed" | "failed" | "not_configured"} } | null;
};
export type Bucket = {
  start: number;
  total: number;
  up: number;
  ms: number | null;
  latencyTotal: number;
};
export function parseSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  if (
    !s ||
    !Number.isFinite(Date.parse(s.checkedAt)) ||
    !Number.isFinite(Date.parse(s.historyUpdatedAt)) ||
    !Array.isArray(s.targets) ||
    !Array.isArray(s.hourly) ||
    s.hourly.length > 10000 ||
    (s.daily !== undefined && (!Array.isArray(s.daily) || s.daily.length > 600))
  )
    throw Error("Invalid status");
  if (
    s.targets.some(
      (r) =>
        !r ||
        typeof r.target_id !== "string" ||
        !Number.isFinite(r.minute) ||
        ![0, 1].includes(r.ok),
    ) ||
    [...s.hourly, ...(s.daily ?? [])].some(
      (r) =>
        !r ||
        typeof r.target_id !== "string" ||
        ![r.bucket, r.total, r.up].every(Number.isFinite) ||
        r.total <= 0 ||
        r.up < 0 ||
        r.up > r.total,
    )
  )
    throw Error("Invalid status");
  if (s.hourly.some((r) => !Number.isFinite(r.latency_sum) || r.latency_sum < 0))
    throw Error("Invalid status");
  return s;
}
export function aggregate(
  snapshot: Snapshot | null,
  id: string,
  hours: number,
  now: number,
): Bucket[] {
  const daily = hours === 2160;
  const step = daily ? 1440 : 60;
  const end = Math.floor((snapshot ? Date.parse(snapshot.checkedAt) : now) / (step * 60000)) * step;
  const group = daily ? 1 : hours >= 720 ? 8 : hours === 168 ? 2 : 1;
  const periods = daily ? 90 : hours / group;
  const byHour = new Map(
    (daily ? snapshot?.daily ?? [] : snapshot?.hourly ?? [])
      .filter((r) => r.target_id === id)
      .map((r) => [r.bucket, r]),
  );
  // Daily availability lasts 180 days; latency exists only in retained hourly rows.
  const latencyByDay = new Map<number, { total: number; sum: number }>();
  if (daily) for (const row of snapshot?.hourly ?? []) {
    if (row.target_id !== id) continue;
    const day = Math.floor(row.bucket / 1440) * 1440;
    const value = latencyByDay.get(day) ?? { total: 0, sum: 0 };
    value.total += row.total;
    value.sum += row.latency_sum;
    latencyByDay.set(day, value);
  }
  return Array.from({ length: periods }, (_, i) => {
    const start = end - (periods - 1) * group * step + i * group * step;
    let total = 0,
      up = 0,
      latency = 0,
      latencyTotal = 0;
    for (let j = 0; j < group; j++) {
      const r = byHour.get(start + j * step);
      if (r) {
        total += r.total;
        up += r.up;
        const measured = daily ? latencyByDay.get(start + j * step) : undefined;
        latency += daily ? measured?.sum ?? 0 : (r as Hour).latency_sum;
        latencyTotal += daily ? measured?.total ?? 0 : r.total;
      }
    }
    return { start, total, up, latencyTotal, ms: latencyTotal ? latency / latencyTotal : null };
  });
}
export function summarize(buckets: Bucket[]) {
  const total = buckets.reduce((n, b) => n + b.total, 0),
    up = buckets.reduce((n, b) => n + b.up, 0);
  const latencyTotal = buckets.reduce((n, b) => n + b.latencyTotal, 0);
  return {
    total,
    availability: total ? (up / total) * 100 : null,
    ms: latencyTotal
      ? buckets.reduce((n, b) => n + (b.ms ?? 0) * b.latencyTotal, 0) / latencyTotal
      : null,
  };
}
function independentIssue(snapshot: Snapshot | null, id: string, now: number): string | null {
  const report = snapshot?.independent;
  if (!report || !Number.isFinite(Date.parse(report.checkedAt)) || now - Date.parse(report.checkedAt) > 20 * 60000) return null;
  if (id === "app" && report.browser.status === "failed") return "Workspace check failed";
  if (report.targets.some(row => row.target_id === id && row.ok === 0)) return "Independent check failed";
  return null;
}
export function currentStatus(
  snapshot: Snapshot | null,
  id: string,
  now: number,
  failed = false,
): "unknown" | "up" | "down" | "degraded" {
  const row = snapshot?.targets.find((r) => r.target_id === id);
  return failed ||
    !row ||
    now - row.minute * 60000 > 180000 ||
    now - Date.parse(snapshot!.checkedAt) > 180000
    ? "unknown"
    : row.ok === 1
      ? row.probe?.outcome === "transient" || independentIssue(snapshot, id, now) ? "degraded" : "up"
      : "down";
}

export function statusLabel(snapshot: Snapshot | null, id: string, now: number, failed = false, loading = false): string {
  const status = currentStatus(snapshot, id, now, failed);
  if (status === "up") return "Available";
  if (status === "degraded") return independentIssue(snapshot, id, now) ?? "Retry succeeded";
  if (status === "down") {
    const independent = snapshot?.independent;
    const row = snapshot?.targets.find(r => r.target_id === id);
    const fresh = independent && Math.abs(Date.parse(independent.checkedAt) - (row?.minute ?? 0) * 60000) <= 90000 && now - Date.parse(independent.checkedAt) <= 180000;
    return fresh && independent.targets.some(r => r.target_id === id && r.ok === 0) ? "Unavailable · two checks" : "Connection issue";
  }
  if (loading && !snapshot) return "Checking…";
  if (failed) return "Update unavailable";
  return snapshot ? "Updates delayed" : "No recent check";
}
