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
};
export type Hour = {
  target_id: string;
  bucket: number;
  total: number;
  up: number;
  latency_sum: number;
};
export type Snapshot = {
  checkedAt: string;
  historyUpdatedAt: string;
  targets: Current[];
  hourly: Hour[];
  daily?: Hour[];
};
export type Bucket = {
  start: number;
  total: number;
  up: number;
  ms: number | null;
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
        ![r.bucket, r.total, r.up, r.latency_sum].every(Number.isFinite) ||
        r.total <= 0 ||
        r.up < 0 ||
        r.up > r.total ||
        r.latency_sum < 0,
    )
  )
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
  return Array.from({ length: periods }, (_, i) => {
    const start = end - (periods - 1) * group * step + i * group * step;
    let total = 0,
      up = 0,
      latency = 0;
    for (let j = 0; j < group; j++) {
      const r = byHour.get(start + j * step);
      if (r) {
        total += r.total;
        up += r.up;
        latency += r.latency_sum;
      }
    }
    return { start, total, up, ms: total ? latency / total : null };
  });
}
export function summarize(buckets: Bucket[]) {
  const total = buckets.reduce((n, b) => n + b.total, 0),
    up = buckets.reduce((n, b) => n + b.up, 0);
  return {
    total,
    availability: total ? (up / total) * 100 : null,
    ms: total
      ? buckets.reduce((n, b) => n + (b.ms ?? 0) * b.total, 0) / total
      : null,
  };
}
export function currentStatus(
  snapshot: Snapshot | null,
  id: string,
  now: number,
  failed = false,
): "unknown" | "up" | "down" {
  const row = snapshot?.targets.find((r) => r.target_id === id);
  return failed ||
    !row ||
    now - row.minute * 60000 > 180000 ||
    now - Date.parse(snapshot!.checkedAt) > 180000
    ? "unknown"
    : row.ok === 1
      ? "up"
      : "down";
}
