import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api";
import type { Project } from "@/lib/types";
import { useAuth } from "./AuthContext";

interface ProjectContextValue {
  projects: Project[];
  project: Project | null;
  projectId: string | null;
  setProjectId: (id: string) => void;
  loading: boolean;
  error: unknown;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);
const STORAGE_KEY = "siteops:project";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projectId, setProjectIdState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  const query = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: async () => (await projectsApi.list({ page_size: 100 })).data,
    enabled: Boolean(user),
  });

  const projects = query.data?.items ?? [];

  useEffect(() => {
    if (!projects.length) return;
    if (!projectId || !projects.some((project) => project.id === projectId)) {
      const first = projects[0].id;
      setProjectIdState(first);
      localStorage.setItem(STORAGE_KEY, first);
    }
  }, [projects, projectId]);

  const setProjectId = (id: string) => {
    setProjectIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const project = projects.find((item) => item.id === projectId) ?? null;

  const value = useMemo(
    () => ({
      projects,
      project,
      projectId,
      setProjectId,
      loading: query.isLoading,
      error: query.error,
    }),
    [projects, project, projectId, query.isLoading, query.error],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error("useProject must be used inside ProjectProvider");
  return context;
}

export function useRequireProject() {
  const context = useProject();
  return { ...context, projectId: context.projectId as string, project: context.project as Project };
}
