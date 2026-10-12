export const badgeToneStyles = {
  neutral: { soft: "bg-foreground/[0.06] text-foreground/70", outline: "border-foreground/15", solid: "bg-foreground text-background" },
  orange: { soft: "bg-orange-500/10 text-orange-700 dark:text-orange-300", outline: "border-orange-500/25", solid: "bg-orange-600 text-white dark:bg-orange-400 dark:text-neutral-950" },
  amber: { soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300", outline: "border-amber-500/25", solid: "bg-amber-600 text-white dark:bg-amber-400 dark:text-neutral-950" },
  blue: { soft: "bg-blue-500/10 text-blue-700 dark:text-blue-300", outline: "border-blue-500/25", solid: "bg-blue-600 text-white dark:bg-blue-400 dark:text-neutral-950" },
  sky: { soft: "bg-sky-500/10 text-sky-700 dark:text-sky-300", outline: "border-sky-500/25", solid: "bg-sky-600 text-white dark:bg-sky-400 dark:text-neutral-950" },
  cyan: { soft: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300", outline: "border-cyan-500/25", solid: "bg-cyan-600 text-white dark:bg-cyan-400 dark:text-neutral-950" },
  emerald: { soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", outline: "border-emerald-500/25", solid: "bg-emerald-600 text-white dark:bg-emerald-400 dark:text-neutral-950" },
  rose: { soft: "bg-rose-500/10 text-rose-700 dark:text-rose-300", outline: "border-rose-500/25", solid: "bg-rose-600 text-white dark:bg-rose-400 dark:text-neutral-950" },
  pink: { soft: "bg-pink-500/10 text-pink-700 dark:text-pink-300", outline: "border-pink-500/25", solid: "bg-pink-600 text-white dark:bg-pink-400 dark:text-neutral-950" },
  red: { soft: "bg-red-500/10 text-red-700 dark:text-red-300", outline: "border-red-500/25", solid: "bg-red-600 text-white dark:bg-red-400 dark:text-neutral-950" },
  violet: { soft: "bg-violet-500/10 text-violet-700 dark:text-violet-300", outline: "border-violet-500/25", solid: "bg-violet-600 text-white dark:bg-violet-400 dark:text-neutral-950" },
  indigo: { soft: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300", outline: "border-indigo-500/25", solid: "bg-indigo-600 text-white dark:bg-indigo-400 dark:text-neutral-950" },
  slate: { soft: "bg-slate-500/10 text-slate-700 dark:text-slate-300", outline: "border-slate-500/25", solid: "bg-slate-600 text-white dark:bg-slate-400 dark:text-neutral-950" },
} as const;
export type BadgeTone = keyof typeof badgeToneStyles;
