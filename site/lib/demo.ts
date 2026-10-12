import { SERVICES, type Snapshot, type Hour } from "./status";
export type Scenario = "mixed" | "healthy" | "outage";
export function makeDemo(
  scenario: Scenario = "mixed",
  now = Date.now(),
): Snapshot {
  const hourly: Hour[] = [];
  const end = Math.floor(now / 3600000) * 60;
  SERVICES.forEach((t, k) => {
    let seed = (k + 1) * 104729,
      drift = 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 959; i >= 0; i--) {
      if (scenario !== "healthy" && t.id === "app" && i >= 416 && i < 432)
        continue;
      drift = Math.max(-12, Math.min(12, drift + (random() - 0.5) * 2));
      let up = 60,
        ms = 110 + k * 38 + drift + (random() - 0.5) * 16;
      if ([137 + k * 11, 521 - k * 13, 733 + k * 7].includes(i))
        ms += 160 + k * 35;
      if (scenario !== "healthy") {
        if (
          t.id === "app" &&
          ((i >= 680 && i < 688) || (i >= 146 && i < 152))
        ) {
          up = 0;
          ms = 10000;
        }
        if (t.id === "app" && i >= 245 && i < 270) ms += 650;
        if (t.id === "sign" && i >= 510 && i < 522) {
          up = 20;
          ms = 3600;
        }
        if (t.id === "sign" && i >= 85 && i < 100) ms += 1100;
        if (t.id === "docs" && i >= 800 && i < 804) {
          up = 0;
          ms = 450;
        }
        if (t.id === "docs" && i >= 340 && i < 352) ms += 270;
      }
      if (scenario === "outage" && t.id === "sign" && i < 6) {
        up = 0;
        ms = 10000;
      }
      hourly.push({
        target_id: t.id,
        bucket: end - i * 60,
        total: 60,
        up,
        latency_sum: Math.round(ms * 60),
      });
    }
  });
  return {
    checkedAt: new Date(now).toISOString(),
    historyUpdatedAt: new Date(now).toISOString(),
    hourly,
    targets: SERVICES.map((t) => ({
      target_id: t.id,
      minute: Math.floor(now / 60000),
      ok: scenario === "outage" && t.id === "sign" ? 0 : 1,
      latency_ms: 150,
    })),
  };
}
