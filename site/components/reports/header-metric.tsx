import {cn} from "@/lib/utils";
import {badgeToneStyles,type BadgeTone} from "@/components/ui/badge-styles";
export function HeaderMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: BadgeTone;
}) {
  return (
    <div className={cn("min-w-0 rounded-2xl px-4 py-4 sm:px-5", badgeToneStyles[tone].soft)}>
      <div className="text-xs font-medium">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
        {value}
      </div>
      <div className="mt-2 text-xs leading-5">{detail}</div>
    </div>
  );
}
