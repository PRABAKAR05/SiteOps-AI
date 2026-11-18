import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: "neutral" | "danger" | "warn" | "ok" | "brand";
  to?: string;
}) {
  const tones = {
    neutral: "text-ink-muted bg-paper border-line",
    danger: "text-danger bg-[#FDECEA] border-[#F6CFC9]",
    warn: "text-warn bg-[#FDF3E3] border-[#F2DDB8]",
    ok: "text-ok bg-[#E8F5EE] border-[#C6E8D5]",
    brand: "text-brand-800 bg-brand-50 border-brand-100",
  };

  const body = (
    <div className="group flex h-full flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-lift">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", tones[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p className="mono-num text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</p>
        {to ? <ArrowUpRight className="h-3.5 w-3.5 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" /> : null}
      </div>
      {hint ? <p className="mt-2 text-[11px] leading-snug text-ink-muted">{hint}</p> : null}
    </div>
  );

  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}
