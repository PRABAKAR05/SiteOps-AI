import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Mic, Save, Send, Sparkles, Wand2 } from "lucide-react";
import { aiApi, errorMessage, reportsApi } from "@/lib/api";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { AiModeNote } from "@/components/AiModeBadge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { MethodBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { isoToday, titleCase } from "@/lib/format";

const schema = z.object({
  report_date: z.string().min(10, "Report date is required"),
  location: z.string().min(1, "Location is required"),
  activities: z.string().optional(),
  completed: z.string().optional(),
  pending: z.string().optional(),
  total: z.string().optional(),
  trades: z.string().optional(),
  equipment: z.string().optional(),
  delays: z.string().optional(),
  safety: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function lines(value?: string): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseTrades(value?: string): Array<{ trade: string; count: number }> {
  return lines(value)
    .map((line) => {
      const match = line.match(/^(.+?)[\s:\-–]+(\d+)$/);
      if (!match) return null;
      const count = Number(match[2]);
      if (!Number.isFinite(count)) return null;
      return { trade: match[1].trim(), count };
    })
    .filter((row): row is { trade: string; count: number } => Boolean(row));
}

function today() {
  return isoToday();
}

export default function ReportNew() {
  const { projectId, project } = useProject();
  const navigate = useNavigate();
  const toast = useToast();

  const [aiNotes, setAiNotes] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [appliedAi, setAppliedAi] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      report_date: today(),
      location: project?.location ?? "Site",
      activities: "",
    },
  });

  const total = watch("total");
  const trades = watch("trades");
  const tradeSum = parseTrades(trades).reduce((sum, row) => sum + row.count, 0);
  const sumMismatch = Boolean((trades ?? "").trim()) && Boolean(total) && Number(total) !== tradeSum;

  const generate = useMutation({
    mutationFn: () =>
      aiApi.generateReport({
        project_id: projectId as string,
        notes: aiNotes,
        report_date: watch("report_date"),
        location: watch("location"),
      }),
    onSuccess: (response) => {
      setAiResult(response.data);
      setAiError(null);
    },
    onError: (error) => {
      setAiError(errorMessage(error));
      setAiResult(null);
    },
  });

  const create = useMutation({
    mutationFn: ({ values, status }: { values: FormValues; status: "draft" | "submitted" }) => {
      const byTrade = parseTrades(values.trades);
      const explicitTotal = values.total ? Number(values.total) : null;
      const computedTotal = byTrade.length ? byTrade.reduce((sum, row) => sum + row.count, 0) : explicitTotal;
      return reportsApi.create({
        project_id: projectId,
        report_date: values.report_date,
        location: values.location,
        activities: values.activities ?? "",
        work_completed: lines(values.completed),
        work_pending: lines(values.pending),
        workers_present: { total: computedTotal ?? 0, by_trade: byTrade },
        equipment_used: lines(values.equipment),
        delays: values.delays?.trim() || null,
        safety_observations: values.safety?.trim() || null,
        notes: values.notes?.trim() || null,
        ai_assisted: appliedAi,
        ai_summary: appliedAi ? (aiResult?.proposal?.summary ?? null) : null,
        status,
      });
    },
    onSuccess: (response, variables) => {
      toast.push({
        title: variables.status === "submitted" ? "Report submitted" : "Draft saved",
        description: variables.status === "submitted" ? "Your project manager has been notified." : "Only you can see this draft.",
        tone: "success",
      });
      navigate(`/reports/${response.data.id}`);
    },
    onError: (error) => toast.push({ title: "Could not save report", description: errorMessage(error), tone: "error" }),
  });

  const applyAi = () => {
    const proposal = aiResult?.proposal;
    if (!proposal) return;
    if (proposal.work_completed?.length) setValue("completed", proposal.work_completed.join("\n"));
    if (proposal.work_pending?.length) setValue("pending", proposal.work_pending.join("\n"));
    if (proposal.delays) setValue("delays", proposal.delays);
    if (proposal.safety_observations) setValue("safety", proposal.safety_observations);
    if (proposal.workers_present?.total != null) setValue("total", String(proposal.workers_present.total));
    if (proposal.workers_present?.by_trade?.length) {
      setValue("trades", proposal.workers_present.by_trade.map((row: any) => `${row.trade}: ${row.count}`).join("\n"));
    }
    if (proposal.summary && !watch("activities")) setValue("activities", proposal.summary);
    setAppliedAi(true);
    toast.push({
      title: "AI proposal applied",
      description: "Review every line before submitting. Nothing has been saved yet.",
      tone: "info",
    });
  };

  if (!projectId) return <EmptyProject />;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Daily report"
        title="New site report"
        description="Record only what happened on site. Numbers stay exactly as you enter them — AI never changes or invents quantities."
        actions={
          <Link to="/reports">
            <Button size="sm" variant="outline">
              <ArrowLeft className="h-4 w-4" /> Back to reports
            </Button>
          </Link>
        }
      />

      <form onSubmit={handleSubmit((values) => create.mutate({ values, status: "draft" }))}>
        <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="Report details" description="Date, location and narrative" />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Field label="Report date" htmlFor="report_date" error={errors.report_date?.message}>
                  <Input id="report_date" type="date" max={today()} {...register("report_date")} />
                </Field>
                <Field label="Location / zone" htmlFor="location" error={errors.location?.message}>
                  <Input id="location" placeholder="e.g. Auditorium — Level 1" {...register("location")} />
                </Field>
                <Field label="Overall activities" htmlFor="activities" className="sm:col-span-2" hint="Short narrative of the day's work.">
                  <Textarea id="activities" rows={3} placeholder="AV containment and first-fix electrical works…" {...register("activities")} />
                </Field>
                <Field label="Work completed" htmlFor="completed" hint="One item per line. These are your words, not generated quantities.">
                  <Textarea id="completed" rows={5} placeholder={"Pulled Cat6 in zones A–B\nTerminated 12 downlights"} {...register("completed")} />
                </Field>
                <Field label="Work pending" htmlFor="pending" hint="One item per line.">
                  <Textarea id="pending" rows={5} placeholder={"Speaker grid zone C\nDB termination"} {...register("pending")} />
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Manpower and resources" description="Worker totals must match the trade breakdown" />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Field label="Workers on site" htmlFor="total" hint="Total for the day.">
                  <Input id="total" type="number" min={0} max={1000} inputMode="numeric" placeholder="18" {...register("total")} />
                </Field>
                <Field
                  label="By trade"
                  htmlFor="trades"
                  hint={`One per line, e.g. “Electricians: 8”. Sum: ${tradeSum || 0}`}
                  error={sumMismatch ? "Trade sum does not match the worker total." : undefined}
                >
                  <Textarea id="trades" rows={3} placeholder={"Electricians: 8\nHelpers: 6"} {...register("trades")} />
                </Field>
                <Field label="Equipment used" htmlFor="equipment" hint="One per line." className="sm:col-span-2">
                  <Textarea id="equipment" rows={2} placeholder={"Scaffold tower\nCable puller"} {...register("equipment")} />
                </Field>
                <Field label="Delays" htmlFor="delays" className="sm:col-span-2">
                  <Textarea id="delays" rows={2} placeholder="Cable tray delivery arrived two days late…" {...register("delays")} />
                </Field>
                <Field label="Safety observations" htmlFor="safety" className="sm:col-span-2">
                  <Textarea id="safety" rows={2} placeholder="Toolbox talk held; harness inspection logged." {...register("safety")} />
                </Field>
                <Field label="Internal notes" htmlFor="notes" className="sm:col-span-2">
                  <Textarea id="notes" rows={2} placeholder="Optional notes for the project manager." {...register("notes")} />
                </Field>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-brand-200">
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-brand-700" /> Structure notes with AI
                  </span>
                }
                description="Paste raw site notes. AI proposes a structure; you review before anything is saved."
              />
              <CardBody className="space-y-3">
                <AiModeNote />
                <Field label="Raw site notes" htmlFor="ai-notes" hint="Minimum 10 characters. Numbers you did not write are dropped.">
                  <Textarea
                    id="ai-notes"
                    rows={5}
                    value={aiNotes}
                    onChange={(event) => setAiNotes(event.target.value)}
                    placeholder="12 workers today. Pulled Cat6 in zones A and B. Speaker grid still pending zone C. Tray delivery was two days late. Toolbox talk done."
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => generate.mutate()}
                    disabled={aiNotes.trim().length < 10}
                    loading={generate.isPending}
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Generate proposal
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled
                    title="Speech-to-text is not configured on this server. The endpoint returns a typed AI_NOT_CONFIGURED error instead of pretending."
                  >
                    <Mic className="h-3.5 w-3.5" /> Voice input
                  </Button>
                </div>
                <p className="text-[10px] leading-relaxed text-ink-faint">
                  Voice-to-report is not enabled in this deployment. No audio is uploaded or transcribed by the browser.
                </p>

                {aiError ? (
                  <div className="flex items-start gap-2 rounded-lg border border-[#F6CFC9] bg-[#FDECEA] px-3 py-2 text-xs text-danger">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {aiError}
                  </div>
                ) : null}

                {aiResult ? (
                  <div className="rounded-lg border border-line bg-paper/60 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <MethodBadge method={aiResult.method} />
                      <span className="text-[10px] text-ink-faint">Prompt {aiResult.prompt_version ?? "—"}</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      {aiResult.proposal?.work_completed?.length ? (
                        <div>
                          <p className="font-semibold text-ink-muted">Completed</p>
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ink">
                            {aiResult.proposal.work_completed.map((line: string, index: number) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {aiResult.proposal?.work_pending?.length ? (
                        <div>
                          <p className="font-semibold text-ink-muted">Pending</p>
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ink">
                            {aiResult.proposal.work_pending.map((line: string, index: number) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {aiResult.proposal?.workers_present?.total != null ? (
                        <p className="text-ink-muted">
                          Workers: <span className="mono-num font-medium text-ink">{aiResult.proposal.workers_present.total}</span>
                          {aiResult.proposal.workers_present.by_trade?.length
                            ? ` · ${aiResult.proposal.workers_present.by_trade.map((row: any) => `${row.trade} ${row.count}`).join(", ")}`
                            : ""}
                        </p>
                      ) : null}
                      {aiResult.warnings?.length ? (
                        <div className="rounded border border-[#F2DDB8] bg-[#FDF3E3] px-2 py-1.5 text-[11px] text-warn">
                          {aiResult.warnings.map((warning: string, index: number) => (
                            <p key={index}>{warning}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Button type="button" size="sm" variant="secondary" className="mt-3 w-full" onClick={applyAi}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Apply to form for review
                    </Button>
                    {appliedAi ? (
                      <p className="mt-2 text-[10px] text-ink-faint">
                        Applied. The report will record <span className="font-medium">ai_assisted = true</span>.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Save" description="Drafts are private; submitted reports notify the project manager." />
              <CardBody className="space-y-2">
                <Button
                  type="button"
                  className="w-full"
                  variant="secondary"
                  loading={create.isPending}
                  onClick={handleSubmit((values) => create.mutate({ values, status: "draft" }))}
                >
                  <Save className="h-4 w-4" /> Save draft
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  loading={create.isPending}
                  disabled={sumMismatch}
                  onClick={handleSubmit((values) => create.mutate({ values, status: "submitted" }))}
                >
                  <Send className="h-4 w-4" /> Submit for approval
                </Button>
                {sumMismatch ? (
                  <p className="text-[11px] text-danger">Fix the worker total before submitting.</p>
                ) : (
                  <p className="text-[10px] leading-relaxed text-ink-faint">
                    {titleCase(project?.status ?? "active")} project · approval is a human action and cannot be done by AI.
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
