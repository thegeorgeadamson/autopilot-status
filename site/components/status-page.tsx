"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LogoMark } from "@/components/brand/LogoMark";
import {
  SERVICES,
  aggregate,
  summarize,
  currentStatus,
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
      setHours(960);
      return;
    }
    const load = async () => {
      if (document.hidden || active) return;
      active = new AbortController();
      const timeout = setTimeout(() => active?.abort(), 12000);
      try {
        const res = await fetch("https://uptime-api.aplt.ai/status", {
          signal: active.signal,
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
    down = items.some((s) => s.status === "down");
  const headline = unknown
    ? "Status unavailable"
    : down
      ? "Some services are unavailable"
      : "All listed services are available";
  return (
    <>
      <main>
        <header>
          <a
            className="brand"
            href="https://app.aplt.ai"
            aria-label="Autopilot home"
          >
            <LogoMark className="size-[25px]" />
            <span className="brand-label">
              Autopilot<span>Status</span>
            </span>
          </a>
          <a href="https://app.aplt.ai" className="open-app">
            Open Autopilot ↗
          </a>
        </header>
        {demo && (
          <aside className="demo-banner">
            <strong>Local preview · simulated data</strong>
            <p>
              40 days of example performance, including slow periods, outages
              and gaps. This is not live service status.
            </p>
            <div className="demo-options" aria-label="Demo scenario">
              {scenarios.map((s) => (
                <Button
                  key={s.id}
                  variant={scenario === s.id ? "outline" : "ghost"}
                  size="sm"
                  aria-pressed={scenario === s.id}
                  onClick={() => setScenario(s.id)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </aside>
        )}
        <section
          id="summary"
          className={unknown ? "unknown" : down ? "down" : ""}
          aria-live="polite"
        >
          <h1>{headline}</h1>
          <p id="updated">
            {demo
              ? "Example service status · simulated data"
              : snapshot
                ? `Last updated ${ago(now - Date.parse(snapshot.checkedAt))}${unknown ? " · current status unavailable" : ""}`
                : startsAt
                  ? `Status updates resume ${new Date(startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
                  : clock === null
                    ? "Loading the latest updates…"
                    : "The latest status is temporarily unavailable. Please check back soon."}
          </p>
        </section>
        <div className="controls">
          <h2>Service availability</h2>
          <div
            className="range-control"
            role="group"
            aria-label="History range"
          >
            {[
              ...ranges,
              ...(demo ? [{ hours: 960, label: "40 days" }] : []),
            ].map((r) => (
              <Button
                key={r.hours}
                variant="ghost"
                size="sm"
                className={hours === r.hours ? "range-active" : ""}
                aria-pressed={hours === r.hours}
                onClick={() => setHours(r.hours)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
        <Card className="services gap-0 py-0 bg-white ring-0 border border-border">
          <CardContent className="px-0">
            {items.map((s) => (
              <section
                className="service"
                key={s.id}
                aria-labelledby={`service-${s.id}`}
              >
                <CardHeader className="service-head">
                  <div>
                    <h3 id={`service-${s.id}`}>{s.name}</h3>
                    <span className="service-description">{s.description}</span>
                  </div>
                  <span className={`badge ${s.status}`}>
                    <span className="dot" />
                    {s.status === "unknown"
                      ? "Awaiting updates"
                      : s.status === "up"
                        ? "Available"
                        : "Unavailable"}
                  </span>
                  <div className="availability">
                    <strong>
                      {s.summary.availability === null
                        ? "—"
                        : `${s.summary.availability.toFixed(2)}%`}
                    </strong>
                    <span>Observed availability</span>
                  </div>
                </CardHeader>
                <div className="history">
                  {s.summary.total ? (
                    <>
                      <div className="chart-heading">
                        <span>Average response time · lower is better</span>
                        <strong>
                          {Math.round(s.summary.ms!).toLocaleString()} ms
                        </strong>
                      </div>
                      <div className="mobile-availability">
                        {s.summary.availability!.toFixed(2)}% observed
                        availability
                      </div>
                      <Chart buckets={s.buckets} hours={hours} name={s.name} />
                    </>
                  ) : (
                    <div className="empty-history">
                      <strong>No performance history yet</strong>
                      <span>
                        Updates will appear here as they become available.
                      </span>
                    </div>
                  )}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
        <div id="historyUpdated">
          {demo
            ? "40-day demo · not live monitoring"
            : snapshot
              ? `History updated ${ago(now - Date.parse(snapshot.historyUpdatedAt))}`
              : "No history available yet."}
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
