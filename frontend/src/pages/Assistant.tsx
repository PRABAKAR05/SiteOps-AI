import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, CornerDownLeft, Sparkles, Trash2, User as UserIcon } from "lucide-react";
import { aiApi, errorCode, errorMessage } from "@/lib/api";
import { useProject } from "@/context/ProjectContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { AiModeNote } from "@/components/AiModeBadge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MethodBadge, Badge } from "@/components/ui/Badge";
import { titleCase } from "@/lib/format";

type Message = {
  role: "user" | "assistant";
  text: string;
  method?: string;
  grounded?: boolean;
  used?: number;
  confidence?: string;
  model?: string | null;
  error?: string | null;
};

const suggestions = [
  "Which materials are below their reorder level?",
  "What issues are still open and how serious are they?",
  "Which tasks are overdue or blocked?",
  "Summarise the most recent daily reports.",
];

export default function Assistant() {
  const { projectId, project } = useProject();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const status = useQuery({
    queryKey: ["ai-status"],
    queryFn: async () => (await aiApi.status()).data,
  });

  const chat = useMutation({
    mutationFn: (message: string) => aiApi.chat(projectId as string, message),
    onSuccess: (response) => {
      const data = response.data as {
        answer: string;
        grounded?: boolean;
        used_ids?: string[];
        method?: string;
        confidence?: string;
        model?: string | null;
      };
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: data.answer,
          method: data.method,
          grounded: data.grounded,
          used: data.used_ids?.length ?? 0,
          confidence: data.confidence,
          model: data.model,
        },
      ]);
    },
    onError: (error) => {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: errorMessage(error),
          error: errorCode(error) ?? "REQUEST_FAILED",
        },
      ]);
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chat.isPending]);

  if (!projectId) return <EmptyProject />;

  const send = (message: string) => {
    const text = message.trim();
    if (text.length < 2 || chat.isPending) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setInput("");
    chat.mutate(text);
  };

  const mode = status.data?.mode;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Assistant"
        title="Project assistant"
        description={`Read-only answers about ${project?.name ?? "this project"}. Retrieval runs before the model, and the assistant cannot change any record.`}
        actions={
          <Button size="sm" variant="outline" onClick={() => setMessages([])} disabled={!messages.length}>
            <Trash2 className="h-4 w-4" /> Clear chat
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card className="flex min-h-[560px] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">SiteOps assistant</p>
              <p className="text-[11px] text-ink-faint">
                {mode === "groq" ? `Groq · ${status.data?.model ?? "LLM"}` : mode === "local" ? "Local rules mode — not an LLM" : "AI disabled"}
              </p>
            </div>
            <Badge tone={mode === "groq" ? "brand" : mode === "local" ? "warn" : "neutral"} className="ml-auto">
              {mode ? titleCase(mode) : "…"}
            </Badge>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
            {messages.length === 0 ? (
              <div className="mx-auto max-w-md py-8 text-center">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-paper text-brand-700">
                  <Sparkles className="h-5 w-5" />
                </span>
                <h2 className="mt-3 text-base font-semibold tracking-tight">Ask about the current site state</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  The assistant reads project records you are already allowed to see. It will not invent numbers, and it
                  cannot approve, verify, resolve or change stock.
                </p>
                <div className="mt-4 grid gap-1.5 text-left">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[12px] text-ink-muted transition-colors hover:border-brand-300 hover:text-brand-800"
                    >
                      {suggestion}
                      <CornerDownLeft className="h-3 w-3 shrink-0 opacity-50" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) =>
                message.role === "user" ? (
                  <div key={index} className="flex justify-end">
                    <div className="flex max-w-[85%] items-start gap-2">
                      <div className="rounded-2xl rounded-tr-sm bg-ink px-3.5 py-2.5 text-sm leading-relaxed text-white">
                        {message.text}
                      </div>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink-muted">
                        <UserIcon className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                ) : (
                  <div key={index} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                      <Bot className="h-3.5 w-3.5" />
                    </span>
                    <div className="max-w-[88%] space-y-1.5">
                      <div
                        className={
                          message.error
                            ? "rounded-2xl rounded-tl-sm border border-[#F6CFC9] bg-[#FDECEA] px-3.5 py-2.5 text-sm leading-relaxed text-danger"
                            : "whitespace-pre-line rounded-2xl rounded-tl-sm border border-line bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink"
                        }
                      >
                        {message.error ? (
                          <>
                            <p className="font-mono text-[10px] font-semibold">{message.error}</p>
                            <p className="mt-0.5">{message.text}</p>
                          </>
                        ) : (
                          message.text
                        )}
                      </div>
                      {!message.error ? (
                        <div className="flex flex-wrap items-center gap-1.5 pl-1">
                          {message.method ? <MethodBadge method={message.method} /> : null}
                          {message.confidence ? <Badge tone="neutral">{titleCase(message.confidence)} confidence</Badge> : null}
                          {typeof message.used === "number" ? <span className="text-[10px] text-ink-faint">{message.used} record{message.used === 1 ? "" : "s"} used</span> : null}
                          {message.grounded === false ? <Badge tone="warn">Not grounded</Badge> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ),
              )
            )}
            {chat.isPending ? (
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
                  <Bot className="h-3.5 w-3.5" />
                </span>
                Reading project records…
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Ask about stock, issues, tasks, reports or invoices…"
                aria-label="Message the project assistant"
                className="max-h-32 min-h-[42px] flex-1 resize-y rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
              <Button type="submit" disabled={input.trim().length < 2 || chat.isPending} loading={chat.isPending}>
                Send
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-ink-faint">
              Enter to send · Shift+Enter for a new line · signed in as {user?.name ?? "user"}
            </p>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">How this works</p>
            <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-muted">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                Your question selects database rows scoped to this project. No cross-project data is retrieved.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                {mode === "groq"
                  ? "The LLM formats those rows into an answer; numbers not present in the rows are rejected."
                  : "In local mode, answers are assembled directly from the retrieved rows with fixed templates."}
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                The assistant has no tools. It cannot write, approve or trigger workflows.
              </li>
            </ul>
            <div className="mt-3 border-t border-line pt-3">
              <AiModeNote />
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Good questions</p>
            <ul className="mt-2 space-y-1.5 text-[12px] text-ink-muted">
              <li>“What is low on stock?”</li>
              <li>“Which critical issues are unresolved?”</li>
              <li>“What did the last three reports say about delays?”</li>
              <li>“Are any invoices waiting for verification?”</li>
            </ul>
            <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
              For drawing and specification questions, use Documents — that path retrieves passages and returns page
              citations.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
