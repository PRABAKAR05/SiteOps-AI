import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Plus, Search, Sparkles } from "lucide-react";
import { aiApi, errorMessage, issuesApi, projectsApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge, MethodBadge, PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate, titleCase } from "@/lib/format";
import type { Issue } from "@/lib/types";

const categories = ["electrical", "cctv", "fire_safety", "av", "acoustic", "networking", "bms", "civil", "material_shortage", "equipment_failure", "other"];
const priorities = ["low", "medium", "high", "critical"];
const severities = ["minor", "moderate", "major", "safety"];

const emptyForm = {
  title: "",
  description: "",
  location: "",
  category: "other",
  priority: "medium",
  severity: "moderate",
  due_date: "",
};

export default function Issues() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [suggestion, setSuggestion] = useState<any>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const issues = useQuery({
    queryKey: ["issues", projectId, status, priority, search],
    queryFn: async () =>
      (
        await issuesApi.list(projectId as string, {
          status: status === "all" ? undefined : status,
          priority: priority || undefined,
          q: search || undefined,
          page_size: 100,
        })
      ).data,
    enabled: Boolean(projectId),
  });

  const detail = useQuery({
    queryKey: ["issue", projectId, selectedId],
    queryFn: async () => (await issuesApi.get(projectId as string, selectedId as string)).data,
    enabled: Boolean(projectId && selectedId),
  });

  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: async () => (await projectsApi.members(projectId as string)).data.items,
    enabled: Boolean(projectId),
  });

  const analytics = useQuery({
    queryKey: ["issue-analytics", projectId],
    queryFn: async () => (await issuesApi.analytics(projectId as string)).data,
    enabled: Boolean(projectId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["issues"] });
    queryClient.invalidateQueries({ queryKey: ["issue"] });
    queryClient.invalidateQueries({ queryKey: ["issue-analytics"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const classify = useMutation({
    mutationFn: () =>
      aiApi.classifyIssue({
        project_id: projectId as string,
        title: form.title,
        description: form.description,
      }),
    onSuccess: (response) => {
      setSuggestion(response.data);
      setForm((current) => ({
        ...current,
        category: response.data.category ?? current.category,
        priority: response.data.priority ?? current.priority,
        severity: response.data.severity ?? current.severity,
      }));
    },
    onError: (error) => toast.push({ title: "AI classification unavailable", description: errorMessage(error), tone: "error" }),
  });

  const create = useMutation({
    mutationFn: () =>
      issuesApi.create({
        project_id: projectId,
        title: form.title.trim(),
        description: form.description.trim(),
        location: form.location.trim() || null,
        category: form.category,
        priority: form.priority,
        severity: form.severity,
        due_date: form.due_date || null,
        ai_suggestion: suggestion
          ? { category: suggestion.category, priority: suggestion.priority, severity: suggestion.severity, method: suggestion.method }
          : null,
      }),
    onSuccess: () => {
      toast.push({ title: "Issue logged", tone: "success" });
      setCreateOpen(false);
      setForm(emptyForm);
      setSuggestion(null);
      refresh();
    },
    onError: (error) => toast.push({ title: "Could not log issue", description: errorMessage(error), tone: "error" }),
  });

  const assign = useMutation({
    mutationFn: ({ issueId, userId }: { issueId: string; userId: string }) =>
      issuesApi.assign(projectId as string, issueId, userId),
    onSuccess: () => {
      toast.push({ title: "Issue assigned", tone: "success" });
      refresh();
    },
    onError: (error) => toast.push({ title: "Assignment failed", description: errorMessage(error), tone: "error" }),
  });

  const setIssueStatus = useMutation({
    mutationFn: ({ issueId, value }: { issueId: string; value: string }) =>
      issuesApi.setStatus(projectId as string, issueId, value),
    onSuccess: () => {
      toast.push({ title: "Status updated", tone: "success" });
      refresh();
    },
    onError: (error) => toast.push({ title: "Status change rejected", description: errorMessage(error), tone: "error" }),
  });

  const resolve = useMutation({
    mutationFn: ({ issueId, notes }: { issueId: string; notes: string }) =>
      issuesApi.resolve(projectId as string, issueId, notes),
    onSuccess: () => {
      toast.push({ title: "Issue resolved", tone: "success" });
      refresh();
    },
    onError: (error) => toast.push({ title: "Could not resolve", description: errorMessage(error), tone: "error" }),
  });

  const items = issues.data?.items ?? [];
  const selected: Issue | undefined = detail.data ?? items.find((item) => item.id === selectedId);

  const counts = useMemo(() => {
    const data = analytics.data as any;
    return {
      open: data?.open ?? 0,
      critical: data?.critical ?? 0,
      resolved: data?.by_status?.resolved ?? 0,
    };
  }, [analytics.data]);

  if (!projectId) return <EmptyProject />;

  const canAct = user?.role !== "storekeeper";

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Field operations"
        title="Issues"
        description="Defects, blockers and safety observations. AI can suggest a category, but only people close, resolve or reassign."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Log issue
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Open</p>
          <p className="mono-num mt-1 text-xl font-semibold">{counts.open}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Critical</p>
          <p className="mono-num mt-1 text-xl font-semibold text-danger">{counts.critical}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Resolved</p>
          <p className="mono-num mt-1 text-xl font-semibold text-ok">{counts.resolved}</p>
        </div>
      </div>

      <Card>
        <div className="px-4 pt-1">
          <Tabs
            value={status}
            onChange={setStatus}
            items={[
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "assigned", label: "Assigned" },
              { value: "in_progress", label: "In progress" },
              { value: "waiting", label: "Waiting" },
              { value: "resolved", label: "Resolved" },
              { value: "closed", label: "Closed" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title or description"
              className="pl-8"
              aria-label="Search issues"
            />
          </div>
          <Select value={priority} onChange={(event) => setPriority(event.target.value)} className="max-w-[170px]" aria-label="Filter by priority">
            <option value="">Any priority</option>
            {priorities.map((item) => (
              <option key={item} value={item}>{titleCase(item)}</option>
            ))}
          </Select>
        </div>

        {issues.isLoading ? (
          <SkeletonTable rows={6} />
        ) : issues.isError ? (
          <ErrorState message={errorMessage(issues.error)} onRetry={() => issues.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No issues in this view"
            description="Log a defect or safety observation to start tracking it."
            icon={<AlertTriangle className="h-5 w-5" />}
            action={
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Log issue
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[840px]">
              <thead className="bg-paper/50">
                <tr>
                  <th className="th">Issue</th>
                  <th className="th">Category</th>
                  <th className="th">Priority</th>
                  <th className="th">Status</th>
                  <th className="th">Assignee</th>
                  <th className="th">Logged</th>
                  <th className="th text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {items.map((issue) => (
                  <tr key={issue.id} className="cursor-pointer hover:bg-paper/40" onClick={() => setSelectedId(issue.id)}>
                    <td className="td max-w-[300px]">
                      <p className="truncate font-medium">{issue.title}</p>
                      <p className="truncate text-[11px] text-ink-faint">{issue.location || "Location not set"}</p>
                    </td>
                    <td className="td text-ink-muted">{titleCase(issue.category)}</td>
                    <td className="td"><PriorityBadge priority={issue.priority} /></td>
                    <td className="td"><StatusBadge status={issue.status} /></td>
                    <td className="td text-ink-muted">{issue.assigned_to_name || "Unassigned"}</td>
                    <td className="td whitespace-nowrap text-xs text-ink-muted">{formatDate(issue.created_at)}</td>
                    <td className="td text-right">
                      <span className="text-xs font-medium text-brand-700">View</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setSuggestion(null);
        }}
        title="Log an issue"
        description="AI can suggest category, priority and severity. You stay responsible for the final values."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              loading={create.isPending}
              disabled={form.title.trim().length < 3 || form.description.trim().length < 5}
              onClick={() => create.mutate()}
            >
              Save issue
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="issue-title" className="sm:col-span-2">
            <Input
              id="issue-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="e.g. Smoke detector loop fault in zone B"
            />
          </Field>
          <Field label="Description" htmlFor="issue-description" className="sm:col-span-2" hint="What happened, where, and what you observed.">
            <Textarea
              id="issue-description"
              rows={4}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Panel shows a loop fault after the last termination…"
            />
          </Field>
          <Field label="Location" htmlFor="issue-location">
            <Input
              id="issue-location"
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
              placeholder="Zone / room / floor"
            />
          </Field>
          <Field label="Due date" htmlFor="issue-due">
            <Input
              id="issue-due"
              type="date"
              value={form.due_date}
              onChange={(event) => setForm({ ...form, due_date: event.target.value })}
            />
          </Field>
          <Field label="Category" htmlFor="issue-category">
            <Select id="issue-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {categories.map((category) => (
                <option key={category} value={category}>{titleCase(category)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="issue-priority">
            <Select id="issue-priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              {priorities.map((priority) => (
                <option key={priority} value={priority}>{titleCase(priority)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Severity" htmlFor="issue-severity">
            <Select id="issue-severity" value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>
              {severities.map((severity) => (
                <option key={severity} value={severity}>{titleCase(severity)}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={classify.isPending}
              disabled={form.title.trim().length < 3 || form.description.trim().length < 5}
              onClick={() => classify.mutate()}
            >
              <Sparkles className="h-4 w-4" /> Suggest with AI
            </Button>
          </div>
          {suggestion ? (
            <div className="rounded-lg border border-line bg-paper/60 px-3 py-2 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <MethodBadge method={suggestion.method} />
                <span className="text-xs text-ink-muted">
                  {titleCase(suggestion.category)} · {titleCase(suggestion.priority)} · {titleCase(suggestion.severity)}
                </span>
              </div>
              {suggestion.rationale ? <p className="mt-1 text-xs text-ink-muted">{suggestion.rationale}</p> : null}
              <p className="mt-1 text-[10px] text-ink-faint">Accepted suggestions are stored with the issue for audit.</p>
            </div>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={selected?.title ?? "Issue"}
        description={selected ? `${titleCase(selected.category)} · reported by ${selected.reported_by_name ?? "—"}` : undefined}
        size="lg"
      >
        {detail.isLoading && !selected ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selected.status} />
              <PriorityBadge priority={selected.priority} />
              <Badge tone="neutral">{titleCase(selected.severity)}</Badge>
              {selected.location ? <Badge tone="neutral">{selected.location}</Badge> : null}
            </div>
            <p className="text-sm leading-relaxed text-ink">{selected.description}</p>
            {selected.resolution_notes ? (
              <div className="rounded-lg border border-[#C6E8D5] bg-[#F3FBF7] px-3 py-2 text-xs text-ok">
                <p className="font-semibold">Resolution</p>
                <p className="mt-0.5">{selected.resolution_notes}</p>
              </div>
            ) : null}

            {canAct ? (
              <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <Field label="Assign to" htmlFor="issue-assign">
                  <div className="flex gap-2">
                    <Select id="issue-assign" defaultValue={selected.assigned_to ?? ""}>
                      <option value="">Choose member…</option>
                      {(members.data ?? []).map((member) => (
                        <option key={member.user_id} value={member.user_id}>{member.name}</option>
                      ))}
                    </Select>
                    <Button
                      size="md"
                      variant="outline"
                      onClick={() => {
                        const select = document.getElementById("issue-assign") as HTMLSelectElement | null;
                        if (select?.value) assign.mutate({ issueId: selected.id, userId: select.value });
                      }}
                    >
                      Assign
                    </Button>
                  </div>
                </Field>
                <Field label="Change status" htmlFor="issue-status">
                  <div className="flex gap-2">
                    <Select id="issue-status" defaultValue={selected.status}>
                      {["open", "assigned", "in_progress", "waiting", "resolved", "closed"].map((value) => (
                        <option key={value} value={value}>{titleCase(value)}</option>
                      ))}
                    </Select>
                    <Button
                      size="md"
                      variant="outline"
                      onClick={() => {
                        const select = document.getElementById("issue-status") as HTMLSelectElement | null;
                        if (select?.value) setIssueStatus.mutate({ issueId: selected.id, value: select.value });
                      }}
                    >
                      Update
                    </Button>
                  </div>
                </Field>
                {selected.status !== "closed" ? (
                  <Field label="Resolve with notes" htmlFor="issue-resolution" className="sm:col-span-2" hint="Resolution requires a short description.">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Textarea id="issue-resolution" rows={2} placeholder="What was done to fix it?" />
                      <Button
                        variant="secondary"
                        className="sm:self-end"
                        onClick={() => {
                          const field = document.getElementById("issue-resolution") as HTMLTextAreaElement | null;
                          if (field?.value.trim()) resolve.mutate({ issueId: selected.id, notes: field.value.trim() });
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Resolve
                      </Button>
                    </div>
                  </Field>
                ) : null}
              </div>
            ) : (
              <p className="border-t border-line pt-3 text-xs text-ink-faint">Storekeepers can view issues but cannot change their status.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Issue not found.</p>
        )}
      </Dialog>
    </div>
  );
}
