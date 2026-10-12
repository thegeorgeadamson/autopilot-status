"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@/lib/utils";

export const TOOLTIP_HOVER_DELAY = 280;
const TOOLTIP_SURFACE_CLASS = "rounded-xl border border-border bg-white px-3 py-2 text-xs font-normal text-popover-foreground shadow-sm dark:bg-neutral-900";

export function TooltipSurface({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: cn(TOOLTIP_SURFACE_CLASS, className) }, props),
  });
}
