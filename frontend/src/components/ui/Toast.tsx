import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "success" | "error" | "info";

interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

interface ToastContextValue {
  push: (toast: { title: string; description?: string; tone?: Tone }) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

const toneStyles: Record<Tone, string> = {
  success: "border-[#C6E8D5] bg-[#F3FBF7] text-[#0B5C3D]",
  error: "border-[#F6CFC9] bg-[#FEF6F5] text-[#8F1B13]",
  info: "border-[#CFE0F2] bg-[#F5F9FE] text-[#1D4E89]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: { title: string; description?: string; tone?: Tone }) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone: toast.tone ?? "info", title: toast.title, description: toast.description }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lift animate-fade-up",
              toneStyles[toast.tone],
            )}
          >
            {toast.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : toast.tone === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-xs opacity-80">{toast.description}</p> : null}
            </div>
            <button
              className="rounded p-0.5 opacity-60 hover:opacity-100"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
