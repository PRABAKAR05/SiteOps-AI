import type { ReactNode } from "react";
import { Building2 } from "lucide-react";
import { useProject } from "@/context/ProjectContext";
import { useAuth } from "@/context/AuthContext";
import { Link } from "react-router-dom";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Skeleton } from "./ui/States";

export function EmptyProject({ children }: { children?: ReactNode }) {
  const { projects, loading } = useProject();
  const { user } = useAuth();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-52" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <div className="flex flex-col items-center px-6 py-12">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-paper text-ink-muted">
            <Building2 className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-semibold tracking-tight">No project assigned yet</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            {user?.role === "project_manager"
              ? "Create a project to start recording daily reports, stock, issues and invoices."
              : "Ask your project manager to add you to a project. You will only see data for projects you belong to."}
          </p>
          <div className="mt-5">
            {user?.role === "project_manager" ? (
              <Link to="/projects">
                <Button>Go to projects</Button>
              </Link>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  return <>{children}</>;
}
