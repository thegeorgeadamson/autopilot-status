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

import { smoothTrend } from "../lib/status.ts";

test("trend reduces noise without altering raw readings or bridging gaps and outages", () => {
  const make = (ms: number | null, up = 60) => ({
    start: 0,
    total: ms === null ? 0 : 60,
    up: ms === null ? 0 : up,
    ms,
  });
  const readings = [
    make(80),
    make(140),
    make(80),
    make(140),
    make(null),
    make(10000, 0),
    make(110),
  ];
  const original = JSON.stringify(readings),
    trend = smoothTrend(readings);
  assert.ok(trend[1]! < 140 && trend[1]! > 80);
  assert.equal(trend[4], null);
  assert.equal(trend[5], 10000);
  assert.equal(trend[6], 110);
  assert.equal(JSON.stringify(readings), original);
});
