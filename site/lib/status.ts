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
    s.hourly.length > 10000
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
    s.hourly.some(
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
  const end =
    Math.floor((snapshot ? Date.parse(snapshot.checkedAt) : now) / 3600000) *
    60;
  const group = hours >= 720 ? 8 : hours === 168 ? 2 : 1;
  const byHour = new Map(
    (snapshot?.hourly ?? [])
      .filter((r) => r.target_id === id)
      .map((r) => [r.bucket, r]),
  );
  return Array.from({ length: hours / group }, (_, i) => {
    const start = end - (hours - group) * 60 + i * group * 60;
    let total = 0,
      up = 0,
      latency = 0;
    for (let j = 0; j < group; j++) {
      const r = byHour.get(start + j * 60);
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

// A quiet visual trend. Missing and unavailable periods keep their exact values,
// and healthy values never borrow across those boundaries. Hover uses raw buckets.
export function smoothTrend(buckets: Bucket[]): (number | null)[] {
  return buckets.map((bucket, index) => {
    if (bucket.ms === null || bucket.up < bucket.total) return bucket.ms;
    let weighted = bucket.ms * bucket.total * 4,
      weight = bucket.total * 4;
    for (const direction of [-1, 1])
      for (let step = 1; step <= 3; step++) {
        const next = buckets[index + direction * step];
        if (!next || next.ms === null || next.up < next.total) break;
        const w = (4 - step) * next.total;
        weighted += next.ms * w;
        weight += w;
      }
    return weighted / weight;
  });
}
