import type { ReactNode } from "react";
import { ChevronRightIcon, ChevronDownIcon } from "lucide-react";

/** Shared section and row layout for account settings. */
export function SettingsSection({ title, children, trailing, description }: { title: string; children: ReactNode; trailing?: ReactNode; description?: string }) {
  return <section className="space-y-2.5">
    <div className="flex items-center justify-between gap-4"><h2 className="text-[13px] font-semibold text-foreground">{title}</h2>{trailing}</div>
    {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
    <div className="overflow-hidden rounded-2xl border border-border bg-transparent">{children}</div>
  </section>;
}

export function SettingsDivider() {
  return <div aria-hidden="true" className="mx-4 border-t border-border sm:mx-5" />;
}

export function SettingsRow({ href, onOpen, expanded, title, description, trailing, children, disabled, disclosure = "right" }: {
  href?: string; onOpen?: () => void; expanded?: boolean; title: string; description: string; trailing?: ReactNode; children?: ReactNode; disabled?: boolean; disclosure?: "right" | "down";
}) {
  const heading = <>
    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-foreground">{title}</span><span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{description}</span></span>
    {trailing ? <span className="shrink-0 text-[12px] text-muted-foreground">{trailing}</span> : null}
  </>;
  if (href) return <a href={href} className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-app-panel-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 sm:px-5">
    {heading}<ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
  </a>;
  if (onOpen) return <div>
    <button type="button" onClick={onOpen} disabled={disabled} aria-expanded={expanded} className="flex min-h-16 w-full cursor-pointer items-center gap-4 px-4 py-3 text-left transition-colors disabled:cursor-default disabled:opacity-50 hover:bg-app-panel-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 sm:px-5">
      {heading}{disclosure === "down" ? <ChevronDownIcon aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground/70 transition-transform ${expanded ? "rotate-180" : ""}`} /> : <ChevronRightIcon aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground/70 transition-transform ${expanded ? "rotate-90" : ""}`} />}
    </button>
    {expanded && children ? <div className="px-4 pb-4 sm:px-5">{children}</div> : null}
  </div>;
  return <div className="px-4 py-3 sm:px-5">
    <div className="flex min-h-10 items-center gap-4">{heading}</div>
    {children && expanded !== false ? <div className="mt-3">{children}</div> : null}
  </div>;
}

/** Editable settings rows share the same inset separators as action rows. */
export function SettingsFieldRow({ children }: { children: ReactNode }) {
  return <label className="relative grid gap-2 px-4 py-4 before:absolute before:inset-x-4 before:top-0 before:border-t before:border-border first:before:hidden sm:px-5 sm:before:inset-x-5">{children}</label>;
}
