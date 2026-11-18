import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ListTodo, Plus, Search, TrendingUp } from "lucide-react";
import { errorMessage, projectsApi, tasksApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { Progress, Tabs } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate, isoDaysFromNow, isoToday, relativeDays, titleCase } from "@/lib/format";
import type { Task } from "@/lib/types";

const categories = [
  "electrical", "cctv", "fire_safety", "av", "acoustic", "networking", "bms", "civil",
  "material_shortage", "equipment_failure", "procurement", "commissioning", "other",
];
const statuses = ["not_started", "in_progress", "blocked", "completed", "cancelled"];

const emptyForm = {
  title: "",
  description: "",
  category: "other",
  assigned_to: "",
  start_date: isoToday(),
  due_date: isoDaysFromNow(7),
  weight: "1",
  status: "not_started",
  progress: "0",
};

export default function Tasks() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editProgress, setEditProgress] = useState("0");
  const [editStatus, setEditStatus] = useState("not_started");

  const tasks = useQuery({
    queryKey: ["tasks", projectId, status, search, overdueOnly],
    queryFn: async () =>
      (
        await tasksApi.list(projectId as string, {
          status: status === "all" ? undefined : status,
          q: search || undefined,
          overdue: overdueOnly || undefined,
          page_size: 100,
        })
      ).data,
    enabled: Boolean(projectId),
  });

  const analytics = useQuery({
    queryKey: ["task-analytics", projectId],
    queryFn: async () => (await tasksApi.analytics(projectId as string)).data,
    enabled: Boolean(projectId),
  });

  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: async () => (await projectsApi.members(projectId as string)).data.items,
    enabled: Boolean(projectId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["task-analytics"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["risk"] });
  };

  const create = useMutation({
    mutationFn: () =>
      tasksApi.create({
        project_id: projectId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        assigned_to: form.assigned_to || null,
        start_date: form.start_date,
        due_date: form.due_date,
        weight: Number(form.weight || 1),
        status: form.status,
        progress: Number(form.progress || 0),
      }),
    onSuccess: () => {
      toast.push({ title: "Task created", tone: "success" });
      setCreateOpen(false);
      setForm(emptyForm);
      refresh();
    },
    onError: (error) => toast.push({ title: "Could not create task", description: errorMessage(error), tone: "error" }),
  });

  const update = useMutation({
    mutationFn: () =>
      tasksApi.update(projectId as string, editing?.id as string, {
        progress: Number(editProgress),
        status: editStatus,
      }),
    onSuccess: () => {
      toast.push({ title: "Task updated", description: "Project progress recalculated from task weights.", tone: "success" });
      setEditing(null);
      refresh();
    },
    onError: (error) => toast.push({ title: "Could not update task", description: errorMessage(error), tone: "error" }),
  });

  const items = tasks.data?.items ?? [];
  const stats = analytics.data as
    | { total: number; completed: number; overdue: number; completion_percent: number; by_status: Array<{ status: string; count: number }> }
    | undefined;
  const blocked = useMemo(() => stats?.by_status.find((row) => row.status === "blocked")?.count ?? 0, [stats]);

  if (!projectId) return <EmptyProject />;

  const canCreate = user?.role !== "storekeeper";

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Field operations"
        title="Tasks & plan"
        description="Weighted plan progress. Blocked or overdue tasks feed the delay-risk score — the score explains itself, factor by factor."
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Tasks complete</p>
          <p className="mono-num mt-1 text-xl font-semibold">{stats?.completion_percent ?? 0}%</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Completed</p>
          <p className="mono-num mt-1 text-xl font-semibold text-ok">{stats?.completed ?? 0}<span className="text-sm text-ink-faint"> / {stats?.total ?? 0}</span></p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Overdue</p>
          <p className="mono-num mt-1 text-xl font-semibold text-danger">{stats?.overdue ?? 0}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Blocked</p>
          <p className="mono-num mt-1 text-xl font-semibold text-warn">{blocked}</p>
        </div>
      </div>

      <Card>
        <div className="px-4 pt-1">
          <Tabs
            value={status}
            onChange={setStatus}
            items={[
              { value: "all", label: "All" },
              { value: "not_started", label: "Not started" },
              { value: "in_progress", label: "In progress" },
              { value: "blocked", label: "Blocked" },
              { value: "completed", label: "Completed" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks"
              className="pl-8"
              aria-label="Search tasks"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5 text-xs font-medium text-ink-muted">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => setOverdueOnly(event.target.checked)}
              className="h-3.5 w-3.5 accent-brand-600"
            />
            Overdue only
          </label>
        </div>

        {tasks.isLoading ? (
          <SkeletonTable rows={7} />
        ) : tasks.isError ? (
          <ErrorState message={errorMessage(tasks.error)} onRetry={() => tasks.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No tasks in this view"
            description="Add plan items to track progress and delay risk."
            icon={<ListTodo className="h-5 w-5" />}
            action={
              canCreate ? (
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" /> New task
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[880px]">
              <thead className="bg-paper/50">
                <tr>
                  <th className="th">Task</th>
                  <th className="th">Category</th>
                  <th className="th">Assignee</th>
                  <th className="th">Due</th>
                  <th className="th w-[170px]">Progress</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Update</th>
                </tr>
              </thead>
              <tbody>
                {items.map((task) => (
                  <tr key={task.id} className="hover:bg-paper/40">
                    <td className="td max-w-[300px]">
                      <p className="truncate font-medium">{task.title}</p>
                      <p className="text-[11px] text-ink-faint">Weight {task.weight} · {formatDate(task.start_date)} start</p>
                    </td>
                    <td className="td text-ink-muted">{titleCase(task.category)}</td>
                    <td className="td text-ink-muted">{task.assigned_to_name || "Unassigned"}</td>
                    <td className="td whitespace-nowrap">
                      <p className="text-xs font-medium">{formatDate(task.due_date)}</p>
                      <p className="text-[10px] text-ink-faint">{relativeDays(task.due_date)}</p>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <Progress value={task.progress} className="w-24" tone={task.status === "blocked" ? "danger" : task.progress >= 100 ? "brand" : "warn"} />
                        <span className="mono-num text-[11px] text-ink-muted">{task.progress}%</span>
                      </div>
                    </td>
                    <td className="td"><StatusBadge status={task.status} /></td>
                    <td className="td text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(task);
                          setEditProgress(String(task.progress));
                          setEditStatus(task.status);
                        }}
                      >
                        Update
                      </Button>
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
        onClose={() => setCreateOpen(false)}
        title="New task"
        description="Weights feed the project progress roll-up; heavier tasks count more."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} disabled={form.title.trim().length < 3} onClick={() => create.mutate()}>
              Create task
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Task title" htmlFor="task-title" className="sm:col-span-2">
            <Input id="task-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Commission AV control system" />
          </Field>
          <Field label="Description" htmlFor="task-description" className="sm:col-span-2">
            <Textarea id="task-description" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Field label="Category" htmlFor="task-category">
            <Select id="task-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {categories.map((category) => (
                <option key={category} value={category}>{titleCase(category)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Assignee" htmlFor="task-assignee">
            <Select id="task-assignee" value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })}>
              <option value="">Unassigned</option>
              {(members.data ?? []).map((member) => (
                <option key={member.user_id} value={member.user_id}>{member.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="task-start">
            <Input id="task-start" type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
          </Field>
          <Field label="Due date" htmlFor="task-due">
            <Input id="task-due" type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
          </Field>
          <Field label="Weight (1–10)" htmlFor="task-weight" hint="Relative importance in the plan.">
            <Input id="task-weight" type="number" min={1} max={10} value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} />
          </Field>
          <Field label="Initial status" htmlFor="task-status">
            <Select id="task-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {statuses.map((value) => (
                <option key={value} value={value}>{titleCase(value)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Initial progress (%)" htmlFor="task-progress" className="sm:col-span-2">
            <Input id="task-progress" type="number" min={0} max={100} value={form.progress} onChange={(event) => setForm({ ...form, progress: event.target.value })} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Update task"
        description={editing?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={update.isPending} onClick={() => update.mutate()}>Save update</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={`Progress — ${editProgress}%`} htmlFor="edit-progress">
            <input
              id="edit-progress"
              type="range"
              min={0}
              max={100}
              step={5}
              value={editProgress}
              onChange={(event) => setEditProgress(event.target.value)}
              className="w-full accent-brand-600"
            />
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={editProgress}
                onChange={(event) => setEditProgress(event.target.value)}
                className="w-24"
                aria-label="Progress percent"
              />
              <span className="text-xs text-ink-muted">percent complete</span>
            </div>
          </Field>
          <Field label="Status" htmlFor="edit-status" hint="Setting 100% marks the task complete automatically.">
            <Select id="edit-status" value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
              {statuses.map((value) => (
                <option key={value} value={value}>{titleCase(value)}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-start gap-2 rounded-lg border border-line bg-paper/60 px-3 py-2 text-[11px] text-ink-muted">
            <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
            Saving recalculates weighted project progress and the delay-risk score.
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-faint">
            <CalendarClock className="h-3.5 w-3.5" /> Due {editing ? formatDate(editing.due_date) : "—"}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
