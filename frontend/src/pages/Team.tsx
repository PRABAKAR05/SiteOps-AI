import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { errorMessage, miscApi, projectsApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { titleCase } from "@/lib/format";

const roles = ["project_manager", "site_engineer", "supervisor", "storekeeper"];
const projectStatuses = ["planning", "active", "on_hold", "completed", "cancelled"];

export default function Team() {
  const { user } = useAuth();
  const { projectId, project } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [projectRole, setProjectRole] = useState("site_engineer");
  const [removing, setRemoving] = useState<{ user_id: string; name: string } | null>(null);

  const [settings, setSettings] = useState({
    name: "",
    client_name: "",
    location: "",
    status: "active",
    delay_flag: false,
    delay_reason: "",
  });

  useEffect(() => {
    if (!project) return;
    setSettings({
      name: project.name,
      client_name: project.client_name,
      location: project.location,
      status: project.status,
      delay_flag: Boolean(project.delay_flag),
      delay_reason: project.delay_reason ?? "",
    });
  }, [project]);

  const isManager = user?.role === "project_manager";

  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: async () => (await projectsApi.members(projectId as string)).data.items,
    enabled: Boolean(projectId),
  });

  const users = useQuery({
    queryKey: ["users", search],
    queryFn: async () => (await miscApi.users(search || undefined)).data.items,
    enabled: addOpen,
  });

  const memberIds = useMemo(() => new Set((members.data ?? []).map((member) => member.user_id)), [members.data]);

  const add = useMutation({
    mutationFn: () => projectsApi.addMember(projectId as string, { user_id: selectedUser, project_role: projectRole }),
    onSuccess: () => {
      toast.push({ title: "Member added", description: "They can now access this project only.", tone: "success" });
      setAddOpen(false);
      setSelectedUser("");
      setSearch("");
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => toast.push({ title: "Could not add member", description: errorMessage(error), tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => projectsApi.removeMember(projectId as string, userId),
    onSuccess: () => {
      toast.push({ title: "Member removed", description: "Their access to this project has ended.", tone: "success" });
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => toast.push({ title: "Could not remove member", description: errorMessage(error), tone: "error" }),
  });

  const update = useMutation({
    mutationFn: () =>
      projectsApi.update(projectId as string, {
        name: settings.name,
        client_name: settings.client_name,
        location: settings.location,
        status: settings.status,
        delay_flag: settings.delay_flag,
        delay_reason: settings.delay_flag ? settings.delay_reason || null : null,
      }),
    onSuccess: () => {
      toast.push({ title: "Project updated", tone: "success" });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
    },
    onError: (error) => toast.push({ title: "Could not update project", description: errorMessage(error), tone: "error" }),
  });

  if (!projectId) return <EmptyProject />;

  if (!isManager) {
    return (
      <div className="animate-fade-up">
        <PageHeader eyebrow="Project" title="Team & settings" description="Member management is restricted to the project manager." />
        <Card>
          <EmptyState
            title="Project manager access required"
            description="You can see the project data you are a member of, but only the project manager can add or remove members or change project settings."
            icon={<ShieldCheck className="h-5 w-5" />}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Project"
        title="Team & settings"
        description={`${project?.name ?? "Project"} · membership is enforced on every API request, not just in this UI.`}
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add member
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Members"
            description={`${members.data?.length ?? 0} people can access this project`}
            action={<Users className="h-4 w-4 text-ink-faint" />}
          />
          {members.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12" />
              ))}
            </div>
          ) : members.isError ? (
            <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} />
          ) : !(members.data ?? []).length ? (
            <EmptyState title="No members" description="Add site engineers, supervisors or a storekeeper." />
          ) : (
            <ul className="divide-y divide-line">
              {(members.data ?? []).map((member) => (
                <li key={member.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800">
                    {member.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.name}
                      {member.user_id === user?.id ? <span className="ml-1.5 text-[11px] text-ink-faint">(you)</span> : null}
                    </p>
                    <p className="truncate text-[11px] text-ink-muted">{member.email}</p>
                  </div>
                  <Badge tone={member.project_role === "project_manager" ? "brand" : "neutral"}>
                    {titleCase(member.project_role)}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={member.user_id === user?.id}
                    title={member.user_id === user?.id ? "You cannot remove yourself" : `Remove ${member.name}`}
                    aria-label={`Remove ${member.name}`}
                    onClick={() => setRemoving({ user_id: member.user_id, name: member.name })}
                  >
                    <UserMinus className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Project settings" description="Delay flag is a human judgement shown on dashboards" />
          <CardBody className="space-y-4">
            <Field label="Project name" htmlFor="settings-name">
              <Input id="settings-name" value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} />
            </Field>
            <Field label="Client" htmlFor="settings-client">
              <Input id="settings-client" value={settings.client_name} onChange={(event) => setSettings({ ...settings, client_name: event.target.value })} />
            </Field>
            <Field label="Location" htmlFor="settings-location">
              <Input id="settings-location" value={settings.location} onChange={(event) => setSettings({ ...settings, location: event.target.value })} />
            </Field>
            <Field label="Status" htmlFor="settings-status">
              <Select id="settings-status" value={settings.status} onChange={(event) => setSettings({ ...settings, status: event.target.value })}>
                {projectStatuses.map((status) => (
                  <option key={status} value={status}>{titleCase(status)}</option>
                ))}
              </Select>
            </Field>
            <div className="rounded-lg border border-line bg-paper/50 p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={settings.delay_flag}
                  onChange={(event) => setSettings({ ...settings, delay_flag: event.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
                />
                <span>
                  <span className="block text-xs font-medium">Flag this project as delayed</span>
                  <span className="block text-[11px] text-ink-muted">
                    Displayed on the dashboard. The risk score separately computes slippage from tasks and reports.
                  </span>
                </span>
              </label>
              {settings.delay_flag ? (
                <Textarea
                  className="mt-2"
                  rows={2}
                  value={settings.delay_reason}
                  onChange={(event) => setSettings({ ...settings, delay_reason: event.target.value })}
                  placeholder="Reason shown to the project team"
                  aria-label="Delay reason"
                />
              ) : null}
            </div>
            <Button className="w-full" loading={update.isPending} onClick={() => update.mutate()}>
              Save settings
            </Button>
            <p className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-faint">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Changing the project code is not supported after creation, so report and invoice references stay stable.
            </p>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add project member"
        description="Membership grants access to this project only. Cross-project requests return 404."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button loading={add.isPending} disabled={!selectedUser} onClick={() => add.mutate()}>
              Add member
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Find a user" htmlFor="member-search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <Input
                id="member-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or email"
                className="pl-8"
              />
            </div>
          </Field>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
            {users.isLoading ? (
              <p className="p-3 text-sm text-ink-muted">Loading users…</p>
            ) : !(users.data ?? []).length ? (
              <p className="p-3 text-sm text-ink-muted">No users match that search.</p>
            ) : (
              (users.data ?? []).map((candidate) => {
                const already = memberIds.has(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={already}
                    onClick={() => setSelectedUser(candidate.id)}
                    className={`flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-0 ${
                      selectedUser === candidate.id ? "bg-brand-50" : "bg-white hover:bg-paper/50"
                    } disabled:opacity-50`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{candidate.name}</p>
                      <p className="truncate text-[11px] text-ink-muted">{candidate.email}</p>
                    </div>
                    <Badge tone="neutral">{titleCase(candidate.role)}</Badge>
                    {already ? <span className="text-[10px] text-ink-faint">Member</span> : null}
                  </button>
                );
              })
            )}
          </div>
          <Field label="Project role" htmlFor="member-role" hint="Project role controls what this person can do inside this project.">
            <Select id="member-role" value={projectRole} onChange={(event) => setProjectRole(event.target.value)}>
              {roles.map((role) => (
                <option key={role} value={role}>{titleCase(role)}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove member"
        description={removing?.name}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.user_id)}>
              Remove access
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          They will immediately lose access to this project's reports, stock, issues, invoices and documents. Records they
          created remain attributed to them.
        </p>
      </Dialog>
    </div>
  );
}
