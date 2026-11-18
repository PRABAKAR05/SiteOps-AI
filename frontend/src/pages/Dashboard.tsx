import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Boxes, CalendarClock, ClipboardList, ListTodo, Plus, Sparkles, TrendingUp,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { analyticsApi, inventoryApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { EmptyProject } from "@/components/EmptyProject";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { formatDate, relativeDays, titleCase } from "@/lib/format";
import { cn } from "@/lib/cn";

const PIE_COLORS = ["#0F766E", "#4B9F8E", "#B45309", "#B42318", "#8A918B", "#1D4E89"];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user } = useAuth();
  const { project, projectId } = useProject();

  const dashboard = useQuery({
    queryKey: ["dashboard", projectId],
    queryFn: async () => (await analyticsApi.dashboard({ project_id: projectId ?? undefined })).data,
    enabled: Boolean(projectId),
  });

  const risk = useQuery({
    queryKey: ["risk", projectId],
    queryFn: async () => (await analyticsApi.risk(projectId as string)).data,
    enabled: Boolean(projectId),
  });

  const alerts = useQuery({
    queryKey: ["alerts", projectId],
    queryFn: async () => (await inventoryApi.alerts(projectId as string)).data.items,
    enabled: Boolean(projectId),
  });

  if (!projectId) return <EmptyProject />;

  if (dashboard.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (dashboard.isError) {
    return <ErrorState message="The dashboard could not be loaded." onRetry={() => dashboard.refetch()} />;
  }

  const kpis = (dashboard.data?.kpis ?? {}) as Record<string, number>;
  const charts = dashboard.data?.charts ?? {};
  const progress: Array<Record<string, any>> = charts.progress ?? [];
  const issueStatus: Array<{ status: string; count: number }> = charts.issue_status ?? [];
  const usage: Array<{ material: string; consumed: string; unit: string }> = charts.inventory_usage ?? [];
  const recent: Array<Record<string, any>> = dashboard.data?.recent_reports ?? [];
  const deadlines: Array<Record<string, any>> = dashboard.data?.upcoming_deadlines ?? [];
  const range = dashboard.data?.range as { from: string; to: string } | undefined;

  const riskData = risk.data as
    | {
        score: number;
        band: string;
        factors: Array<{ name: string; weight: number; value: number; evidence: string }>;
        disclaimer: string;
      }
    | undefined;

  const bandTone = riskData?.band === "critical" ? "danger" : riskData?.band === "high" ? "danger" : riskData?.band === "medium" ? "warn" : "ok";

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Overview"
        title={`${greeting()}, ${user?.name.split(" ")[0] ?? "there"}`}
        description={
          <>
            {project?.name} · <span className="font-mono text-xs">{project?.code}</span>
            {range ? <span className="text-ink-faint"> · {formatDate(range.from)} – {formatDate(range.to)}</span> : null}
          </>
        }
        actions={
          <>
            <Link to="/reports/new">
              <Button size="sm">
                <Plus className="h-4 w-4" /> New report
              </Button>
            </Link>
            <Link to="/assistant">
              <Button size="sm" variant="outline">
                <Sparkles className="h-4 w-4" /> Ask SiteOps
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Open issues"
          value={kpis.issues_open ?? 0}
          hint={`${kpis.issues_critical ?? 0} critical · ${kpis.projects_delayed ?? 0} delayed project`}
          icon={AlertTriangle}
          tone={(kpis.issues_critical ?? 0) > 0 ? "danger" : "neutral"}
          to="/issues"
        />
        <StatCard
          label="Low stock"
          value={kpis.materials_low_stock ?? 0}
          hint={`of ${kpis.materials_total ?? 0} tracked materials`}
          icon={Boxes}
          tone={(kpis.materials_low_stock ?? 0) > 0 ? "warn" : "neutral"}
          to="/inventory"
        />
        <StatCard
          label="Awaiting approval"
          value={kpis.reports_pending_approval ?? 0}
          hint="Daily reports submitted"
          icon={ClipboardList}
          tone={(kpis.reports_pending_approval ?? 0) > 0 ? "brand" : "neutral"}
          to="/reports"
        />
        <StatCard
          label="Overdue tasks"
          value={kpis.tasks_overdue ?? 0}
          hint="Past due date, still open"
          icon={ListTodo}
          tone={(kpis.tasks_overdue ?? 0) > 0 ? "danger" : "neutral"}
          to="/tasks"
        />
        <StatCard
          label="Plan progress"
          value={`${project?.progress_percent ?? 0}%`}
          hint={project?.delay_flag ? project?.delay_reason ?? "Delay flagged" : "Weighted task completion"}
          icon={TrendingUp}
          tone="ok"
          to="/analytics"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Site activity"
              description="Workers on site and completed items from approved or submitted reports"
              action={
                <Link to="/reports" className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  All reports <ArrowRight className="h-3 w-3" />
                </Link>
              }
            />
            <CardBody>
              {progress.length === 0 ? (
                <EmptyState title="No reports in this period" description="Activity appears once daily reports are submitted." />
              ) : (
                <div className="h-[236px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={progress} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="workers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0F766E" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#0F766E" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="items" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#B45309" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#B45309" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE1" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        tick={{ fontSize: 11, fill: "#8A918B" }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={20}
                      />
                      <YAxis tick={{ fontSize: 11, fill: "#8A918B" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: 10, border: "1px solid #E3E0D6", fontSize: 12, boxShadow: "0 12px 30px -20px rgba(0,0,0,.4)" }}
                        labelFormatter={(value) => formatDate(String(value))}
                      />
                      <Area type="monotone" dataKey="workers" name="Workers" stroke="#0F766E" strokeWidth={2} fill="url(#workers)" />
                      <Area type="monotone" dataKey="completed_items" name="Completed items" stroke="#B45309" strokeWidth={1.7} fill="url(#items)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="Issue status" description={`${kpis.issues_open ?? 0} open in this project`} />
              <CardBody>
                {issueStatus.length === 0 ? (
                  <EmptyState title="No issues" description="Nothing logged for this project yet." />
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="h-[150px] flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={issueStatus} dataKey="count" nameKey="status" innerRadius={38} outerRadius={62} paddingAngle={2} strokeWidth={0}>
                            {issueStatus.map((entry, index) => (
                              <Cell key={entry.status} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #E3E0D6", fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="w-[130px] space-y-1.5">
                      {issueStatus.map((entry, index) => (
                        <li key={entry.status} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
                            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                            <span className="truncate">{titleCase(entry.status)}</span>
                          </span>
                          <span className="mono-num font-medium">{entry.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Material consumption" description="Largest usage in this period" />
              <CardBody>
                {usage.length === 0 ? (
                  <EmptyState title="No consumption recorded" description="Stock movements will show here." />
                ) : (
                  <div className="h-[150px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={usage} layout="vertical" margin={{ top: 0, right: 10, left: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE1" horizontal={false} />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="material" width={92} tick={{ fontSize: 10, fill: "#5B635D" }} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: 10, border: "1px solid #E3E0D6", fontSize: 12 }}
                          formatter={(value: number | string, _name, entry) => {
                            const unit = (entry?.payload as { unit?: string } | undefined)?.unit ?? "";
                            return [`${value} ${unit}`, "Consumed"];
                          }}
                        />
                        <Bar dataKey="consumed" fill="#4B9F8E" radius={[0, 4, 4, 0]} barSize={11} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card className={cn("overflow-hidden", bandTone === "danger" && "border-[#F6CFC9]")}>
            <CardHeader
              title="Delay risk"
              description="Weighted rule score · not a statistical forecast"
              action={<Badge tone={bandTone}>{titleCase(riskData?.band ?? "—")}</Badge>}
            />
            <CardBody>
              {risk.isLoading ? (
                <Skeleton className="h-24" />
              ) : riskData ? (
                <>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="mono-num text-[34px] font-semibold leading-none">{riskData.score}</p>
                      <p className="mt-1 text-[11px] text-ink-faint">out of 100 risk points</p>
                    </div>
                    <Link to="/analytics" className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                      Details <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="mt-3 space-y-2">
                    {riskData.factors.slice(0, 4).map((factor) => (
                      <div key={factor.name}>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="text-ink-muted">{titleCase(factor.name)}</span>
                          <span className="mono-num text-ink-faint">{Math.round(factor.value * factor.weight)}/{factor.weight}</span>
                        </div>
                        <Progress value={factor.value * 100} tone={factor.value > 0.6 ? "danger" : factor.value > 0.3 ? "warn" : "brand"} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">{riskData.disclaimer}</p>
                </>
              ) : (
                <p className="text-sm text-ink-muted">Risk is unavailable.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Low stock"
              description={(alerts.data?.length ?? 0) ? "At or below reorder level" : "All materials above reorder level"}
              action={
                <Link to="/inventory" className="text-xs font-medium text-brand-700 hover:underline">
                  Inventory
                </Link>
              }
            />
            <CardBody className="space-y-2.5">
              {alerts.isLoading ? <Skeleton className="h-16" /> : null}
              {(alerts.data ?? []).slice(0, 4).map((item) => (
                <div key={String(item.id ?? item.material_id ?? item.name)} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{item.name}</p>
                    <p className="text-[11px] text-ink-faint">
                      {item.current_stock} {item.unit} · reorder at {item.reorder_level}
                    </p>
                  </div>
                  <Badge tone="warn">{item.severity ? titleCase(item.severity) : "Low"}</Badge>
                </div>
              ))}
              {!alerts.isLoading && !(alerts.data ?? []).length ? (
                <p className="text-sm text-ink-muted">Nothing needs replenishing.</p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Upcoming deadlines" description="Next 10 days" action={<CalendarClock className="h-4 w-4 text-ink-faint" />} />
            <CardBody className="space-y-3">
              {deadlines.length === 0 ? (
                <p className="text-sm text-ink-muted">No tasks due in the next 10 days.</p>
              ) : (
                deadlines.map((task) => (
                  <Link key={task.id} to="/tasks" className="block group">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-medium leading-snug group-hover:text-brand-800">{task.title}</p>
                      <span className="whitespace-nowrap text-[11px] text-ink-faint">{relativeDays(task.due_date)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={task.progress ?? 0} className="flex-1" />
                      <span className="mono-num text-[10px] text-ink-faint">{task.progress ?? 0}%</span>
                    </div>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent reports"
          description="Latest site reports across your project"
          action={
            <Link to="/reports" className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            title="No reports submitted"
            description="Start with a daily report; AI can structure your site notes but never files it for you."
            action={
              <Link to="/reports/new">
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Create report
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[560px]">
              <thead className="bg-paper/50">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Submitted by</th>
                  <th className="th">Workers</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((report) => (
                  <tr key={report.id} className="hover:bg-paper/40">
                    <td className="td font-medium">{formatDate(report.report_date)}</td>
                    <td className="td text-ink-muted">{report.submitted_by_name}</td>
                    <td className="td mono-num">{report.workers ?? "—"}</td>
                    <td className="td">
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="td text-right">
                      <Link to={`/reports/${report.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
