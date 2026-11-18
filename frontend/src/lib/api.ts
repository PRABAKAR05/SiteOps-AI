import axios, { AxiosError } from "axios";
import type {
  AiStatus, DailyReport, DocumentItem, Invoice, Issue, Material, Paged, Project, Task, User,
} from "./types";

const rawBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "/api/v1";

export const API_BASE = (
  rawBase.startsWith("http") && !rawBase.includes("/api/v1")
    ? rawBase.replace(/\/+$/, "") + "/api/v1"
    : rawBase.replace(/\/+$/, "")
);

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

const plain = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { "bypass-tunnel-reminder": "true" },
});

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { "bypass-tunnel-reminder": "true" },
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = plain
      .post("/auth/refresh")
      .then((response) => {
        const token = response.data.access_token as string;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    const isAuthCall = String(config?.url ?? "").includes("/auth/");
    if (error.response?.status === 401 && config && !config._retried && !isAuthCall) {
      config._retried = true;
      try {
        const token = await refreshAccessToken();
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      } catch {
        setAccessToken(null);
        window.dispatchEvent(new Event("siteops:unauthorized"));
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { error?: { message?: string; details?: Array<{ field: string; issue: string }> } } | undefined;
    const detail = body?.error?.details?.[0];
    if (detail) return `${detail.field || "Field"}: ${detail.issue}`;
    return body?.error?.message ?? error.message ?? "Request failed.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function errorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code ?? null;
  }
  return null;
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await api.get(url, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ access_token: string; user: User }>("/auth/login", { email, password }),
  logout: () => api.post("/auth/logout"),
  refresh: () => plain.post<{ access_token: string; user: User }>("/auth/refresh"),
  me: () => api.get<{ user: User }>("/auth/me"),
  updateProfile: (payload: { name?: string; phone?: string }) => api.patch("/auth/me", payload),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    api.post("/auth/change-password", payload),
};

export const projectsApi = {
  list: (params?: { status?: string; q?: string; page?: number; page_size?: number }) =>
    api.get<Paged<Project>>("/projects", { params }),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (payload: Record<string, unknown>) => api.post<Project>("/projects", payload),
  update: (id: string, payload: Record<string, unknown>) => api.put<Project>(`/projects/${id}`, payload),
  summary: (id: string) => api.get(`/projects/${id}/summary`),
  members: (id: string) => api.get<{ items: Array<{ user_id: string; name: string; email: string; role: string; project_role: string }> }>(`/projects/${id}/members`),
  addMember: (id: string, payload: { user_id: string; project_role?: string }) =>
    api.post(`/projects/${id}/members`, payload),
  removeMember: (id: string, userId: string) => api.delete(`/projects/${id}/members/${userId}`),
};

export const reportsApi = {
  list: (projectId: string, params?: Record<string, unknown>) =>
    api.get<Paged<DailyReport>>("/reports", { params: { project_id: projectId, ...params } }),
  get: (projectId: string, id: string) => api.get<DailyReport>(`/reports/${id}`, { params: { project_id: projectId } }),
  create: (payload: Record<string, unknown>) => api.post<DailyReport>("/reports", payload),
  update: (projectId: string, id: string, payload: Record<string, unknown>) =>
    api.put<DailyReport>(`/reports/${id}`, payload, { params: { project_id: projectId } }),
  submit: (projectId: string, id: string) => api.post(`/reports/${id}/submit`, null, { params: { project_id: projectId } }),
  approve: (projectId: string, id: string) => api.post(`/reports/${id}/approve`, null, { params: { project_id: projectId } }),
  reject: (projectId: string, id: string, reason: string) =>
    api.post(`/reports/${id}/reject`, { reason }, { params: { project_id: projectId } }),
  summary: (projectId: string, dateFrom: string, dateTo: string) =>
    api.get("/reports/summary", { params: { project_id: projectId, date_from: dateFrom, date_to: dateTo } }),
  uploadPhoto: (projectId: string, id: string, file: File) => {
    const data = new FormData();
    data.append("file", file);
    return api.post(`/reports/${id}/photos`, data, { params: { project_id: projectId } });
  },
  downloadPdf: (projectId: string, id: string, filename: string) =>
    downloadFile(`/reports/${id}/pdf?project_id=${projectId}`, filename),
};

export const inventoryApi = {
  materials: (projectId: string, params?: Record<string, unknown>) =>
    api.get<Paged<Material>>("/inventory/materials", { params: { project_id: projectId, ...params } }),
  material: (projectId: string, id: string) =>
    api.get<Material>(`/inventory/materials/${id}`, { params: { project_id: projectId } }),
  createMaterial: (payload: Record<string, unknown>) => api.post<Material>("/inventory/materials", payload),
  updateMaterial: (projectId: string, id: string, payload: Record<string, unknown>) =>
    api.put<Material>(`/inventory/materials/${id}`, payload, { params: { project_id: projectId } }),
  transact: (payload: Record<string, unknown>) => api.post("/inventory/transactions", payload),
  transactions: (projectId: string, params?: Record<string, unknown>) =>
    api.get<Paged<Record<string, any>>>("/inventory/transactions", { params: { project_id: projectId, ...params } }),
  alerts: (projectId: string) => api.get<{ items: Array<Record<string, any>> }>("/inventory/alerts", { params: { project_id: projectId } }),
  forecast: (projectId: string, horizon = 14) =>
    api.get<{ items: Array<Record<string, any>>; note: string; horizon_days: number }>("/inventory/forecast", {
      params: { project_id: projectId, horizon_days: horizon },
    }),
  reconcile: (projectId: string) =>
    api.get<{ items: Array<Record<string, any>> }>("/inventory/reconcile", { params: { project_id: projectId } }),
};

export const issuesApi = {
  list: (projectId: string, params?: Record<string, unknown>) =>
    api.get<Paged<Issue>>("/issues", { params: { project_id: projectId, ...params } }),
  get: (projectId: string, id: string) => api.get<Issue>(`/issues/${id}`, { params: { project_id: projectId } }),
  create: (payload: Record<string, unknown>) => api.post<Issue>("/issues", payload),
  update: (projectId: string, id: string, payload: Record<string, unknown>) =>
    api.put<Issue>(`/issues/${id}`, payload, { params: { project_id: projectId } }),
  assign: (projectId: string, id: string, userId: string) =>
    api.post(`/issues/${id}/assign`, { assigned_to: userId }, { params: { project_id: projectId } }),
  setStatus: (projectId: string, id: string, status: string) =>
    api.post(`/issues/${id}/status`, { status }, { params: { project_id: projectId } }),
  resolve: (projectId: string, id: string, notes: string) =>
    api.post(`/issues/${id}/resolve`, { resolution_notes: notes }, { params: { project_id: projectId } }),
  analytics: (projectId: string) => api.get("/issues/analytics", { params: { project_id: projectId } }),
};

export const tasksApi = {
  list: (projectId: string, params?: Record<string, unknown>) =>
    api.get<Paged<Task>>("/tasks", { params: { project_id: projectId, ...params } }),
  create: (payload: Record<string, unknown>) => api.post<Task>("/tasks", payload),
  update: (projectId: string, id: string, payload: Record<string, unknown>) =>
    api.put<Task>(`/tasks/${id}`, payload, { params: { project_id: projectId } }),
  analytics: (projectId: string) => api.get("/tasks/analytics", { params: { project_id: projectId } }),
};

export const invoicesApi = {
  list: (projectId: string, params?: Record<string, unknown>) =>
    api.get<Paged<Invoice>>("/invoices", { params: { project_id: projectId, ...params } }),
  get: (projectId: string, id: string) => api.get<Invoice>(`/invoices/${id}`, { params: { project_id: projectId } }),
  upload: (projectId: string, file: File, purchaseOrderId?: string) => {
    const data = new FormData();
    data.append("project_id", projectId);
    if (purchaseOrderId) data.append("purchase_order_id", purchaseOrderId);
    data.append("file", file);
    return api.post<Invoice>("/invoices/upload", data);
  },
  extract: (projectId: string, id: string) =>
    api.post<Invoice>(`/invoices/${id}/extract`, null, { params: { project_id: projectId } }),
  verify: (projectId: string, id: string, decision: "verified" | "rejected", notes?: string) =>
    api.post<Invoice>(`/invoices/${id}/verify`, { decision, notes }, { params: { project_id: projectId } }),
  download: (projectId: string, id: string, filename: string) =>
    downloadFile(`/invoices/${id}/file?project_id=${projectId}`, filename),
};

export const documentsApi = {
  list: (projectId: string, params?: Record<string, unknown>) =>
    api.get<Paged<DocumentItem>>("/documents", { params: { project_id: projectId, ...params } }),
  get: (projectId: string, id: string) => api.get<DocumentItem>(`/documents/${id}`, { params: { project_id: projectId } }),
  upload: (projectId: string, file: File, category: string) => {
    const data = new FormData();
    data.append("project_id", projectId);
    data.append("category", category);
    data.append("file", file);
    return api.post<DocumentItem>("/documents", data);
  },
  ask: (projectId: string, question: string, documentId?: string) =>
    api.post(
      documentId ? `/documents/${documentId}/ask` : "/documents/ask",
      { question },
      { params: { project_id: projectId } },
    ),
  remove: (projectId: string, id: string) => api.delete(`/documents/${id}`, { params: { project_id: projectId } }),
  retry: (projectId: string, id: string) => api.post(`/documents/${id}/retry`, null, { params: { project_id: projectId } }),
  text: (projectId: string, id: string) => api.get(`/documents/${id}/text`, { params: { project_id: projectId } }),
};

export const aiApi = {
  status: () => api.get<AiStatus>("/ai/status"),
  generateReport: (payload: { project_id: string; notes: string; report_date?: string; location?: string }) =>
    api.post("/ai/reports/generate", payload),
  periodSummary: (payload: { project_id: string; date_from: string; date_to: string }) =>
    api.post("/ai/reports/summary", payload),
  classifyIssue: (payload: { project_id: string; title: string; description: string }) =>
    api.post("/ai/issues/classify", payload),
  chat: (projectId: string, message: string) =>
    api.post("/ai/chat", { project_id: projectId, message }),
  explainForecast: (projectId: string, horizon = 14) =>
    api.post("/ai/forecast/explain", { project_id: projectId, horizon_days: horizon }),
  explainRisk: (projectId: string) => api.post("/ai/risk/explain", { project_id: projectId }),
};

export const analyticsApi = {
  dashboard: (params: { project_id?: string; date_from?: string; date_to?: string }) =>
    api.get("/analytics/dashboard", { params }),
  risk: (projectId: string) => api.get("/analytics/risk", { params: { project_id: projectId } }),
  progress: (projectId: string, params?: Record<string, unknown>) =>
    api.get("/analytics/progress", { params: { project_id: projectId, ...params } }),
  period: (projectId: string, params?: Record<string, unknown>) =>
    api.get("/analytics/period", { params: { project_id: projectId, ...params } }),
  periodPdf: (projectId: string, dateFrom: string, dateTo: string) =>
    downloadFile(
      `/analytics/period/pdf?project_id=${projectId}&date_from=${dateFrom}&date_to=${dateTo}`,
      `period-${dateFrom}-to-${dateTo}.pdf`,
    ),
};

export const miscApi = {
  enums: () => api.get("/meta/enums"),
  notifications: (params?: Record<string, unknown>) =>
    api.get<{ items: Array<Record<string, any>>; unread: number }>("/notifications", { params }),
  readAll: () => api.post("/notifications/read-all"),
  users: (q?: string) => api.get<Paged<User>>("/users", { params: { q } }),
};
