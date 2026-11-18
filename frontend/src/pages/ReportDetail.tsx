import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CalendarDays, Check, Download, FileText, ImagePlus, MapPin, Sparkles, User, Users, X,
} from "lucide-react";
import { errorMessage, reportsApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Input";
import { Badge, ChipList, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime } from "@/lib/format";

export default function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const { projectId } = useProject();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["report", projectId, id],
    queryFn: async () => (await reportsApi.get(projectId as string, id as string)).data,
    enabled: Boolean(projectId && id),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["report", projectId, id] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const submit = useMutation({
    mutationFn: () => reportsApi.submit(projectId as string, id as string),
    onSuccess: () => {
      toast.push({ title: "Report submitted", description: "Your project manager can now review it.", tone: "success" });
      refresh();
    },
    onError: (error) => toast.push({ title: "Could not submit", description: errorMessage(error), tone: "error" }),
  });

  const approve = useMutation({
    mutationFn: () => reportsApi.approve(projectId as string, id as string),
    onSuccess: () => {
      toast.push({ title: "Report approved", tone: "success" });
      refresh();
    },
    onError: (error) => toast.push({ title: "Could not approve", description: errorMessage(error), tone: "error" }),
  });

  const reject = useMutation({
    mutationFn: () => reportsApi.reject(projectId as string, id as string, reason.trim()),
    onSuccess: () => {
      toast.push({ title: "Report returned to author", tone: "success" });
      setRejecting(false);
      setReason("");
      refresh();
    },
    onError: (error) => toast.push({ title: "Could not reject", description: errorMessage(error), tone: "error" }),
  });

  const photo = useMutation({
    mutationFn: (file: File) => reportsApi.uploadPhoto(projectId as string, id as string, file),
    onSuccess: () => {
      toast.push({ title: "Photo attached", tone: "success" });
      refresh();
    },
    onError: (error) => toast.push({ title: "Photo upload failed", description: errorMessage(error), tone: "error" }),
  });

  if (!projectId || !id) return <EmptyState title="Report not found" description="Choose a project first." />;

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  if (!query.data) return <EmptyState title="Report not found" description="It may have been removed or you may not have access." />;

  const report = query.data as typeof query.data & {
    approved_by?: string | null;
    submitted_at?: string | null;
    approved_at?: string | null;
    updated_at?: string | null;
  };
  const isManager = user?.role === "project_manager";
  const isAuthor = report.submitted_by === user?.id;
  const canSubmit = report.status === "draft" && (isAuthor || isManager);
  const canReview = isManager && report.status === "submitted";
  const canAttach = user?.role !== "storekeeper" && ["draft", "submitted"].includes(report.status);

  const workers = report.workers_present ?? { total: null, by_trade: [] };

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Daily report"
        title={formatDate(report.report_date)}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {report.location}
            </span>
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" /> {report.submitted_by_name}
            </span>
            {report.ai_assisted ? (
              <Badge tone="brand">
                <Sparkles className="h-3 w-3" /> AI-assisted, reviewed by author
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <Link to="/reports">
              <Button size="sm" variant="outline">
                <ArrowLeft className="h-4 w-4" /> All reports
              </Button>
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                reportsApi
                  .downloadPdf(projectId, report.id, `daily-report-${report.report_date}.pdf`)
                  .catch((error) => toast.push({ title: "Download failed", description: errorMessage(error), tone: "error" }))
              }
            >
              <Download className="h-4 w-4" /> PDF
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Site narrative"
              description="Original text entered by the author"
              action={<StatusBadge status={report.status} />}
            />
            <CardBody className="space-y-4">
              <p className="text-sm leading-relaxed text-ink">{report.activities || "No narrative recorded."}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Completed</p>
                  {report.work_completed?.length ? (
                    <ul className="space-y-1.5">
                      {report.work_completed.map((line, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm leading-snug">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-faint">—</p>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Pending</p>
                  {report.work_pending?.length ? (
                    <ul className="space-y-1.5">
                      {report.work_pending.map((line, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm leading-snug">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-faint">—</p>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="Manpower" description="As recorded by the author" />
              <CardBody>
                <div className="flex items-end gap-2">
                  <p className="mono-num text-3xl font-semibold leading-none">{workers.total ?? 0}</p>
                  <p className="pb-0.5 text-xs text-ink-muted">workers on site</p>
                </div>
                {workers.by_trade?.length ? (
                  <ul className="mt-3 space-y-1.5">
                    {workers.by_trade.map((row) => (
                      <li key={row.trade} className="flex items-center justify-between text-[13px]">
                        <span className="text-ink-muted">{row.trade}</span>
                        <span className="mono-num font-medium">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-faint">No trade breakdown recorded.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Materials, equipment & photos" description="Linked records" />
              <CardBody className="space-y-3">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Materials consumed</p>
                  {report.materials_consumed?.length ? (
                    <ul className="space-y-1">
                      {report.materials_consumed.map((item, index) => (
                        <li key={index} className="flex items-center justify-between text-[13px]">
                          <span className="text-ink-muted">{item.name}</span>
                          <span className="mono-num">
                            {item.quantity} {item.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-faint">None recorded. Stock is only adjusted through the inventory ledger.</p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Equipment</p>
                  <ChipList items={report.equipment_used} empty="None recorded" />
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Photos</p>
                  {report.photos?.length ? (
                    <ul className="space-y-1">
                      {report.photos.map((photoItem: any, index: number) => (
                        <li key={photoItem.file_id ?? index} className="flex items-center gap-1.5 text-xs text-ink-muted">
                          <FileText className="h-3.5 w-3.5" /> {photoItem.filename}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-faint">No photos attached.</p>
                  )}
                  {canAttach ? (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) photo.mutate(file);
                          event.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        loading={photo.isPending}
                        onClick={() => fileRef.current?.click()}
                      >
                        <ImagePlus className="h-3.5 w-3.5" /> Attach photo
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Delays, safety & notes" description="As reported, without AI rewriting" />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Delays</p>
                <p className="text-sm leading-relaxed text-ink-muted">{report.delays || "None reported"}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Safety</p>
                <p className="text-sm leading-relaxed text-ink-muted">{report.safety_observations || "None recorded"}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Notes</p>
                <p className="text-sm leading-relaxed text-ink-muted">{report.notes || "—"}</p>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Review" description="Status changes are recorded with the acting user" />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <StatusBadge status={report.status} />
                <span className="text-[11px] text-ink-faint">{formatDateTime(report.created_at)}</span>
              </div>

              {report.status === "rejected" && report.rejection_reason ? (
                <div className="rounded-lg border border-[#F6CFC9] bg-[#FDECEA] px-3 py-2 text-xs leading-relaxed text-danger">
                  <p className="font-semibold">Returned by the project manager</p>
                  <p className="mt-0.5">{report.rejection_reason}</p>
                </div>
              ) : null}

              {canSubmit ? (
                <Button className="w-full" loading={submit.isPending} onClick={() => submit.mutate()}>
                  Submit for approval
                </Button>
              ) : null}

              {canReview ? (
                <>
                  <Button className="w-full" variant="secondary" loading={approve.isPending} onClick={() => approve.mutate()}>
                    <Check className="h-4 w-4" /> Approve report
                  </Button>
                  <Button className="w-full" variant="outline" onClick={() => setRejecting(true)}>
                    <X className="h-4 w-4" /> Reject with reason
                  </Button>
                </>
              ) : null}

              <div className="space-y-2 border-t border-line pt-3 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-ink-faint">Submitted by</span>
                  <span className="text-right font-medium text-ink">{report.submitted_by_name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-faint">Submitted at</span>
                  <span className="text-right text-ink-muted">{report.submitted_at ? formatDateTime(report.submitted_at) : "—"}</span>
                </div>
                {report.approved_at ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-faint">Approved at</span>
                    <span className="text-right text-ink-muted">{formatDateTime(report.approved_at)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3">
                  <span className="text-ink-faint">AI assistance</span>
                  <span className="text-right text-ink-muted">{report.ai_assisted ? "Used, human-reviewed" : "Not used"}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Integrity" description="How this record behaves" />
            <CardBody className="space-y-2 text-xs leading-relaxed text-ink-muted">
              <p className="flex gap-2">
                <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                Report dates cannot be in the future.
              </p>
              <p className="flex gap-2">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                Drafts are visible only to their author and the project manager.
              </p>
              <p className="flex gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                AI cannot submit, approve or reject. Those actions require a signed-in human with the right role.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject report"
        description="The author will be notified with your reason."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={reject.isPending} onClick={() => reject.mutate()}>
              Reject report
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="reject-detail" hint="At least 3 characters.">
          <Textarea id="reject-detail" rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
