"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { HeaderMetric } from "@/components/reports/header-metric";
import { ChartMetricTabs } from "@/components/reports/charts/ChartMetricTabs";
import { SettingsSection } from "@/components/shell/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { DocsNav } from "@/components/layout/DocsNav";
import {
  SERVICES,
  aggregate,
  summarize,
  currentStatus,
  statusLabel,
  parseSnapshot,
  type Snapshot,
} from "@/lib/status";
import type { Scenario } from "@/lib/demo";
const Chart = dynamic(() => import("@/components/performance-chart"), {
  ssr: false,
  loading: () => (
    <div className="chart-placeholder" aria-label="Loading performance chart" />
  ),
});
const ranges = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 2160, label: "90 days" },
];
const scenarios = [
  { id: "mixed", label: "Recovered outages" },
  { id: "healthy", label: "All healthy" },
  { id: "outage", label: "Active outage" },
] as const;
const policies = [
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Acceptable Use", "/acceptable-use"],
  ["Subprocessors", "/subprocessors"],
  ["All policies", ""],
];
const ago = (ms: number) => {
  const n = Math.max(0, Math.floor(ms / 60000));
  return n < 1 ? "just now" : `${n} minute${n === 1 ? "" : "s"} ago`;
};
export function StatusPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [hours, setHours] = useState(24),
    [failed, setFailed] = useState(false),
    [startsAt, setStartsAt] = useState<string | null>(null),
    [clock, setClock] = useState<number | null>(null),
    [demo, setDemo] = useState(false),
    [scenario, setScenario] = useState<Scenario>("mixed"),
    [year, setYear] = useState(2026);
  useEffect(() => {
    let stopped = false,
      active: AbortController | null = null;
    const local =
      ["localhost", "127.0.0.1", "::1"].includes(location.hostname) &&
      new URLSearchParams(location.search).has("demo");
    setClock(Date.now());
    setYear(new Date().getFullYear());
    if (local) {
      setDemo(true);
      setHours(720);
      return;
    }
    const load = async () => {
      if (document.hidden || active) return;
      active = new AbortController();
      const timeout = setTimeout(() => active?.abort(), 12000);
      try {
        const res = await fetch("https://uptime-api.aplt.ai/status", {
          signal: active.signal,
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          if (!stopped)
            setStartsAt(
              typeof data.startsAt === "string" &&
                Number.isFinite(Date.parse(data.startsAt))
                ? data.startsAt
                : null,
            );
          throw Error("Unavailable");
        }
        const next = parseSnapshot(data);
        if (!stopped) {
          setSnapshot(next);
          setFailed(false);
          setStartsAt(null);
        }
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        clearTimeout(timeout);
        active = null;
      }
    };
    void load();
    const poll = setInterval(() => void load(), 60000),
      tick = setInterval(() => setClock(Date.now()), 15000);
    const visible = () => {
      if (!document.hidden) {
        setClock(Date.now());
        void load();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      active?.abort();
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (demo) {
      let cancelled = false;
      void import("@/lib/demo").then(({ makeDemo }) => {
        if (!cancelled) setSnapshot(makeDemo(scenario));
      });
      return () => {
        cancelled = true;
      };
    }
  }, [demo, scenario]);
  const now = demo && snapshot ? Date.parse(snapshot.checkedAt) : (clock ?? 0);
  const history = useMemo(
    () =>
      SERVICES.map((service) => {
        const buckets = aggregate(
          snapshot,
          service.id,
          hours,
          snapshot ? Date.parse(snapshot.checkedAt) : 0,
        );
        return { ...service, buckets, summary: summarize(buckets) };
      }),
    [snapshot, hours],
  );
  const items = history.map((service) => ({
    ...service,
    status: currentStatus(snapshot, service.id, now, failed),
  }));
  const unknown = items.some((s) => s.status === "unknown"),
    down = items.some((s) => s.status === "down"),
    transient = items.some((s) => s.status === "degraded");
  const headline = unknown
    ? "Status unavailable"
    : down
      ? "Some service checks are failing"
      : transient ? "Some service checks need attention" : "All listed services are available";
  const updated = demo
    ? "Example service status · simulated data"
    : snapshot
      ? `Last updated ${ago(now - Date.parse(snapshot.checkedAt))}${unknown ? " · current status unavailable" : ""}`
      : startsAt
        ? `Status updates resume ${new Date(startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
        : clock === null
          ? "Loading the latest updates…"
          : "The latest status is temporarily unavailable. Please check back soon.";
  return (
    <>
      <DocsNav />
      <main className="status-shell">
        <div className="status-content">
          <div className="page-heading">
            <p className="text-sm text-muted-foreground">Autopilot</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Service status
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Availability and performance across our services.
            </p>
          </div>
          {demo && (
            <aside className="demo-preview">
              <p className="text-[11px] text-muted-foreground">
                Local preview · simulated data
              </p>
              <div className="demo-picker">
                <ChartMetricTabs
                  value={scenario}
                  onChange={setScenario}
                  label="Demo scenario"
                  options={scenarios.map((s) => ({
                    value: s.id,
                    label: s.label,
                  }))}
                />
              </div>
            </aside>
          )}
          <section className="status-overview" aria-live="polite">
            <HeaderMetric
              tone={unknown ? "sky" : down ? "red" : transient ? "amber" : "emerald"}
              label="Current status"
              value={headline}
              detail={updated}
            />
          </section>
          <SettingsSection
            title="Services"
            trailing={
              <ChartMetricTabs
                label="History range"
                value={String(hours)}
                onChange={(v) => setHours(Number(v))}
                options={ranges.map((r) => ({ value: String(r.hours), label: r.label }))}
              />
            }
          >
            <div className="divide-y divide-border">
              {items.map((s) => (
                <article
                  key={s.id}
                  aria-labelledby={`service-${s.id}`}
                  className="grid min-w-0 gap-5 px-4 py-5 sm:px-5 lg:grid-cols-[160px_minmax(0,1fr)]"
                >
                  <div className="service-info">
                    <div>
                      <h2
                        id={`service-${s.id}`}
                        className="text-[13px] font-semibold"
                      >
                        {s.name}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    </div>
                    <div className="availability-metric">
                      <p className="text-xs text-muted-foreground">
                        Successful checks
                      </p>
                      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                        {s.summary.availability === null
                          ? "—"
                          : `${s.summary.availability.toFixed(2)}%`}
                      </p>
                    </div>
                    <Badge
                      size="md"
                      tone={
                        s.status === "up"
                          ? "emerald"
                          : s.status === "down" || s.status === "degraded"
                            ? "amber"
                            : "neutral"
                      }
                      className="w-fit rounded-lg px-2.5 py-1.5 font-normal"
                    >
                      <span className="size-1.5 rounded-full bg-current" />
                      {statusLabel(snapshot, s.id, now, failed, clock === null)}
                    </Badge>
                  </div>
                  <div className="min-w-0">
                    <div className="chart-caption">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Response time
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {hours === 2160 ? "Response times retained for 30 days" : "Average for the selected period"}
                        </p>
                      </div>
                      <Badge
                        tone="sky"
                        size="md"
                        className="rounded-full px-2.5 py-1.5 font-medium tabular-nums"
                      >
                        {s.summary.ms === null
                          ? "—"
                          : `${Math.round(s.summary.ms).toLocaleString()} ms`}
                      </Badge>
                    </div>
                    {s.summary.total ? (
                      <Chart buckets={s.buckets} hours={hours} name={s.name} />
                    ) : (
                      <div className="empty-history">
                        <p className="text-sm font-medium">
                          No performance history yet
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Updates will appear here as they become available.
                        </p>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </SettingsSection>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Successful checks measure public reachability, not guaranteed customer uptime. Failed checks are retried twice; recovered attempts remain recorded. Older history uses the original single-attempt checks.
          </p>
          {!demo && snapshot?.independent && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Independent check: {now - Date.parse(snapshot.independent.checkedAt) > 20 * 60000 ? "updates delayed" : snapshot.independent.targets.every(t => t.ok === 1) ? "all services responding" : "connection issues detected"} · {ago(now - Date.parse(snapshot.independent.checkedAt))}.
              {" "}Sign-in and workspace: {now - Date.parse(snapshot.independent.checkedAt) > 20 * 60000 ? "updates delayed" : snapshot.independent.browser.status === "passed" ? "passed" : snapshot.independent.browser.status === "failed" ? "check failed" : "not yet configured"}.
            </p>
          )}
          <p className="mt-4 text-right text-[11px] text-muted-foreground">
            {demo
              ? "40-day demo · not live monitoring"
              : snapshot
                ? `History updated ${ago(now - Date.parse(snapshot.historyUpdatedAt))}`
                : "No history available yet."}
          </p>
        </div>
      </main>
      <footer className="docs-footer">
        <div className="docs-footer-inner">
          <div className="docs-footer-copy">
            <p>© {year} Autopilot. All rights reserved.</p>
            <p>Made in Aotearoa, New Zealand</p>
          </div>
          <div className="docs-footer-links">
            {policies.map(([name, path]) => (
              <a key={name} href={`https://legal.aplt.ai${path}`}>
                {name}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </>
  );
}
