"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

import { badgeToneStyles, type BadgeTone } from "./badge-styles";
export type { BadgeTone } from "./badge-styles";
const tones = Object.keys(badgeToneStyles) as BadgeTone[];

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-transparent font-semibold leading-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:ring-2 aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:shrink-0",
  {
    variants: {
      size: {
        xs: "min-h-4 px-1 text-[10px] [&>svg]:size-2.5",
        sm: "min-h-5 px-1.5 text-[11px] [&>svg]:size-3",
        md: "min-h-6 px-2 text-xs [&>svg]:size-3.5",
        lg: "min-h-7 px-2.5 text-[13px] [&>svg]:size-4",
      },
      tone: Object.fromEntries(tones.map(tone => [tone, badgeToneStyles[tone].soft])) as Record<BadgeTone, string>,
      variant: {
        soft: "",
        solid: "",
        outline: "",
        // Compatibility for existing shared Badge consumers.
        default: "bg-foreground text-background",
        secondary: "",
        destructive: "bg-red-500/10 text-red-700 dark:text-red-300",
        ghost: "bg-transparent text-muted-foreground",
        link: "bg-transparent text-foreground underline-offset-4 hover:underline",
      },
      count: { true: "tabular-nums", false: "" },
    },
    compoundVariants: [...tones.flatMap(tone => [
      { tone, variant: "outline" as const, className: badgeToneStyles[tone].outline },
      { tone, variant: "solid" as const, className: badgeToneStyles[tone].solid },
    ]),
      { count: true, size: "xs", className: "min-w-4" },
      { count: true, size: "sm", className: "min-w-6" },
      { count: true, size: "md", className: "min-w-7" },
      { count: true, size: "lg", className: "min-w-8" },
    ],
    defaultVariants: { variant: "soft", tone: "neutral", size: "sm", count: false },
  },
);

export type BadgeProps = useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;
function Badge({ className, variant = "soft", tone = "neutral", size = "sm", count = false, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant, tone, size, count }), className) }, props),
    state: { slot: "badge", variant, tone, size },
  });
}
export { Badge, badgeVariants };
