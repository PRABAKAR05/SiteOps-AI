import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Progress({ value, className, tone }: { value: number; className?: string; tone?: "brand" | "warn" | "danger" }) {
  const clamped = Math.max(0, Math.min(100, value || 0));
  const color = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-brand-600";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[#EBE8DF]", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: Array<{ value: T; label: ReactNode; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-line no-scrollbar", className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
            value === item.value ? "text-brand-800" : "text-ink-muted hover:text-ink",
          )}
        >
          <span className="flex items-center gap-1.5">
            {item.label}
            {typeof item.count === "number" ? (
              <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">{item.count}</span>
            ) : null}
          </span>
          {value === item.value ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" /> : null}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = "md" }: { name?: string | null; size?: "sm" | "md" | "lg" }) {
  const dimensions = size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs";
  const letters = (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-brand-100 bg-brand-50 font-semibold text-brand-800",
        dimensions,
      )}
      aria-hidden
    >
      {letters || "?"}
    </span>
  );
}
