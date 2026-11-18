import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDownUp, Boxes, CheckCircle2, PackagePlus, Plus, RefreshCw, Search, Sparkles,
} from "lucide-react";
import { aiApi, errorMessage, inventoryApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyProject } from "@/components/EmptyProject";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge, MethodBadge, StatusBadge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Primitives";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, formatMoneyMinor, formatQty, titleCase } from "@/lib/format";
import type { Material } from "@/lib/types";

type Tab = "materials" | "ledger" | "forecast" | "alerts";

const categories = ["electrical", "cctv", "networking", "fire_safety", "av", "acoustic", "civil", "bms", "consumables", "other"];
const units = ["pcs", "m", "box", "roll", "kg", "ltr", "set", "sqm"];
const transactionTypes = ["receipt", "consumption", "return", "wastage", "adjustment"];

const emptyMaterialForm = {
  name: "",
  category: "electrical",
  unit: "pcs",
  opening_stock: "0",
  reorder_level: "0",
  supplier: "",
  unit_cost: "",
};

export default function Inventory() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("materials");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [ledgerType, setLedgerType] = useState("");

  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm);

  const [txMaterial, setTxMaterial] = useState<Material | null>(null);
  const [txType, setTxType] = useState("consumption");
  const [txQty, setTxQty] = useState("");
  const [txDirection, setTxDirection] = useState<"increase" | "decrease">("decrease");
  const [txRemarks, setTxRemarks] = useState("");

  const [explained, setExplained] = useState<Record<string, { explanation: string; source: string }>>({});

  const canManage = user?.role === "project_manager" || user?.role === "storekeeper";

  const materials = useQuery({
    queryKey: ["materials", projectId, search, lowOnly],
    queryFn: async () =>
      (await inventoryApi.materials(projectId as string, { q: search || undefined, low_only: lowOnly, page_size: 100 })).data,
    enabled: Boolean(projectId),
  });

  const alerts = useQuery({
    queryKey: ["alerts", projectId],
    queryFn: async () => (await inventoryApi.alerts(projectId as string)).data.items,
    enabled: Boolean(projectId),
  });

  const transactions = useQuery({
    queryKey: ["transactions", projectId, ledgerType],
    queryFn: async () =>
      (await inventoryApi.transactions(projectId as string, { type: ledgerType || undefined, page_size: 30 })).data,
    enabled: Boolean(projectId) && tab === "ledger",
  });

  const forecast = useQuery({
    queryKey: ["forecast", projectId],
    queryFn: async () => (await inventoryApi.forecast(projectId as string, 14)).data,
    enabled: Boolean(projectId) && tab === "forecast",
  });

  const reconcile = useQuery({
    queryKey: ["reconcile", projectId],
    queryFn: async () => (await inventoryApi.reconcile(projectId as string)).data,
    enabled: Boolean(projectId) && tab === "alerts",
  });

  const invalidateInventory = () => {
    queryClient.invalidateQueries({ queryKey: ["materials"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["forecast"] });
    queryClient.invalidateQueries({ queryKey: ["reconcile"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const createMaterial = useMutation({
    mutationFn: () =>
      inventoryApi.createMaterial({
        project_id: projectId,
        name: materialForm.name.trim(),
        category: materialForm.category,
        unit: materialForm.unit,
        opening_stock: Number(materialForm.opening_stock || 0),
        reorder_level: Number(materialForm.reorder_level || 0),
        supplier: materialForm.supplier.trim() || null,
        unit_cost: materialForm.unit_cost ? Number(materialForm.unit_cost) : null,
      }),
    onSuccess: () => {
      toast.push({ title: "Material added", tone: "success" });
      setMaterialOpen(false);
      setMaterialForm(emptyMaterialForm);
      invalidateInventory();
    },
    onError: (error) => toast.push({ title: "Could not add material", description: errorMessage(error), tone: "error" }),
  });

  const transact = useMutation({
    mutationFn: () =>
      inventoryApi.transact({
        project_id: projectId,
        material_id: txMaterial?.id,
        type: txType,
        quantity: Number(txQty),
        remarks: txRemarks.trim() || null,
        ...(txType === "adjustment" ? { direction: txDirection } : {}),
      }),
    onSuccess: () => {
      toast.push({
        title: "Stock updated",
        description: txType === "consumption" ? "Consumption recorded in the ledger." : titleCase(txType) + " recorded.",
        tone: "success",
      });
      setTxMaterial(null);
      setTxQty("");
      setTxRemarks("");
      invalidateInventory();
    },
    onError: (error) => toast.push({ title: "Stock movement rejected", description: errorMessage(error), tone: "error" }),
  });

  const explain = useMutation({
    mutationFn: () => aiApi.explainForecast(projectId as string, 14),
    onSuccess: (response) => {
      const map: Record<string, { explanation: string; source: string }> = {};
      for (const item of response.data.items ?? []) {
        map[item.material_id ?? item.id ?? item.name] = {
          explanation: item.explanation ?? "",
          source: item.explanation_source ?? "",
        };
      }
      setExplained(map);
      toast.push({ title: "Forecast explanations ready", description: "Explanations never replace the computed numbers.", tone: "info" });
    },
    onError: (error) => toast.push({ title: "Could not explain forecast", description: errorMessage(error), tone: "error" }),
  });

  const items = materials.data?.items ?? [];
  const alertItems = alerts.data ?? [];
  const lowCount = useMemo(
    () => items.filter((item) => Number(item.current_stock) <= Number(item.reorder_level)).length,
    [items],
  );

  if (!projectId) return <EmptyProject />;

  const openTransaction = (material: Material, type = "consumption") => {
    setTxMaterial(material);
    setTxType(type);
    setTxQty("");
    setTxRemarks("");
    setTxDirection("decrease");
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Field operations"
        title="Inventory"
        description="Atomic stock movements with an immutable ledger. Corrections are new adjustment entries, never edits to history."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setMaterialOpen(true)}>
              <Plus className="h-4 w-4" /> New material
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Materials</p>
          <p className="mono-num mt-1 text-xl font-semibold">{materials.data?.total ?? items.length}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Low stock</p>
          <p className="mono-num mt-1 text-xl font-semibold text-warn">{alertItems.length}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Your role</p>
          <p className="mt-1 text-[13px] font-medium">{titleCase(user?.role)}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Stock rights</p>
          <p className="mt-1 text-[13px] font-medium">{canManage ? "Receive & adjust" : "Consume only"}</p>
        </div>
      </div>

      <Card>
        <div className="px-4 pt-1">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "materials", label: "Materials" },
              { value: "ledger", label: "Ledger" },
              { value: "forecast", label: "Forecast" },
              { value: "alerts", label: "Alerts", count: alertItems.length },
            ]}
          />
        </div>

        {tab === "materials" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search materials or suppliers"
                  className="pl-8"
                  aria-label="Search materials"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5 text-xs font-medium text-ink-muted">
                <input
                  type="checkbox"
                  checked={lowOnly}
                  onChange={(event) => setLowOnly(event.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-600"
                />
                Low stock only
              </label>
            </div>

            {materials.isLoading ? (
              <SkeletonTable rows={6} />
            ) : materials.isError ? (
              <ErrorState message={errorMessage(materials.error)} onRetry={() => materials.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                title={search || lowOnly ? "No matching materials" : "No materials tracked"}
                description={search || lowOnly ? "Clear the filters to see all materials." : "Add materials to start a stock ledger."}
                icon={<Boxes className="h-5 w-5" />}
                action={
                  canManage ? (
                    <Button size="sm" onClick={() => setMaterialOpen(true)}>
                      <Plus className="h-4 w-4" /> New material
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="w-full min-w-[820px]">
                  <thead className="bg-paper/50">
                    <tr>
                      <th className="th">Material</th>
                      <th className="th">Category</th>
                      <th className="th text-right">In stock</th>
                      <th className="th text-right">Reorder at</th>
                      <th className="th">Status</th>
                      <th className="th text-right">Unit cost</th>
                      <th className="th text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((material) => {
                      const low = Number(material.current_stock) <= Number(material.reorder_level);
                      return (
                        <tr key={material.id} className="hover:bg-paper/40">
                          <td className="td">
                            <p className="font-medium">{material.name}</p>
                            <p className="text-[11px] text-ink-faint">{material.supplier || "Supplier not recorded"}</p>
                          </td>
                          <td className="td text-ink-muted">{titleCase(material.category)}</td>
                          <td className="td text-right">
                            <span className="mono-num font-semibold">{formatQty(material.current_stock)}</span>{" "}
                            <span className="text-[11px] text-ink-faint">{material.unit}</span>
                          </td>
                          <td className="td mono-num text-right text-ink-muted">{formatQty(material.reorder_level)}</td>
                          <td className="td">{low ? <Badge tone="warn">Low stock</Badge> : <Badge tone="ok">Healthy</Badge>}</td>
                          <td className="td mono-num text-right text-ink-muted">{formatMoneyMinor(material.unit_cost_minor)}</td>
                          <td className="td">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => openTransaction(material, "consumption")}>
                                <ArrowDownUp className="h-3.5 w-3.5" /> Move
                              </Button>
                              {canManage ? (
                                <Button size="sm" variant="ghost" onClick={() => openTransaction(material, "receipt")}>
                                  Receive
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {lowCount > 0 ? (
              <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">
                {lowCount} material{lowCount === 1 ? "" : "s"} at or below reorder level in the current view.
              </p>
            ) : null}
          </>
        ) : null}

        {tab === "ledger" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <Select
                value={ledgerType}
                onChange={(event) => setLedgerType(event.target.value)}
                className="max-w-[200px]"
                aria-label="Filter ledger by type"
              >
                <option value="">All movement types</option>
                {["opening", ...transactionTypes].map((type) => (
                  <option key={type} value={type}>{titleCase(type)}</option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" onClick={() => transactions.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              <p className="ml-auto text-[11px] text-ink-faint">Append-only. No edit or delete endpoints exist.</p>
            </div>
            {transactions.isLoading ? (
              <SkeletonTable rows={8} />
            ) : transactions.isError ? (
              <ErrorState message={errorMessage(transactions.error)} onRetry={() => transactions.refetch()} />
            ) : !(transactions.data?.items ?? []).length ? (
              <EmptyState title="No stock movements" description="Receipts and consumption will appear here." icon={<ArrowDownUp className="h-5 w-5" />} />
            ) : (
              <div className="table-wrap">
                <table className="w-full min-w-[820px]">
                  <thead className="bg-paper/50">
                    <tr>
                      <th className="th">When</th>
                      <th className="th">Material</th>
                      <th className="th">Type</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Before</th>
                      <th className="th text-right">After</th>
                      <th className="th">By</th>
                      <th className="th">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.data?.items.map((txn) => (
                      <tr key={String(txn.id)} className="hover:bg-paper/40">
                        <td className="td whitespace-nowrap text-xs text-ink-muted">{formatDateTime(txn.created_at)}</td>
                        <td className="td font-medium">{txn.material_name ?? "—"}</td>
                        <td className="td"><StatusBadge status={txn.type} /></td>
                        <td className="td mono-num text-right font-medium">
                          {formatQty(txn.quantity)} <span className="text-[10px] text-ink-faint">{txn.unit}</span>
                        </td>
                        <td className="td mono-num text-right text-ink-muted">{formatQty(txn.stock_before)}</td>
                        <td className="td mono-num text-right text-ink-muted">{formatQty(txn.stock_after)}</td>
                        <td className="td text-xs text-ink-muted">{txn.created_by_name ?? "—"}</td>
                        <td className="td max-w-[220px] truncate text-xs text-ink-faint">{txn.remarks || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}

        {tab === "forecast" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="text-xs text-ink-muted">
                Method: 90-day average usage and days of cover. A planning aid, not a validated prediction.
              </p>
              <Button size="sm" variant="outline" loading={explain.isPending} onClick={() => explain.mutate()}>
                <Sparkles className="h-3.5 w-3.5" /> Explain with AI
              </Button>
            </div>
            {forecast.isLoading ? (
              <SkeletonTable rows={6} />
            ) : forecast.isError ? (
              <ErrorState message={errorMessage(forecast.error)} onRetry={() => forecast.refetch()} />
            ) : !(forecast.data?.items ?? []).length ? (
              <EmptyState title="No forecast available" description="Add materials and record consumption first." />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="w-full min-w-[860px]">
                    <thead className="bg-paper/50">
                      <tr>
                        <th className="th">Material</th>
                        <th className="th text-right">Current</th>
                        <th className="th text-right">Avg / day</th>
                        <th className="th text-right">Days cover</th>
                        <th className="th text-right">Suggested reorder</th>
                        <th className="th">Confidence</th>
                        <th className="th">Explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.data?.items.map((item, index) => {
                        const key = item.material_id ?? item.id ?? item.name ?? String(index);
                        return (
                          <tr key={key} className="hover:bg-paper/40">
                            <td className="td font-medium">{item.name}</td>
                            <td className="td mono-num text-right">
                              {formatQty(item.current_stock)} <span className="text-[10px] text-ink-faint">{item.unit}</span>
                            </td>
                            <td className="td mono-num text-right text-ink-muted">{formatQty(item.daily_consumption)}</td>
                            <td className="td text-right">
                              {item.days_of_cover == null ? (
                                <span className="text-ink-faint">—</span>
                              ) : (
                                <Badge tone={item.days_of_cover < 7 ? "danger" : item.days_of_cover < 14 ? "warn" : "ok"}>
                                  {item.days_of_cover} days
                                </Badge>
                              )}
                            </td>
                            <td className="td mono-num text-right font-medium">{formatQty(item.suggested_reorder)}</td>
                            <td className="td"><Badge tone="neutral">{titleCase(item.confidence)}</Badge></td>
                            <td className="td max-w-[260px]">
                              {explained[key] ? (
                                <div>
                                  <p className="text-[11px] leading-relaxed text-ink-muted">{explained[key].explanation}</p>
                                  <MethodBadge method={explained[key].source} />
                                </div>
                              ) : (
                                <span className="text-[11px] text-ink-faint">Not explained</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">{forecast.data?.note}</p>
              </>
            )}
          </>
        ) : null}

        {tab === "alerts" ? (
          <>
            {alerts.isLoading ? (
              <SkeletonTable rows={4} />
            ) : alertItems.length === 0 ? (
              <EmptyState
                title="No replenishment alerts"
                description="Every material is above its reorder level."
                icon={<CheckCircle2 className="h-5 w-5" />}
              />
            ) : (
              <div className="divide-y divide-line">
                {alertItems.map((alert) => (
                  <div key={String(alert.material_id ?? alert.id ?? alert.name)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-[#F2DDB8] bg-[#FDF3E3] text-warn">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{alert.name}</p>
                        <p className="text-xs text-ink-muted">
                          {formatQty(alert.current_stock)} {alert.unit} left · reorder level {formatQty(alert.reorder_level)} ·{" "}
                          shortfall {formatQty(alert.shortfall)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={alert.severity === "critical" ? "danger" : "warn"}>{titleCase(alert.severity)}</Badge>
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const material = items.find((item) => item.id === (alert.material_id ?? alert.id));
                            if (material) openTransaction(material, "receipt");
                          }}
                        >
                          <PackagePlus className="h-3.5 w-3.5" /> Record receipt
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Ledger reconciliation</p>
                  <p className="text-xs text-ink-muted">Recomputes stock from every ledger entry and compares it with the material record.</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => reconcile.refetch()} loading={reconcile.isFetching}>
                  <RefreshCw className="h-3.5 w-3.5" /> Recheck
                </Button>
              </div>
              <div className="mt-2 space-y-1">
                {(reconcile.data?.items ?? []).map((row) => (
                  <div key={String(row.material_id ?? row.name)} className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">{row.name}</span>
                    <span className={row.consistent ? "text-ok" : "text-danger"}>
                      {row.consistent ? "Consistent" : `Mismatch: ledger ${row.ledger_stock} vs ${row.current_stock}`}
                    </span>
                  </div>
                ))}
                {reconcile.isLoading ? <p className="text-xs text-ink-faint">Checking…</p> : null}
              </div>
            </div>
          </>
        ) : null}
      </Card>

      <Dialog
        open={materialOpen}
        onClose={() => setMaterialOpen(false)}
        title="New material"
        description="Opening stock is recorded as the first ledger entry, not typed over later."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMaterialOpen(false)}>Cancel</Button>
            <Button loading={createMaterial.isPending} disabled={materialForm.name.trim().length < 2} onClick={() => createMaterial.mutate()}>
              Add material
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Material name" htmlFor="material-name" className="sm:col-span-2">
            <Input
              id="material-name"
              value={materialForm.name}
              onChange={(event) => setMaterialForm({ ...materialForm, name: event.target.value })}
              placeholder="e.g. Cat6 cable box"
            />
          </Field>
          <Field label="Category" htmlFor="material-category">
            <Select
              id="material-category"
              value={materialForm.category}
              onChange={(event) => setMaterialForm({ ...materialForm, category: event.target.value })}
            >
              {categories.map((category) => (
                <option key={category} value={category}>{titleCase(category)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Unit" htmlFor="material-unit">
            <Select
              id="material-unit"
              value={materialForm.unit}
              onChange={(event) => setMaterialForm({ ...materialForm, unit: event.target.value })}
            >
              {units.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </Select>
          </Field>
          <Field label="Opening stock" htmlFor="material-opening">
            <Input
              id="material-opening"
              type="number"
              min={0}
              step="0.001"
              value={materialForm.opening_stock}
              onChange={(event) => setMaterialForm({ ...materialForm, opening_stock: event.target.value })}
            />
          </Field>
          <Field label="Reorder level" htmlFor="material-reorder">
            <Input
              id="material-reorder"
              type="number"
              min={0}
              step="0.001"
              value={materialForm.reorder_level}
              onChange={(event) => setMaterialForm({ ...materialForm, reorder_level: event.target.value })}
            />
          </Field>
          <Field label="Supplier" htmlFor="material-supplier">
            <Input
              id="material-supplier"
              value={materialForm.supplier}
              onChange={(event) => setMaterialForm({ ...materialForm, supplier: event.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Field label="Unit cost (₹)" htmlFor="material-cost">
            <Input
              id="material-cost"
              type="number"
              min={0}
              step="0.01"
              value={materialForm.unit_cost}
              onChange={(event) => setMaterialForm({ ...materialForm, unit_cost: event.target.value })}
              placeholder="Optional"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(txMaterial)}
        onClose={() => setTxMaterial(null)}
        title="Record stock movement"
        description={txMaterial ? `${txMaterial.name} · currently ${formatQty(txMaterial.current_stock)} ${txMaterial.unit}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTxMaterial(null)}>Cancel</Button>
            <Button
              loading={transact.isPending}
              disabled={!txQty || Number(txQty) <= 0}
              onClick={() => transact.mutate()}
            >
              Record movement
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Movement type" htmlFor="tx-type">
            <Select
              id="tx-type"
              value={txType}
              onChange={(event) => {
                setTxType(event.target.value);
                setTxDirection(event.target.value === "adjustment" ? "decrease" : txDirection);
              }}
            >
              {transactionTypes.map((type) => (
                <option key={type} value={type} disabled={!canManage && type !== "consumption" && type !== "return"}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Quantity (${txMaterial?.unit ?? ""})`} htmlFor="tx-qty" hint="Consumption cannot take stock below zero.">
            <Input
              id="tx-qty"
              type="number"
              min={0.001}
              step="0.001"
              inputMode="decimal"
              value={txQty}
              onChange={(event) => setTxQty(event.target.value)}
              placeholder="0"
            />
          </Field>
          {txType === "adjustment" ? (
            <Field label="Direction" htmlFor="tx-direction" hint="A correction is a new ledger entry; history is never edited.">
              <Select
                id="tx-direction"
                value={txDirection}
                onChange={(event) => setTxDirection(event.target.value as "increase" | "decrease")}
              >
                <option value="increase">Increase stock</option>
                <option value="decrease">Decrease stock</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Remarks" htmlFor="tx-remarks">
            <Textarea
              id="tx-remarks"
              rows={2}
              value={txRemarks}
              onChange={(event) => setTxRemarks(event.target.value)}
              placeholder="Reference, delivery note or reason"
            />
          </Field>
          <p className="text-[10px] leading-relaxed text-ink-faint">
            Requests are applied with an atomic stock guard. Two simultaneous withdrawals can never oversell the same stock.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
