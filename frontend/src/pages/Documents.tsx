import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, FileText, MessageSquareQuote, RefreshCw, Search, Sparkles, Trash2, Upload,
} from "lucide-react";
import { documentsApi, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge, MethodBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate, titleCase } from "@/lib/format";
import type { Citation, DocumentItem } from "@/lib/types";

const categories = ["drawing", "specification", "manual", "boq", "contract", "report", "other"];

type Answer = {
  answer: string;
  grounded: boolean;
  citations: Citation[];
  embedding_provider?: string;
  method?: string;
  model?: string | null;
};

function AnswerBlock({ answer }: { answer: Answer }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {answer.grounded ? <Badge tone="ok">Grounded in documents</Badge> : <Badge tone="warn">Not grounded — no answer given</Badge>}
        {answer.method ? <MethodBadge method={answer.method} /> : null}
        {answer.embedding_provider ? <Badge tone="neutral">Embeddings: {answer.embedding_provider}</Badge> : null}
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{answer.answer}</p>
      {answer.citations.length ? (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Citations</p>
          {answer.citations.map((citation, index) => (
            <div key={`${citation.document_id}-${citation.page}-${index}`} className="rounded-lg border border-line bg-paper/60 px-3 py-2">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink">
                <FileText className="h-3 w-3 text-ink-faint" />
                {citation.filename}
                <span className="text-ink-faint">· page {citation.page}</span>
                <span className="ml-auto font-mono text-[10px] text-ink-faint">score {citation.score.toFixed(3)}</span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">“{citation.excerpt}”</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Documents() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("drawing");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DocumentItem | null>(null);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [docQuestion, setDocQuestion] = useState("");
  const [docAnswer, setDocAnswer] = useState<Answer | null>(null);

  const list = useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => (await documentsApi.list(projectId as string, { page_size: 100 })).data,
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const items = (query.state.data?.items ?? []) as DocumentItem[];
      return items.some((item) => ["processing", "pending", "uploaded"].includes(item.processing_status)) ? 1800 : false;
    },
  });

  const text = useQuery({
    queryKey: ["document-text", projectId, selectedId],
    queryFn: async () => (await documentsApi.text(projectId as string, selectedId as string)).data,
    enabled: Boolean(projectId && selectedId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["document-text"] });
  };

  const upload = useMutation({
    mutationFn: () => documentsApi.upload(projectId as string, file as File, category),
    onSuccess: () => {
      toast.push({
        title: "Document uploaded",
        description: "Text extraction and indexing run in the background. Status updates automatically.",
        tone: "success",
      });
      setUploadOpen(false);
      setFile(null);
      invalidate();
    },
    onError: (error) => toast.push({ title: "Upload failed", description: errorMessage(error), tone: "error" }),
  });

  const ask = useMutation({
    mutationFn: () => documentsApi.ask(projectId as string, question.trim()),
    onSuccess: (response) => setAnswer(response.data as Answer),
    onError: (error) => toast.push({ title: "Could not answer", description: errorMessage(error), tone: "error" }),
  });

  const askDoc = useMutation({
    mutationFn: () => documentsApi.ask(projectId as string, docQuestion.trim(), selectedId as string),
    onSuccess: (response) => setDocAnswer(response.data as Answer),
    onError: (error) => toast.push({ title: "Could not answer", description: errorMessage(error), tone: "error" }),
  });

  const retry = useMutation({
    mutationFn: (id: string) => documentsApi.retry(projectId as string, id),
    onSuccess: () => {
      toast.push({ title: "Reprocessing started", tone: "info" });
      invalidate();
    },
    onError: (error) => toast.push({ title: "Retry failed", description: errorMessage(error), tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => documentsApi.remove(projectId as string, id),
    onSuccess: () => {
      toast.push({ title: "Document deleted", description: "Its extracted pages and vectors were removed too.", tone: "success" });
      setDeleting(null);
      setSelectedId(null);
      invalidate();
    },
    onError: (error) => toast.push({ title: "Delete failed", description: errorMessage(error), tone: "error" }),
  });

  if (!projectId) return <EmptyProject />;

  const documents = list.data?.items ?? [];
  const selected = documents.find((doc) => doc.id === selectedId);
  const canDelete = user?.role === "project_manager";

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Knowledge"
        title="Documents"
        description="Drawings, specs and manuals with grounded Q&A. Answers cite the page they came from; out-of-scope questions are refused rather than guessed."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> Upload document
          </Button>
        }
      />

      <Card className="mb-4 border-brand-200">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-700" /> Ask across all project documents
            </span>
          }
          description="Retrieval runs first; the model may only answer from retrieved passages."
        />
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Textarea
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="e.g. What is the mounting height specified for the auditorium speakers?"
              className="flex-1"
              aria-label="Question about project documents"
            />
            <Button
              className="sm:self-end"
              loading={ask.isPending}
              disabled={question.trim().length < 3 || documents.filter((doc) => doc.processing_status === "ready").length === 0}
              onClick={() => ask.mutate()}
            >
              <MessageSquareQuote className="h-4 w-4" /> Ask
            </Button>
          </div>
          {documents.filter((doc) => doc.processing_status === "ready").length === 0 ? (
            <p className="text-[11px] text-ink-faint">Upload and index at least one document before asking questions.</p>
          ) : null}
          {answer ? (
            <div className="rounded-lg border border-line bg-white p-3">
              <AnswerBlock answer={answer} />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Project documents"
          description={`${documents.length} document${documents.length === 1 ? "" : "s"} · PDF and text extraction`}
          action={
            <Button size="sm" variant="ghost" onClick={() => list.refetch()} loading={list.isFetching}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          }
        />
        {list.isLoading ? (
          <SkeletonTable rows={5} />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : documents.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload a drawing or specification PDF to enable grounded Q&A with page citations."
            icon={<BookOpen className="h-5 w-5" />}
            action={
              <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" /> Upload document
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[860px]">
              <thead className="bg-paper/50">
                <tr>
                  <th className="th">Document</th>
                  <th className="th">Category</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Pages</th>
                  <th className="th text-right">Chunks</th>
                  <th className="th">Indexed with</th>
                  <th className="th">Uploaded</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="cursor-pointer hover:bg-paper/40" onClick={() => { setSelectedId(doc.id); setDocAnswer(null); setDocQuestion(""); }}>
                    <td className="td max-w-[290px]">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" /> {doc.filename}
                      </p>
                      {doc.error ? <p className="mt-0.5 truncate text-[10px] text-danger">{doc.error.code}: {doc.error.message}</p> : null}
                    </td>
                    <td className="td text-ink-muted">{titleCase(doc.category)}</td>
                    <td className="td"><StatusBadge status={doc.processing_status} /></td>
                    <td className="td mono-num text-right">{doc.pages ?? "—"}</td>
                    <td className="td mono-num text-right">{doc.chunk_count ?? "—"}</td>
                    <td className="td text-[11px] text-ink-muted">{doc.embedding_provider ?? "—"}</td>
                    <td className="td whitespace-nowrap text-xs text-ink-muted">{formatDate(doc.created_at)}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                        {doc.processing_status === "failed" ? (
                          <Button size="sm" variant="outline" onClick={() => retry.mutate(doc.id)}>
                            <RefreshCw className="h-3.5 w-3.5" /> Retry
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => { setSelectedId(doc.id); setDocAnswer(null); setDocQuestion(""); }}>
                          Open
                        </Button>
                        {canDelete ? (
                          <Button size="icon" variant="ghost" aria-label={`Delete ${doc.filename}`} onClick={() => setDeleting(doc)}>
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
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
        title="Upload document"
        description="PDF, TXT or Markdown. Text-based PDFs extract directly; scans need OCR, which is optional."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
              Upload & index
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Document file" htmlFor="doc-file" hint="Searchable text is extracted and chunked; nothing is sent to a third party for indexing.">
            <Input
              id="doc-file"
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="py-2"
            />
          </Field>
          <Field label="Category" htmlFor="doc-category">
            <Select id="doc-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item} value={item}>{titleCase(item)}</option>
              ))}
            </Select>
          </Field>
          <p className="rounded-lg border border-line bg-paper/60 px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
            Uploading is a human action. Indexing stores page text and vectors scoped to this project only.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={selected?.filename ?? "Document"}
        description={selected ? `${titleCase(selected.category)} · ${selected.processing_status === "ready" ? "searchable" : selected.processing_status}` : undefined}
        size="xl"
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: "Pages", value: selected.pages ?? "—" },
                { label: "Chunks", value: selected.chunk_count ?? "—" },
                { label: "Embeddings", value: selected.embedding_provider ?? "—" },
                { label: "Uploaded by", value: selected.uploaded_by_name ?? "—" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-line bg-paper/50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{stat.label}</p>
                  <p className="mt-0.5 truncate text-sm font-medium">{stat.value}</p>
                </div>
              ))}
            </div>

            {selected.error ? (
              <div className="rounded-lg border border-[#F6CFC9] bg-[#FDECEA] px-3 py-2 text-xs text-danger">
                <span className="font-mono font-semibold">{selected.error.code}</span> · {selected.error.message}
              </div>
            ) : null}

            {selected.processing_status === "ready" ? (
              <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand-900">
                  <Search className="h-3.5 w-3.5" /> Ask this document
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={docQuestion}
                    onChange={(event) => setDocQuestion(event.target.value)}
                    placeholder="e.g. What cable schedule is specified for zone B?"
                    className="flex-1"
                    aria-label="Question about this document"
                  />
                  <Button
                    size="md"
                    loading={askDoc.isPending}
                    disabled={docQuestion.trim().length < 3}
                    onClick={() => askDoc.mutate()}
                  >
                    Ask
                  </Button>
                </div>
                {docAnswer ? (
                  <div className="mt-3 rounded-lg border border-line bg-white p-3">
                    <AnswerBlock answer={docAnswer} />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg border border-[#F2DDB8] bg-[#FDF3E3] px-3 py-2 text-xs text-warn">
                This document is not searchable yet. Q&amp;A becomes available once processing finishes.
              </p>
            )}

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Extracted text</p>
              {text.isLoading ? (
                <p className="text-sm text-ink-muted">Loading extracted text…</p>
              ) : text.isError ? (
                <ErrorState message={errorMessage(text.error)} onRetry={() => text.refetch()} />
              ) : !(text.data?.pages ?? []).length ? (
                <p className="text-sm text-ink-muted">No page text stored for this document.</p>
              ) : (
                <div className="max-h-[320px] space-y-3 overflow-y-auto rounded-lg border border-line bg-paper/40 p-3">
                  {(text.data?.pages ?? []).map((page: { page: number; text: string }) => (
                    <div key={page.page}>
                      <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Page {page.page}</p>
                      <p className="whitespace-pre-line text-[11px] leading-relaxed text-ink-muted">{page.text.slice(0, 1600)}{page.text.length > 1600 ? "…" : ""}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete document"
        description={deleting?.filename}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          This removes the file, its extracted pages and its vectors. Q&amp;A citations for this document will stop resolving.
          The action is recorded in the audit log.
        </p>
      </Dialog>
    </div>
  );
}
