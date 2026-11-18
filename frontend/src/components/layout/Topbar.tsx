import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, ChevronDown, Menu } from "lucide-react";
import { miscApi } from "@/lib/api";
import { useProject } from "@/context/ProjectContext";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { useAiStatus } from "@/components/AiModeBadge";
import { formatDateTime } from "@/lib/format";

function ProjectSwitcher() {
  const { projects, projectId, setProjectId } = useProject();
  if (!projects.length) return null;
  return (
    <div className="relative min-w-0">
      <label htmlFor="project-switcher" className="sr-only">
        Active project
      </label>
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white pl-2.5 pr-1.5 transition-colors focus-within:border-brand-400">
        <span className="hidden text-[10px] font-semibold uppercase tracking-widest text-ink-faint sm:block">Project</span>
        <select
          id="project-switcher"
          value={projectId ?? ""}
          onChange={(event) => setProjectId(event.target.value)}
          className="max-w-[180px] cursor-pointer appearance-none truncate bg-transparent py-2 pr-5 text-[13px] font-medium text-ink focus:outline-none sm:max-w-[320px]"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} · {project.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none -ml-5 h-3.5 w-3.5 text-ink-faint" aria-hidden />
      </div>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await miscApi.notifications({ page_size: 12 })).data,
    enabled: open,
  });
  const readAll = useMutation({
    mutationFn: miscApi.readAll,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = query.data?.unread ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg border border-line bg-white p-2 text-ink-muted transition-colors hover:text-ink"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[320px] overflow-hidden rounded-xl border border-line bg-white shadow-lift animate-fade-up">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Notifications</p>
            <button
              className="flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline disabled:opacity-50"
              disabled={!unread || readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              <Check className="h-3 w-3" /> Mark all read
            </button>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {query.isLoading ? <p className="px-4 py-6 text-sm text-ink-muted">Loading…</p> : null}
            {query.data?.items.length === 0 ? <p className="px-4 py-6 text-sm text-ink-muted">No notifications.</p> : null}
            {query.data?.items.map((item) => (
              <div key={item.id} className={cn("border-b border-line/70 px-4 py-3 last:border-0", !item.is_read && "bg-brand-50/40")}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium text-ink">{item.title}</p>
                  {!item.is_read ? <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" /> : null}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{item.body}</p>
                <p className="mt-1 text-[10px] text-ink-faint">{formatDateTime(item.created_at)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { project } = useProject();
  const ai = useAiStatus();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
        <button onClick={onMenu} className="rounded-lg border border-line bg-white p-2 text-ink-muted lg:hidden" aria-label="Open navigation">
          <Menu className="h-4 w-4" />
        </button>
        <ProjectSwitcher />
        {project?.delay_flag ? (
          <Badge tone="warn" className="hidden sm:inline-flex">
            Delay flagged
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            {ai.data ? (
              <Badge tone={ai.data.mode === "groq" ? "brand" : ai.data.mode === "disabled" ? "neutral" : "warn"} dot>
                {ai.data.mode === "groq" ? `AI live · ${ai.data.model}` : ai.data.mode === "disabled" ? "AI disabled" : "AI review mode · rules"}
              </Badge>
            ) : null}
          </div>
          <Notifications />
        </div>
      </div>
    </header>
  );
}
