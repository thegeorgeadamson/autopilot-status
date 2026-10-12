import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  summarize,
  currentStatus,
  parseSnapshot,
} from "../lib/status.ts";
const now = Date.parse("2026-10-12T00:30:00Z");
const base = {
  checkedAt: new Date(now).toISOString(),
  historyUpdatedAt: new Date(now).toISOString(),
  targets: [
    {
      target_id: "app",
      minute: Math.floor(now / 60000),
      ok: 1,
      latency_ms: 100,
    },
  ],
  hourly: [],
};
test("weighted latency and missing buckets stay distinct from zero", () => {
  const snapshot = {
    ...base,
    hourly: [
      {
        target_id: "app",
        bucket: Math.floor(now / 3600000) * 60,
        total: 60,
        up: 60,
        latency_sum: 6000,
      },
      {
        target_id: "app",
        bucket: Math.floor(now / 3600000) * 60 - 60,
        total: 20,
        up: 10,
        latency_sum: 20000,
      },
    ],
  };
  const buckets = aggregate(snapshot, "app", 24, now);
  assert.equal(buckets[0].ms, null);
  assert.deepEqual(summarize(buckets), {
    total: 80,
    availability: 87.5,
    ms: 325,
  });
});
test("wide windows include the latest hour and exclude older history", () => {
  for (const hours of [168, 720, 960]) {
    const s = {
      ...base,
      hourly: [
        {
          target_id: "app",
          bucket: Math.floor(now / 3600000) * 60,
          total: 60,
          up: 0,
          latency_sum: 600000,
        },
      ],
    };
    const b = aggregate(s, "app", hours, now);
    assert.equal(b.at(-1)!.ms, 10000);
    assert.equal(summarize(b).availability, 0);
  }
});
test("stale or failed API is unknown, never healthy", () => {
  assert.equal(currentStatus(base, "app", now), "up");
  assert.equal(currentStatus(base, "app", now + 181000), "unknown");
  assert.equal(currentStatus(base, "app", now, true), "unknown");
  assert.equal(currentStatus(base, "docs", now), "unknown");
});
test("invalid metrics cannot enter chart formatting", () => {
  assert.throws(() =>
    parseSnapshot({
      ...base,
      hourly: [
        { target_id: "app", bucket: 0, total: 60, up: 70, latency_sum: 1 },
      ],
    }),
  );
  assert.throws(() => parseSnapshot({ ...base, checkedAt: "bad" }));
  assert.equal(parseSnapshot(base), base);
});

test("90 days uses daily summaries once, with missing days and weighted metrics", () => {
  const today = Math.floor(now / 86400000) * 1440;
  const row = (bucket: number, total: number, up: number, latency_sum: number) => ({target_id: "app", bucket, total, up, latency_sum});
  const snapshot = parseSnapshot({...base,
    hourly: [row(today, 60, 60, 600000)],
    daily: [row(today - 90 * 1440, 100, 0, 100000), row(today - 89 * 1440, 60, 30, 6000), row(today, 20, 20, 20000)],
  });
  const buckets = aggregate(snapshot, "app", 2160, now);
  assert.equal(buckets.length, 90);
  assert.equal(buckets[0].ms, 100);
  assert.equal(buckets[1].ms, null);
  assert.equal(buckets.at(-1)!.ms, 1000);
  assert.deepEqual(summarize(buckets), {total: 80, availability: 62.5, ms: 325});
  assert.throws(() => parseSnapshot({...base, daily: [row(today, 1, 2, 0)]}));
});
