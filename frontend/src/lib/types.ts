export type Role = "project_manager" | "site_engineer" | "supervisor" | "storekeeper";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  description?: string;
  client_name: string;
  location: string;
  project_type: string;
  start_date: string;
  expected_end_date: string;
  actual_end_date?: string | null;
  status: string;
  progress_percent: number;
  delay_flag: boolean;
  delay_reason?: string | null;
  member_count?: number;
  open_issues?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Material {
  id: string;
  name: string;
  sku?: string | null;
  category: string;
  unit: string;
  current_stock: string;
  reorder_level: string;
  opening_stock: string;
  supplier?: string | null;
  unit_cost_minor?: number | null;
  is_low_stock: boolean;
  is_active: boolean;
  transactions?: InventoryTransaction[];
}

export interface InventoryTransaction {
  id: string;
  type: string;
  quantity: string;
  unit: string;
  stock_before: string;
  stock_after: string;
  remarks?: string | null;
  material_name?: string;
  created_by_name?: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  category: string;
  status: string;
  progress: number;
  weight: number;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  start_date: string;
  due_date: string;
  dependencies: string[];
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  severity: string;
  status: string;
  location?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  reported_by_name?: string;
  resolution_notes?: string | null;
  due_date?: string | null;
  created_at: string;
}

export interface DailyReport {
  id: string;
  report_date: string;
  location: string;
  activities: string;
  work_completed: string[];
  work_pending: string[];
  workers_present: { total: number | null; by_trade: Array<{ trade: string; count: number }> };
  materials_consumed: Array<{ name: string; quantity: string; unit: string }>;
  equipment_used: string[];
  delays?: string | null;
  safety_observations?: string | null;
  notes?: string | null;
  status: string;
  submitted_by_name: string;
  submitted_by?: string;
  rejection_reason?: string | null;
  photos?: Array<{ file_id?: string; filename?: string; mime?: string; size_bytes?: number }>;
  ai_summary?: string | null;
  ai_assisted?: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  vendor?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  verification_status: string;
  currency: string;
  extracted_items?: Array<{
    description: string;
    quantity?: string | null;
    unit?: string;
    unit_price_minor?: number | null;
    line_total_minor?: number | null;
  }>;
  computed?: { subtotal_minor: number | null; tax_minor: number | null; total_minor: number | null; line_totals_minor: Array<number | null> };
  stated?: { subtotal_minor: number | null; tax_minor: number | null; total_minor: number | null };
  discrepancies?: Array<{ code: string; field: string; expected: any; found: any; severity: string; message: string }>;
  ai_extraction?: { model?: string | null; method?: string; confidence?: string; warnings?: string[] } | null;
  verification?: { decision: string; notes?: string; by: string; at: string } | null;
  error?: { code: string; message: string } | null;
  file: { filename: string; mime: string; size_bytes: number; storage_key: string };
  uploaded_by_name?: string;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  filename: string;
  category: string;
  mime: string;
  size_bytes: number;
  processing_status: string;
  pages?: number | null;
  chunk_count?: number | null;
  embedding_provider?: string | null;
  error?: { code: string; message: string } | null;
  uploaded_by_name?: string;
  created_at: string;
}

export interface Citation {
  document_id: string;
  filename: string;
  page: number;
  chunk_index: number;
  excerpt: string;
  score: number;
}

export interface AiStatus {
  mode: "groq" | "local" | "disabled";
  provider: string;
  model: string | null;
  enabled: boolean;
}
