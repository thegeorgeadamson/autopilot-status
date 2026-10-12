"use client";
import { useMemo, useState } from "react";
import { EChartsLineChart } from "@/components/evilcharts/charts/echarts-line-chart";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipSurface } from "@/components/ui/tooltip-surface";
import { MarkAreaComponent } from "echarts/components";
import * as echarts from "echarts/core";
import type { Bucket } from "@/lib/status";
echarts.use([MarkAreaComponent]);
const config = {
  response: { label: "Response time", colors: { light: ["#61b99c"] } },
  affected: { label: "Unavailable", colors: { light: ["#ce8e62"] } },
};
function duration(ms: number) {
  return ms >= 1000
    ? `${Number((ms / 1000).toFixed(2))} s`
    : `${Math.round(ms)} ms`;
}
export default function PerformanceChart({
  buckets,
  hours,
  name,
}: {
  buckets: Bucket[];
  hours: number;
  name: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const { data, options, compressed } = useMemo(() => {
    const peak = Math.max(200, ...buckets.map((b) => b.ms ?? 0));
    const magnitude = 10 ** Math.floor(Math.log10(peak));
    const ceiling = [1, 2, 5, 10]
      .map((n) => n * magnitude)
      .find((n) => n >= peak)!;
    const compressed = ceiling > 1000,
      forward = (ms: number) => (compressed ? Math.log1p(ms / 100) : ms),
      back = (v: number) => (compressed ? Math.expm1(v) * 100 : v);
    const data = buckets.map((b) => ({
      time: String(b.start),
      response: b.ms === null ? null : forward(b.ms),
    }));
    const affected = buckets.map((b, i) =>
      b.total &&
      (b.up < b.total ||
        (buckets[i - 1]?.up ?? 0) < (buckets[i - 1]?.total ?? 0) ||
        (buckets[i + 1]?.up ?? 0) < (buckets[i + 1]?.total ?? 0))
        ? data[i].response
        : null,
    );
    const formatter = (params: unknown) => {
      const list = params as { dataIndex: number }[];
      const b = buckets[list[0]?.dataIndex];
      if (!b) return "";
      const date = new Date(b.start * 60000),
        label = date.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      const time = date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      return renderToStaticMarkup(
        <TooltipSurface>
          <p className="font-medium">{label}</p>
          <p className="mt-0.5 text-muted-foreground">
            {b.total
              ? `${duration(b.ms!)} average · ${((b.up / b.total) * 100).toFixed(2)}% available`
              : "No data for this period"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {time} · {hours >= 720 ? 8 : hours === 168 ? 2 : 1}-hour period
          </p>
        </TooltipSurface>,
      );
    };
    const baseSeries = {
      type: "line",
      showSymbol: false,
      symbol: "circle",
      symbolSize: 7,
      connectNulls: false,
      smooth: 0.35,
      smoothMonotone: "x",
      animation: false,
      emphasis: { focus: "none", scale: true },
    };
    const options = {
      animation: false,
      grid: { left: 0, right: 52, top: 18, bottom: 30 },
      textStyle: { fontFamily: "Geist, sans-serif" },
      xAxis: {
        type: "category",
        data: data.map((d) => d.time),
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#9699a0",
          fontSize: 10,
          interval: Math.max(1, Math.floor(data.length / 4)),
          formatter: (v: string) =>
            hours === 24
              ? new Date(Number(v) * 60000).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : new Date(Number(v) * 60000).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                }),
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: forward(ceiling),
        position: "right",
        splitNumber: 3,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#9699a0",
          fontSize: 10,
          formatter: (v: number) =>
            compressed && v !== 0 && Math.abs(v - forward(ceiling)) > 0.001
              ? ""
              : duration(back(v)),
        },
        splitLine: { lineStyle: { color: "#f0f0f2", type: "solid" } },
      },
      tooltip: {
        show: true,
        trigger: "axis",
        triggerOn: "mousemove|click",
        confine: true,
        backgroundColor: "transparent",
        borderWidth: 0,
        padding: 0,
        extraCssText: "box-shadow:none;",
        axisPointer: {
          type: "line",
          lineStyle: { color: "#bcc2c7", type: "dashed", width: 1 },
        },
        formatter,
      },
      series: [
        {
          ...baseSeries,
          name: "Response time",
          data: data.map((d) => d.response),
          lineStyle: { color: "#61b99c", width: 2 },
          itemStyle: { color: "#61b99c", borderColor: "#fff", borderWidth: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(97,185,156,.18)" },
                { offset: 1, color: "rgba(97,185,156,.02)" },
              ],
            },
          },
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(206,142,98,.07)" },
            data: buckets.flatMap((b, i) =>
              b.total && b.up < b.total
                ? [
                    [
                      { xAxis: Math.max(0, i - 0.5) },
                      { xAxis: Math.min(buckets.length - 1, i + 0.5) },
                    ],
                  ]
                : [],
            ),
          },
        },
        {
          ...baseSeries,
          name: "Affected periods",
          data: affected,
          lineStyle: { color: "#ce8e62", width: 2 },
          itemStyle: { color: "#ce8e62", borderColor: "#fff", borderWidth: 2 },
        },
      ],
    };
    return { data, options, compressed };
  }, [buckets, hours]);
  const b = selected === null ? null : buckets[selected];
  return (
    <div
      className="performance"
      tabIndex={0}
      role="group"
      aria-label={`${name} response-time history. Use arrow keys to inspect periods.`}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          setSelected((i) =>
            Math.max(
              0,
              Math.min(
                buckets.length - 1,
                (i ?? buckets.length - 1) + (e.key === "ArrowLeft" ? -1 : 1),
              ),
            ),
          );
        } else if (e.key === "Escape") setSelected(null);
      }}
    >
      <EChartsLineChart
        renderer="svg"
        className="h-[180px] w-full"
        data={data}
        config={config}
        animation={false}
        curveType="monotone"
        chartOptions={options}
      >
        <EChartsLineChart.Grid />
        <EChartsLineChart.XAxis dataKey="time" />
        <EChartsLineChart.YAxis />
        <EChartsLineChart.Tooltip roundness="xl" />
        <EChartsLineChart.Line
          dataKey="response"
          strokeWidth={2}
          connectNulls={false}
        >
          <EChartsLineChart.ActiveDot variant="colored-border" />
        </EChartsLineChart.Line>
      </EChartsLineChart>
      {compressed && (
        <p className="scale-note">
          Compressed scale keeps normal response times visible alongside large
          spikes.
        </p>
      )}
      <span className="sr-only">
        Green indicates response time. Amber highlights periods with unavailable
        responses. Gaps have no data.
      </span>
      {b && (
        <div className="keyboard-detail" role="status">
          {new Date(b.start * 60000).toLocaleString()}:{" "}
          {b.total
            ? `${duration(b.ms!)} average response time · ${((b.up / b.total) * 100).toFixed(2)}% available`
            : "No data"}
        </div>
      )}
    </div>
  );
}
