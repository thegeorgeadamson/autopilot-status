"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ChartMetricTabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode }>; label: string;
}) {
  return <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" onClick={() => onChange(option.value)} aria-pressed={value === option.value}
      className={cn("h-8 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === option.value ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{option.label}</button>)}
  </div>;
}
