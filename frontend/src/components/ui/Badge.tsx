import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { titleCase } from "@/lib/format";

const toneStyles = {
  neutral: "bg-[#F1F0EA] text-ink-muted border-[#E3E0D6]",
  brand: "bg-brand-50 text-brand-800 border-brand-100",
  ok: "bg-[#E8F5EE] text-ok border-[#C6E8D5]",
  warn: "bg-[#FDF3E3] text-warn border-[#F2DDB8]",
  danger: "bg-[#FDECEA] text-danger border-[#F6CFC9]",
  info: "bg-[#EAF1FA] text-[#1D4E89] border-[#CFE0F2]",
} as const;

export type BadgeTone = keyof typeof toneStyles;

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        toneStyles[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden /> : null}
      {children}
    </span>
  );
}

const statusTones: Record<string, BadgeTone> = {
  draft: "neutral",
  submitted: "info",
  approved: "ok",
  rejected: "danger",
  open: "warn",
  assigned: "info",
  in_progress: "info",
  waiting: "neutral",
  resolved: "ok",
  closed: "neutral",
  not_started: "neutral",
  blocked: "danger",
  completed: "ok",
  cancelled: "neutral",
  uploaded: "neutral",
  extracting: "info",
  extracted: "brand",
  needs_review: "warn",
  verified: "ok",
  failed: "danger",
  ready: "ok",
  processing: "info",
  low: "ok",
  medium: "warn",
  high: "danger",
  critical: "danger",
  active: "ok",
  planning: "info",
  on_hold: "warn",
  low_stock: "warn",
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return <span className="text-ink-faint">—</span>;
  return (
    <Badge tone={statusTones[status] ?? "neutral"} dot className={className}>
      {titleCase(status)}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  return <Badge tone={statusTones[priority] ?? "neutral"}>{titleCase(priority)}</Badge>;
}

export function MethodBadge({ method }: { method?: string | null }) {
  if (!method) return null;
  const label =
    method === "llm" ? "AI · LLM" : method === "rules" ? "Rules · no LLM" : method === "extractive" ? "Extractive" : titleCase(method);
  return (
    <Badge tone={method === "llm" ? "brand" : "neutral"} dot>
      {label}
    </Badge>
  );
}

export function ChipList({ items, empty = "—" }: { items?: ReactNode[]; empty?: string }) {
  if (!items || items.length === 0) return <span className="text-ink-faint">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center rounded-md bg-paper px-2 py-1 text-xs text-ink-muted">
          {item}
        </span>
      ))}
    </div>
  );
}
