import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, Download, Plus, X } from "lucide-react";
import { errorMessage, reportsApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea, Field } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import type { DailyReport } from "@/lib/types";

type StatusFilter = "all" | "submitted" | "approved" | "draft" | "rejected";

export default function Reports() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<DailyReport | null>(null);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["reports", projectId, status, page],
    queryFn: async () =>
      (
        await reportsApi.list(projectId as string, {
          status: status === "all" ? undefined : status,
          page,
          page_size: 12,
        })
      ).data,
    enabled: Boolean(projectId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => reportsApi.approve(projectId as string, id),
    onSuccess: () => {
      toast.push({ title: "Report approved", tone: "success" });
      invalidate();
    },
    onError: (error) => toast.push({ title: "Could not approve", description: errorMessage(error), tone: "error" }),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason: text }: { id: string; reason: string }) =>
      reportsApi.reject(projectId as string, id, text),
    onSuccess: () => {
      toast.push({ title: "Report returned to author", tone: "success" });
      setRejecting(null);
      setReason("");
      invalidate();
    },
    onError: (error) => toast.push({ title: "Could not reject", description: errorMessage(error), tone: "error" }),
  });

  if (!projectId) return <EmptyProject />;

  const reports = query.data?.items ?? [];
  const isManager = user?.role === "project_manager";
  const canCreate = user?.role !== "storekeeper";

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Field operations"
        title="Daily reports"
        description="Site progress, manpower and delays. Drafts are private to their author until submitted; approval is always a human decision."
        actions={
          canCreate ? (
            <Link to="/reports/new">
              <Button size="sm">
                <Plus className="h-4 w-4" /> New report
              </Button>
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div className="px-4 pt-1">
          <Tabs
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            items={[
              { value: "all", label: "All" },
              { value: "submitted", label: "Awaiting approval" },
              { value: "approved", label: "Approved" },
              { value: "draft", label: "Drafts" },
              { value: "rejected", label: "Rejected" },
            ]}
          />
        </div>

        {query.isLoading ? (
          <SkeletonTable rows={6} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : reports.length === 0 ? (
          <EmptyState
            title="No reports in this view"
            description={
              status === "all"
                ? "Create the first daily report for this project."
                : "Try another status filter, or create a report."
            }
            icon={<ClipboardList className="h-5 w-5" />}
            action={
              canCreate ? (
                <Link to="/reports/new">
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4" /> New report
                  </Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[760px]">
              <thead className="bg-paper/50">
                <tr>
                  <th className="th">Report date</th>
                  <th className="th">Location</th>
                  <th className="th">Submitted by</th>
                  <th className="th">Workers</th>
                  <th className="th">Completed</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => {
                  const completed = report.work_completed?.length ?? 0;
                  return (
                    <tr key={report.id} className="hover:bg-paper/40">
                      <td className="td">
                        <Link to={`/reports/${report.id}`} className="font-medium hover:text-brand-800 hover:underline">
                          {formatDate(report.report_date)}
                        </Link>
                      </td>
                      <td className="td text-ink-muted">{report.location}</td>
                      <td className="td text-ink-muted">{report.submitted_by_name}</td>
                      <td className="td mono-num">{report.workers_present?.total ?? "—"}</td>
                      <td className="td mono-num">{completed}</td>
                      <td className="td">
                        <StatusBadge status={report.status} />
                      </td>
                      <td className="td">
                        <div className="flex items-center justify-end gap-1">
                          {isManager && report.status === "submitted" ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => approve.mutate(report.id)}
                                loading={approve.isPending && approve.variables === report.id}
                              >
                                <Check className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setRejecting(report)}>
                                <X className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </>
                          ) : null}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Download PDF for ${formatDate(report.report_date)}`}
                            onClick={() =>
                              reportsApi
                                .downloadPdf(projectId, report.id, `daily-report-${report.report_date}.pdf`)
                                .catch((error) => toast.push({ title: "Download failed", description: errorMessage(error), tone: "error" }))
                            }
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Link
                            to={`/reports/${report.id}`}
                            className="rounded-lg px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                          >
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {query.data && query.data.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <p className="text-xs text-ink-muted">
              Page {query.data.page} of {query.data.pages} · {query.data.total} reports
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= query.data.pages} onClick={() => setPage((value) => value + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Dialog
        open={Boolean(rejecting)}
        onClose={() => {
          setRejecting(null);
          setReason("");
        }}
        title="Reject report"
        description={rejecting ? `This returns ${formatDate(rejecting.report_date)} to ${rejecting.submitted_by_name}.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={reject.isPending}
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason: reason.trim() })}
            >
              Reject report
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="reject-reason" hint="At least 3 characters. The author is notified.">
          <Textarea
            id="reject-reason"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Pending work list is incomplete for zone C."
          />
        </Field>
      </Dialog>
    </div>
  );
}
