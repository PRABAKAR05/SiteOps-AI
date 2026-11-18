import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, MapPin, Plus, Users } from "lucide-react";
import { projectsApi, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDate, isoDaysFromNow, isoToday, titleCase } from "@/lib/format";
import type { Project } from "@/lib/types";

const projectTypes = ["interior", "auditorium", "electrical", "cctv", "fire_alarm", "av", "networking", "bms", "mixed"];
const statuses = ["planning", "active", "on_hold", "completed", "cancelled"];

const schema = z
  .object({
    name: z.string().min(3, "Use at least 3 characters"),
    code: z.string().min(2, "Code is required").max(20),
    client_name: z.string().min(2, "Client is required"),
    location: z.string().min(2, "Location is required"),
    project_type: z.string().min(1),
    status: z.string().min(1),
    start_date: z.string().min(10, "Start date is required"),
    expected_end_date: z.string().min(10, "End date is required"),
    description: z.string().optional(),
  })
  .refine((values) => values.expected_end_date >= values.start_date, {
    message: "End date must be on or after the start date",
    path: ["expected_end_date"],
  });

type FormValues = z.infer<typeof schema>;

export default function Projects() {
  const { user } = useAuth();
  const { setProjectId, projectId } = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: async () => (await projectsApi.list({ page_size: 100 })).data,
    enabled: Boolean(user),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      project_type: "av",
      status: "planning",
      start_date: isoToday(),
      expected_end_date: isoDaysFromNow(90),
    },
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => projectsApi.create(values),
    onSuccess: async (response) => {
      toast.push({ title: "Project created", description: response.data.name, tone: "success" });
      setOpen(false);
      reset();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjectId(response.data.id);
    },
    onError: (error) => toast.push({ title: "Could not create project", description: errorMessage(error), tone: "error" }),
  });

  const projects = query.data?.items ?? [];

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Portfolio"
        title="Projects"
        description="Each workspace is isolated. You only see projects you are a member of, and switching projects never widens access."
        actions={
          user?.role === "project_manager" ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New project
            </Button>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            description={
              user?.role === "project_manager"
                ? "Create your first project to start recording field operations."
                : "Your project manager has not added you to a project yet."
            }
            icon={<Building2 className="h-5 w-5" />}
            action={
              user?.role === "project_manager" ? (
                <Button size="sm" onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4" /> New project
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project: Project) => {
            const active = project.id === projectId;
            return (
              <Card key={project.id} className={active ? "ring-1 ring-brand-300" : undefined}>
                <div className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-700">{project.code}</span>
                        {active ? <Badge tone="brand">Active</Badge> : null}
                        {project.delay_flag ? <Badge tone="warn">Delayed</Badge> : null}
                      </div>
                      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug tracking-tight">{project.name}</h3>
                      <p className="mt-0.5 text-xs text-ink-muted">{project.client_name}</p>
                    </div>
                    <StatusBadge status={project.status} />
                  </div>

                  <p className="mt-3 line-clamp-2 min-h-[32px] text-xs leading-relaxed text-ink-muted">
                    {project.description || "No description provided."}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-faint">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {project.location}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {project.member_count ?? 0} members
                    </span>
                    <span>{titleCase(project.project_type)}</span>
                  </div>

                  <div className="mt-auto pt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-ink-muted">Progress</span>
                      <span className="mono-num font-medium">{project.progress_percent}%</span>
                    </div>
                    <Progress value={project.progress_percent} tone={project.delay_flag ? "warn" : "brand"} />
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-ink-faint">{formatDate(project.start_date)} → {formatDate(project.expected_end_date)}</span>
                      <Button
                        size="sm"
                        variant={active ? "outline" : "secondary"}
                        onClick={() => {
                          setProjectId(project.id);
                          navigate("/");
                        }}
                      >
                        {active ? "Open" : "Switch"} <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] text-ink-faint">
        Demo projects are fictional and marked in the seed script. No production client data is included.
      </p>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New project"
        description="You will be added as project manager. Other members can be added from Team."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={handleSubmit((values) => create.mutate(values))}>
              Create project
            </Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((values) => create.mutate(values))}>
          <Field label="Project name" htmlFor="name" error={errors.name?.message} className="sm:col-span-2">
            <Input id="name" placeholder="e.g. Riverside Auditorium AV Fitout" {...register("name")} />
          </Field>
          <Field label="Project code" htmlFor="code" error={errors.code?.message} hint="Unique short code, e.g. RIV-AV1">
            <Input id="code" placeholder="RIV-AV1" {...register("code")} />
          </Field>
          <Field label="Client" htmlFor="client_name" error={errors.client_name?.message}>
            <Input id="client_name" placeholder="Client organisation" {...register("client_name")} />
          </Field>
          <Field label="Location" htmlFor="location" error={errors.location?.message}>
            <Input id="location" placeholder="City / site" {...register("location")} />
          </Field>
          <Field label="Project type" htmlFor="project_type" error={errors.project_type?.message}>
            <Select id="project_type" {...register("project_type")}>
              {projectTypes.map((type) => (
                <option key={type} value={type}>{titleCase(type)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="start_date" error={errors.start_date?.message}>
            <Input id="start_date" type="date" {...register("start_date")} />
          </Field>
          <Field label="Expected end" htmlFor="expected_end_date" error={errors.expected_end_date?.message}>
            <Input id="expected_end_date" type="date" {...register("expected_end_date")} />
          </Field>
          <Field label="Status" htmlFor="status" error={errors.status?.message}>
            <Select id="status" {...register("status")}>
              {statuses.map((status) => (
                <option key={status} value={status}>{titleCase(status)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="description" error={errors.description?.message} className="sm:col-span-2">
            <Textarea id="description" rows={3} placeholder="Scope, floors, systems in scope…" {...register("description")} />
          </Field>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Dialog>

      {query.isFetching && !query.isLoading ? (
        <p className="mt-3 text-[11px] text-ink-faint">Refreshing projects…</p>
      ) : null}
    </div>
  );
}
