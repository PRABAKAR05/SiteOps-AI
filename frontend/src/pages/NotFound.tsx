import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted">
        <Compass className="h-6 w-6" />
      </span>
      <p className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">404</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">
        The page you asked for does not exist, or the record belongs to a project you cannot access.
      </p>
      <Link to="/" className="mt-5">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
