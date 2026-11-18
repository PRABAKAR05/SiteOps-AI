import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileText, Receipt, ShieldCheck, Upload, X } from "lucide-react";
import { errorMessage, invoicesApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge, MethodBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, formatMoneyMinor, formatQty, titleCase } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export default function Invoices() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [poId, setPoId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verifyDecision, setVerifyDecision] = useState<"verified" | "rejected" | null>(null);
  const [verifyNotes, setVerifyNotes] = useState("");

  const allowed = user?.role === "project_manager" || user?.role === "storekeeper";

  const list = useQuery({
    queryKey: ["invoices", projectId, status],
    queryFn: async () =>
      (await invoicesApi.list(projectId as string, { status: status || undefined, page_size: 50 })).data,
    enabled: Boolean(projectId) && allowed,
  });

  const detail = useQuery({
    queryKey: ["invoice", projectId, selectedId],
    queryFn: async () => (await invoicesApi.get(projectId as string, selectedId as string)).data,
    enabled: Boolean(projectId && selectedId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["invoice"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const upload = useMutation({
    mutationFn: () => invoicesApi.upload(projectId as string, file as File, poId.trim() || undefined),
    onSuccess: async (response) => {
      toast.push({
        title: "Invoice uploaded",
        description: "Extraction runs on the server. You still verify every field.",
        tone: "success",
      });
      setUploadOpen(false);
      setFile(null);
      setPoId("");
      setSelectedId(response.data.id);
      invalidate();
      try {
        await invoicesApi.extract(projectId as string, response.data.id);
        toast.push({ title: "Extraction complete", description: "Review totals and discrepancies before verifying.", tone: "info" });
      } catch (error) {
        toast.push({ title: "Extraction needs attention", description: errorMessage(error), tone: "error" });
      }
      invalidate();
    },
    onError: (error) => toast.push({ title: "Upload failed", description: errorMessage(error), tone: "error" }),
  });

  const extract = useMutation({
    mutationFn: (id: string) => invoicesApi.extract(projectId as string, id),
    onSuccess: () => {
      toast.push({ title: "Extraction complete", tone: "success" });
      invalidate();
    },
    onError: (error) => toast.push({ title: "Could not extract invoice", description: errorMessage(error), tone: "error" }),
  });

  const verify = useMutation({
    mutationFn: () =>
      invoicesApi.verify(projectId as string, selectedId as string, verifyDecision as "verified" | "rejected", verifyNotes.trim() || undefined),
    onSuccess: () => {
      toast.push({
        title: verifyDecision === "verified" ? "Invoice verified" : "Invoice rejected",
        description: "The decision and field snapshot are recorded.",
        tone: "success",
      });
      setVerifyDecision(null);
      setVerifyNotes("");
      invalidate();
    },
    onError: (error) => toast.push({ title: "Verification failed", description: errorMessage(error), tone: "error" }),
  });

  if (!projectId) return <EmptyProject />;

  if (!allowed) {
    return (
      <div className="animate-fade-up">
        <PageHeader eyebrow="Commercial" title="Invoices" description="Invoice extraction and verification require an authorised role." />
        <Card>
          <EmptyState
            title="Invoice access is restricted"
            description="Only project managers and storekeepers can upload, extract, verify or reject invoices. Contact your project manager if you need access."
            icon={<ShieldCheck className="h-5 w-5" />}
          />
        </Card>
      </div>
    );
  }

  const invoices = list.data?.items ?? [];
  const invoice: Invoice | undefined = detail.data as Invoice | undefined;

  const totalOf = (item: Invoice) => item.computed?.total_minor ?? item.stated?.total_minor ?? null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Commercial"
        title="Invoices"
        description="Totals are recomputed in Python from line items. Printed values are kept separately and shown as-is when they disagree."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> Upload invoice
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink-muted">Status</span>
            <Select value={status} onChange={(event) => setStatus(event.target.value)} className="max-w-[190px]">
              <option value="">All</option>
              {["uploaded", "extracted", "needs_review", "verified", "rejected", "failed"].map((value) => (
                <option key={value} value={value}>{titleCase(value)}</option>
              ))}
            </Select>
          </div>
          <p className="text-[11px] text-ink-faint">{list.data?.total ?? 0} invoices · AI never verifies on its own</p>
        </div>

        {list.isLoading ? (
          <SkeletonTable rows={5} />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : invoices.length === 0 ? (
          <EmptyState
            title="No invoices"
            description="Upload a vendor invoice PDF. Extraction proposes fields; a person verifies or rejects it."
            icon={<Receipt className="h-5 w-5" />}
            action={
              <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" /> Upload invoice
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[860px]">
              <thead className="bg-paper/50">
                <tr>
                  <th className="th">Vendor / number</th>
                  <th className="th">Invoice date</th>
                  <th className="th text-right">Computed total</th>
                  <th className="th">Status</th>
                  <th className="th">Flags</th>
                  <th className="th">Uploaded</th>
                  <th className="th text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((item) => (
                  <tr key={item.id} className="cursor-pointer hover:bg-paper/40" onClick={() => setSelectedId(item.id)}>
                    <td className="td">
                      <p className="font-medium">{item.vendor || "Vendor not extracted"}</p>
                      <p className="font-mono text-[11px] text-ink-faint">{item.invoice_number || item.file?.filename}</p>
                    </td>
                    <td className="td text-xs text-ink-muted">{item.invoice_date ? formatDate(item.invoice_date) : "—"}</td>
                    <td className="td mono-num text-right font-medium">{formatMoneyMinor(totalOf(item))}</td>
                    <td className="td"><StatusBadge status={item.verification_status} /></td>
                    <td className="td">
                      {item.discrepancies?.length ? (
                        <Badge tone="danger">{item.discrepancies.length} issue{item.discrepancies.length === 1 ? "" : "s"}</Badge>
                      ) : (
                        <Badge tone="ok">No flags</Badge>
                      )}
                    </td>
                    <td className="td text-xs text-ink-muted">{item.uploaded_by_name ?? "—"}</td>
                    <td className="td text-right"><span className="text-xs font-medium text-brand-700">Review</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload invoice"
        description="PDF only, up to the server's configured limit. Files are stored outside the database."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
              Upload & extract
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Invoice file" htmlFor="invoice-file" hint="Choose a PDF. Text-based PDFs extract reliably; scans fall back to OCR where available.">
            <Input
              id="invoice-file"
              ref={fileRef}
              type="file"
              accept="application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="py-2"
            />
          </Field>
          <Field label="Purchase order ID (optional)" htmlFor="invoice-po" hint="Link a PO to enable line-level comparison.">
            <Input id="invoice-po" value={poId} onChange={(event) => setPoId(event.target.value)} placeholder="24-character PO id" />
          </Field>
          <p className="rounded-lg border border-line bg-paper/60 px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
            The extractor never pays, approves or verifies. Discrepancies such as line-total mismatches are recorded for human review.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(selectedId)}
        onClose={() => {
          setSelectedId(null);
          setVerifyDecision(null);
        }}
        title={invoice ? invoice.vendor || "Invoice" : "Invoice"}
        description={invoice ? `${invoice.invoice_number || "Number not extracted"} · ${invoice.file?.filename}` : undefined}
        size="xl"
        footer={
          invoice ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  invoicesApi
                    .download(projectId, invoice.id, invoice.file?.filename || "invoice.pdf")
                    .catch((error) => toast.push({ title: "Download failed", description: errorMessage(error), tone: "error" }))
                }
              >
                <Download className="h-3.5 w-3.5" /> Original PDF
              </Button>
              {["uploaded", "failed"].includes(invoice.verification_status) ? (
                <Button size="sm" variant="secondary" loading={extract.isPending} onClick={() => extract.mutate(invoice.id)}>
                  Run extraction
                </Button>
              ) : null}
              {["extracted", "needs_review"].includes(invoice.verification_status) ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setVerifyDecision("rejected")}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                  <Button size="sm" onClick={() => setVerifyDecision("verified")}>
                    <Check className="h-3.5 w-3.5" /> Verify
                  </Button>
                </>
              ) : null}
            </>
          ) : null
        }
      >
        {detail.isLoading ? (
          <p className="text-sm text-ink-muted">Loading invoice…</p>
        ) : detail.isError ? (
          <ErrorState message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />
        ) : invoice ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={invoice.verification_status} />
              {invoice.ai_extraction ? <MethodBadge method={invoice.ai_extraction.method} /> : null}
              {invoice.ai_extraction?.confidence ? <Badge tone="neutral">Confidence: {titleCase(invoice.ai_extraction.confidence)}</Badge> : null}
              <Badge tone="neutral">{invoice.currency}</Badge>
              <span className="ml-auto text-[11px] text-ink-faint">Uploaded {formatDateTime(invoice.created_at)}</span>
            </div>

            {invoice.ai_extraction?.warnings?.length ? (
              <div className="rounded-lg border border-[#F2DDB8] bg-[#FDF3E3] px-3 py-2 text-xs text-warn">
                {invoice.ai_extraction.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="table-wrap rounded-lg border border-line">
              <table className="w-full min-w-[560px]">
                <thead className="bg-paper/60">
                  <tr>
                    <th className="th">Description</th>
                    <th className="th text-right">Qty</th>
                    <th className="th text-right">Unit price</th>
                    <th className="th text-right">Printed line</th>
                    <th className="th text-right">Computed line</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.extracted_items ?? []).map((item, index) => {
                    const computed = invoice.computed?.line_totals_minor?.[index] ?? null;
                    const mismatch = computed != null && item.line_total_minor != null && computed !== item.line_total_minor;
                    return (
                      <tr key={index}>
                        <td className="td">{item.description}</td>
                        <td className="td mono-num text-right">{formatQty(item.quantity)} {item.unit ?? ""}</td>
                        <td className="td mono-num text-right">{formatMoneyMinor(item.unit_price_minor)}</td>
                        <td className="td mono-num text-right text-ink-muted">{formatMoneyMinor(item.line_total_minor)}</td>
                        <td className={`td mono-num text-right font-medium ${mismatch ? "text-danger" : ""}`}>
                          {formatMoneyMinor(computed)}
                        </td>
                      </tr>
                    );
                  })}
                  {!(invoice.extracted_items ?? []).length ? (
                    <tr>
                      <td className="td text-sm text-ink-muted" colSpan={5}>No line items extracted yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-line p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Totals</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-muted">Computed subtotal</span>
                    <span className="mono-num font-medium">{formatMoneyMinor(invoice.computed?.subtotal_minor)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-muted">Computed tax</span>
                    <span className="mono-num">{formatMoneyMinor(invoice.computed?.tax_minor)}</span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-line pt-1.5">
                    <span className="font-medium">Computed total</span>
                    <span className="mono-num font-semibold">{formatMoneyMinor(invoice.computed?.total_minor)}</span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-line pt-1.5">
                    <span className="text-ink-muted">Printed total</span>
                    <span className="mono-num text-ink-muted">{formatMoneyMinor(invoice.stated?.total_minor)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-line p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Discrepancies</p>
                {invoice.discrepancies?.length ? (
                  <ul className="space-y-1.5">
                    {invoice.discrepancies.map((item, index) => (
                      <li key={index} className="text-xs">
                        <span className="font-mono text-[10px] font-semibold text-danger">{item.code}</span>
                        <p className="text-ink-muted">{item.message}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-muted">No discrepancies recorded.</p>
                )}
              </div>
            </div>

            {invoice.verification ? (
              <div className="rounded-lg border border-[#C6E8D5] bg-[#F3FBF7] px-3 py-2 text-xs text-ok">
                <p className="font-semibold">{titleCase(invoice.verification.decision)} by a human</p>
                <p className="mt-0.5 text-[#0B5C3D]">{invoice.verification.notes || "No notes recorded."}</p>
                <p className="mt-0.5 text-[10px] opacity-70">{formatDateTime(invoice.verification.at)}</p>
              </div>
            ) : null}

            {verifyDecision ? (
              <div className="rounded-lg border border-line bg-paper/50 p-3">
                <p className="mb-2 text-xs font-semibold">
                  {verifyDecision === "verified" ? "Verify invoice" : "Reject invoice"}
                </p>
                <Field label="Review notes" htmlFor="verify-notes" hint="Optional, but recommended. Stored with a field snapshot.">
                  <Textarea
                    id="verify-notes"
                    rows={2}
                    value={verifyNotes}
                    onChange={(event) => setVerifyNotes(event.target.value)}
                    placeholder={verifyDecision === "verified" ? "Checked against delivery note…" : "Reason for rejection…"}
                  />
                </Field>
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setVerifyDecision(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    variant={verifyDecision === "verified" ? "primary" : "danger"}
                    loading={verify.isPending}
                    onClick={() => verify.mutate()}
                  >
                    Confirm {verifyDecision === "verified" ? "verification" : "rejection"}
                  </Button>
                </div>
              </div>
            ) : null}

            <p className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-faint">
              <FileText className="mt-0.5 h-3 w-3 shrink-0" />
              The computed total is calculated from the extracted quantity and unit price using integer paise. Printed values are never overwritten.
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
