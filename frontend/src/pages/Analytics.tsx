import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { aiApi, analyticsApi, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Badge, MethodBadge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate, isoDaysFromNow, isoFirstOfMonth, isoToday, titleCase } from "@/lib/format";

const PIE_COLORS = ["#0F766E", "#4B9F8E", "#B45309", "#B42318", "#8A918B", "#1D4E89"];

export default function Analytics() {
  const { projectId, project } = useProject();
  const { user } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(isoFirstOfMonth());
  const [to, setTo] = useState(isoToday());
  const [range, setRange] = useState({ from: isoFirstOfMonth(), to: isoToday() });
  const [summary, setSummary] = useState<{ summary: string; source: string; model?: string | null } | null>(null);
  const [riskNarrative, setRiskNarrative] = useState<{ narrative: string[]; mitigations: string[]; source: string } | null>(null);

  const period = useQuery({
    queryKey: ["period", projectId, range],
    queryFn: async () => (await analyticsApi.period(projectId as string, range)).data,
    enabled: Boolean(projectId),
  });

  const progress = useQuery({
    queryKey: ["progress", projectId, range],
    queryFn: async () => (await analyticsApi.progress(projectId as string, range)).data,
    enabled: Boolean(projectId),
  });

  const risk = useQuery({
    queryKey: ["risk", projectId],
    queryFn: async () => (await analyticsApi.risk(projectId as string)).data,
    enabled: Boolean(projectId),
  });

  const explainRisk = useMutation({
    mutationFn: () => aiApi.explainRisk(projectId as string),
    onSuccess: (response) =>
      setRiskNarrative({
        narrative: response.data.narrative ?? [],
        mitigations: response.data.mitigations ?? [],
        source: response.data.narrative_source ?? "template",
      }),
    onError: (error) => toast.push({ title: "Could not explain risk", description: errorMessage(error), tone: "error" }),
  });

  const summarize = useMutation({
    mutationFn: () => aiApi.periodSummary({ project_id: projectId as string, date_from: range.from, date_to: range.to }),
    onSuccess: (response) => setSummary(response.data as { summary: string; source: string; model?: string | null }),
    onError: (error) => toast.push({ title: "Could not generate summary", description: errorMessage(error), tone: "error" }),
  });

  const series: Array<Record<string, any>> = progress.data?.series ?? [];
  const reports = period.data?.reports ?? {};
  const tasks = period.data?.tasks ?? {};
  const issues = period.data?.issues ?? {};
  const inventory = period.data?.inventory ?? {};
  const byTaskStatus: Array<{ status: string; count: number }> = tasks.by_status ?? [];
  const byIssueCategory: Array<{ category: string; count: number }> = issues.by_category ?? [];

  const totalIssueCount = useMemo(
    () => byIssueCategory.reduce((sum, row) => sum + row.count, 0),
    [byIssueCategory],
  );

  if (!projectId) return <EmptyProject />;

  const applyRange = () => {
    if (from > to) {
      toast.push({ title: "Invalid date range", description: "The start date must be before the end date.", tone: "error" });
      return;
    }
    setRange({ from, to });
    setSummary(null);
  };

  const quickRange = (days: number) => {
    const end = isoToday();
    const start = isoDaysFromNow(-days);
    setFrom(start);
    setTo(end);
    setRange({ from: start, to: end });
    setSummary(null);
  };

  const isManager = user?.role === "project_manager";

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Insights"
        title="Analytics & reports"
        description="Every metric is computed from project records. AI may summarise them, but the numbers come from the database."
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!isManager}
            title={isManager ? "Export a period PDF with optional AI summary" : "Only a project manager can export period reports."}
            onClick={() =>
              analyticsApi
                .periodPdf(projectId, range.from, range.to)
                .catch((error) => toast.push({ title: "Export failed", description: errorMessage(error), tone: "error" }))
            }
          >
            <Download className="h-4 w-4" /> Export PDF
          </Button>
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="From" htmlFor="analytics-from">
            <Input id="analytics-from" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="To" htmlFor="analytics-to">
            <Input id="analytics-to" type="date" value={to} min={from} max={isoToday()} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Button size="md" onClick={applyRange}>
            Apply
          </Button>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            <Button size="sm" variant="ghost" onClick={() => quickRange(30)}>Last 30 days</Button>
            <Button size="sm" variant="ghost" onClick={() => quickRange(90)}>Last 90 days</Button>
          </div>
          <span className="ml-auto pb-2 text-[11px] text-ink-faint">
            Showing {formatDate(range.from)} – {formatDate(range.to)}
          </span>
        </CardBody>
      </Card>

      {period.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : period.isError ? (
        <ErrorState message={errorMessage(period.error)} onRetry={() => period.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Reports", value: reports.reports ?? 0, hint: `${reports.pending ?? 0} awaiting approval` },
              { label: "Worker-days", value: reports.worker_days ?? 0, hint: `avg ${reports.avg_workers ?? 0} per report` },
              { label: "Delays reported", value: reports.delays_reported ?? 0, hint: "Reports mentioning delays" },
              { label: "Plan progress", value: `${project?.progress_percent ?? 0}%`, hint: `${tasks.completed ?? 0}/${tasks.total ?? 0} tasks complete` },
              { label: "Open issues", value: issues.open ?? 0, hint: `${issues.critical ?? 0} critical` },
              { label: "Overdue tasks", value: tasks.overdue ?? 0, hint: "Past due, still open" },
              { label: "Low stock", value: inventory.low_stock?.length ?? 0, hint: "Materials at/below reorder" },
              { label: "Ledger entries", value: inventory.transactions ?? 0, hint: "All-time movements" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-line bg-surface px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{stat.label}</p>
                <p className="mono-num mt-1 text-xl font-semibold">{stat.value}</p>
                <p className="mt-0.5 text-[10px] text-ink-faint">{stat.hint}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-4">
              <Card>
                <CardHeader title="Workforce and output" description="Daily workers on site versus completed and pending items" />
                <CardBody>
                  {series.length === 0 ? (
                    <EmptyState title="No reports in this range" description="Submit a daily report or widen the date range." />
                  ) : (
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={series} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE1" vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                            tick={{ fontSize: 11, fill: "#8A918B" }}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={18}
                          />
                          <YAxis tick={{ fontSize: 11, fill: "#8A918B" }} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip
                            contentStyle={{ borderRadius: 10, border: "1px solid #E3E0D6", fontSize: 12 }}
                            labelFormatter={(value) => formatDate(String(value))}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="completed" name="Completed" stackId="work" fill="#0F766E" radius={[0, 0, 0, 0]} barSize={16} />
                          <Bar dataKey="pending" name="Pending" stackId="work" fill="#D9A45B" radius={[3, 3, 0, 0]} barSize={16} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-[11px] text-ink-muted">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-brand-700" /> Completed items</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#D9A45B]" /> Pending items</span>
                    <span className="ml-auto">Worker line: {series.reduce((sum, row) => sum + (row.workers ?? 0), 0)} total</span>
                  </div>
                </CardBody>
              </Card>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <CardHeader title="Issues by category" description={`${totalIssueCount} issues all-time in this project`} />
                  <CardBody>
                    {byIssueCategory.length === 0 ? (
                      <EmptyState title="No issues" description="Nothing has been logged yet." />
                    ) : (
                      <div className="h-[190px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={byIssueCategory.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE1" horizontal={false} />
                            <XAxis type="number" hide allowDecimals={false} />
                            <YAxis type="category" dataKey="category" width={86} tick={{ fontSize: 10, fill: "#5B635D" }} tickLine={false} axisLine={false} tickFormatter={(value: string) => titleCase(value)} />
                            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #E3E0D6", fontSize: 12 }} />
                            <Bar dataKey="count" name="Issues" fill="#B45309" radius={[0, 4, 4, 0]} barSize={10} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Task status" description="Current plan distribution" />
                  <CardBody>
                    {byTaskStatus.length === 0 ? (
                      <EmptyState title="No tasks" description="Add plan items to see distribution." />
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-[160px] flex-1">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={byTaskStatus} dataKey="count" nameKey="status" innerRadius={40} outerRadius={64} paddingAngle={2} strokeWidth={0}>
                                {byTaskStatus.map((entry, index) => (
                                  <Cell key={entry.status} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #E3E0D6", fontSize: 12 }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <ul className="w-[120px] space-y-1.5">
                          {byTaskStatus.map((entry, index) => (
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
              </div>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Delay risk breakdown"
                  description="Rule-weighted score out of 100"
                  action={<Badge tone={risk.data?.band === "low" ? "ok" : risk.data?.band === "critical" ? "danger" : "warn"}>{titleCase(risk.data?.band ?? "—")}</Badge>}
                />
                <CardBody className="space-y-3">
                  <div className="flex items-end gap-3">
                    <p className="mono-num text-4xl font-semibold leading-none">{risk.data?.score ?? "—"}</p>
                    <p className="pb-1 text-[11px] text-ink-faint">of 100 risk points</p>
                  </div>
                  {(risk.data?.factors ?? []).map((factor: { name: string; weight: number; value: number; evidence: string }) => (
                    <div key={factor.name}>
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="text-ink-muted">{titleCase(factor.name)}</span>
                        <span className="mono-num text-ink-faint">{Math.round(factor.value * factor.weight)}/{factor.weight}</span>
                      </div>
                      <Progress value={factor.value * 100} tone={factor.value > 0.6 ? "danger" : factor.value > 0.3 ? "warn" : "brand"} />
                      <p className="mt-0.5 text-[10px] text-ink-faint">{factor.evidence}</p>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="w-full" loading={explainRisk.isPending} onClick={() => explainRisk.mutate()}>
                    <Sparkles className="h-3.5 w-3.5" /> Explain risk with AI
                  </Button>
                  {risk.data?.disclaimer ? <p className="text-[10px] leading-relaxed text-ink-faint">{risk.data.disclaimer}</p> : null}
                  {riskNarrative ? (
                    <div className="rounded-lg border border-line bg-paper/60 p-3">
                      <MethodBadge method={riskNarrative.source} />
                      <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-muted">
                        {riskNarrative.narrative.map((line, index) => <li key={index}>{line}</li>)}
                      </ul>
                      {riskNarrative.mitigations.length ? (
                        <>
                          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Suggested actions</p>
                          <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-ink-muted">
                            {riskNarrative.mitigations.map((line, index) => <li key={index}>• {line}</li>)}
                          </ul>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Period summary"
                  description="AI narrative over the computed stats"
                  action={
                    <Button size="sm" variant="outline" loading={summarize.isPending} onClick={() => summarize.mutate()}>
                      <Sparkles className="h-3.5 w-3.5" /> Generate
                    </Button>
                  }
                />
                <CardBody>
                  {summary ? (
                    <div className="space-y-2">
                      <MethodBadge method={summary.source} />
                      <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">{summary.summary}</p>
                      <p className="text-[10px] text-ink-faint">
                        Generated from report, task, issue and inventory aggregates for the selected period. Statistics above remain authoritative.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed text-ink-muted">
                      Generate a short narrative for the selected dates. The model receives only computed totals, never raw
                      records, and cannot change them.
                    </p>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Low stock" description={`${inventory.low_stock?.length ?? 0} material(s)`} action={<TrendingUp className="h-4 w-4 text-ink-faint" />} />
                <CardBody className="space-y-2">
                  {!(inventory.low_stock ?? []).length ? (
                    <p className="text-sm text-ink-muted">All materials are above reorder level.</p>
                  ) : (
                    (inventory.low_stock ?? []).map((item: { id: string; name: string; current_stock: string; reorder_level: string; unit: string }) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate text-ink-muted">{item.name}</span>
                        <span className="mono-num whitespace-nowrap text-warn">
                          {item.current_stock}/{item.reorder_level} {item.unit}
                        </span>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>

              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-ink-muted">Refresh all analytics</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={period.isFetching || progress.isFetching || risk.isFetching}
                    onClick={() => {
                      period.refetch();
                      progress.refetch();
                      risk.refetch();
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
