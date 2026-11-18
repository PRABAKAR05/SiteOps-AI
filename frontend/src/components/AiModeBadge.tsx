import { useQuery } from "@tanstack/react-query";
import { Bot, CircleHelp } from "lucide-react";
import { aiApi } from "@/lib/api";
import type { AiStatus } from "@/lib/types";
import { Badge } from "./ui/Badge";

export function useAiStatus() {
  return useQuery<AiStatus>({
    queryKey: ["ai-status"],
    queryFn: async () => (await aiApi.status()).data,
    staleTime: 60_000,
  });
}

export function AiModeNote({ className }: { className?: string }) {
  const { data } = useAiStatus();
  if (!data) return null;
  const copy =
    data.mode === "groq"
      ? `Live LLM (${data.model}). Outputs are grounded against your records and never saved without review.`
      : data.mode === "disabled"
        ? "AI features are switched off on this server. Deterministic numbers and workflows still work."
        : "No LLM key is configured. AI panels run deterministic review rules and are labelled “Rules · no LLM” — nothing is presented as model output.";
  return (
    <div className={`flex items-start gap-2 rounded-lg border border-line bg-paper/70 px-3 py-2 text-xs text-ink-muted ${className ?? ""}`}>
      <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
      <p>{copy}</p>
    </div>
  );
}

export function AiModeBadge() {
  const { data } = useAiStatus();
  if (!data) return null;
  if (data.mode === "groq") return <Badge tone="brand" dot><Bot className="h-3 w-3" /> AI live</Badge>;
  if (data.mode === "disabled") return <Badge tone="neutral" dot>AI off</Badge>;
  return <Badge tone="warn" dot>AI rules mode</Badge>;
}
