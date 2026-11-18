"""Index specifications and idempotent creation.

Declared as data so tests can assert the live database matches the design.
"""

from pymongo import ASCENDING, DESCENDING, TEXT
from pymongo.database import Database

A = ASCENDING
D = DESCENDING

INDEX_SPECS: list[dict] = [
    # users
    {"collection": "users", "name": "ux_email", "keys": [("email", A)], "unique": True},
    {"collection": "users", "name": "ix_role_active", "keys": [("role", A), ("is_active", A)]},
    # projects
    {"collection": "projects", "name": "ux_code", "keys": [("code", A)], "unique": True},
    {"collection": "projects", "name": "ix_manager_status", "keys": [("manager_id", A), ("status", A)]},
    {"collection": "projects", "name": "ix_status_end", "keys": [("status", A), ("expected_end_date", A)]},
    # members
    {"collection": "project_members", "name": "ux_project_user", "keys": [("project_id", A), ("user_id", A)], "unique": True},
    {"collection": "project_members", "name": "ix_user_project", "keys": [("user_id", A), ("project_id", A)]},
    # tasks
    {"collection": "tasks", "name": "ix_tasks_project_status_due", "keys": [("project_id", A), ("status", A), ("due_date", A)]},
    {"collection": "tasks", "name": "ix_tasks_project_assignee", "keys": [("project_id", A), ("assigned_to", A)]},
    {"collection": "tasks", "name": "ix_tasks_project_category", "keys": [("project_id", A), ("category", A)]},
    # reports
    {"collection": "daily_reports", "name": "ix_reports_project_date", "keys": [("project_id", A), ("report_date", D)]},
    {"collection": "daily_reports", "name": "ix_reports_project_status", "keys": [("project_id", A), ("status", A), ("submitted_at", D)]},
    {"collection": "daily_reports", "name": "ix_reports_author", "keys": [("submitted_by", A), ("created_at", D)]},
    # materials
    {"collection": "materials", "name": "ux_material_project_name", "keys": [("project_id", A), ("name", A)], "unique": True},
    {"collection": "materials", "name": "ix_materials_project_category", "keys": [("project_id", A), ("category", A)]},
    {"collection": "materials", "name": "ix_materials_stock", "keys": [("project_id", A), ("current_stock", A), ("reorder_level", A)]},
    # inventory transactions
    {"collection": "inventory_transactions", "name": "ix_txn_material_time", "keys": [("project_id", A), ("material_id", A), ("created_at", D)]},
    {"collection": "inventory_transactions", "name": "ix_txn_project_time", "keys": [("project_id", A), ("created_at", D)]},
    {"collection": "inventory_transactions", "name": "ix_txn_reference", "keys": [("reference_type", A), ("reference_id", A)]},
    # issues
    {"collection": "site_issues", "name": "ix_issues_project_status_priority", "keys": [("project_id", A), ("status", A), ("priority", D)]},
    {"collection": "site_issues", "name": "ix_issues_project_assignee", "keys": [("project_id", A), ("assigned_to", A), ("status", A)]},
    {"collection": "site_issues", "name": "ix_issues_project_category", "keys": [("project_id", A), ("category", A)]},
    # purchase orders
    {"collection": "purchase_orders", "name": "ux_po_project_number", "keys": [("project_id", A), ("po_number", A)], "unique": True},
    # invoices
    {"collection": "invoices", "name": "ix_invoices_project_status", "keys": [("project_id", A), ("verification_status", A), ("created_at", D)]},
    {"collection": "invoices", "name": "ix_invoices_project_number", "keys": [("project_id", A), ("invoice_number", A)]},
    {"collection": "invoices", "name": "ix_invoices_project_po", "keys": [("project_id", A), ("purchase_order_id", A)]},
    # documents
    {"collection": "documents", "name": "ux_documents_project_sha", "keys": [("project_id", A), ("sha256", A)], "unique": True},
    {"collection": "documents", "name": "ix_documents_project_created", "keys": [("project_id", A), ("created_at", D)]},
    {"collection": "documents", "name": "ix_documents_project_status", "keys": [("project_id", A), ("processing_status", A)]},
    # chunks
    {"collection": "document_chunks", "name": "ux_chunk_doc_index", "keys": [("document_id", A), ("chunk_index", A)], "unique": True},
    {"collection": "document_chunks", "name": "ix_chunks_project_doc", "keys": [("project_id", A), ("document_id", A)]},
    # vectors (Mongo fallback store for embeddings)
    {"collection": "document_vectors", "name": "ix_vectors_project_doc", "keys": [("project_id", A), ("document_id", A)]},
    {"collection": "document_pages", "name": "ix_pages_doc_page", "keys": [("document_id", A), ("page", A)]},
    # auth
    {"collection": "refresh_tokens", "name": "ux_refresh_jti", "keys": [("jti", A)], "unique": True},
    {"collection": "refresh_tokens", "name": "ix_refresh_user", "keys": [("user_id", A)]},
    {"collection": "refresh_tokens", "name": "ttl_refresh", "keys": [("expires_at", A)], "ttl": 0},
    # ops
    {"collection": "notifications", "name": "ix_notif_user", "keys": [("user_id", A), ("read_at", A), ("created_at", D)]},
    {"collection": "notifications", "name": "ttl_notif", "keys": [("created_at", A)], "ttl": 90 * 24 * 3600},
    {"collection": "ai_logs", "name": "ix_ai_project_feature", "keys": [("project_id", A), ("feature", A), ("created_at", D)]},
    {"collection": "ai_logs", "name": "ix_ai_user", "keys": [("user_id", A), ("created_at", D)]},
    {"collection": "ai_logs", "name": "ttl_ai_logs", "keys": [("created_at", A)], "ttl": 180 * 24 * 3600},
    {"collection": "audit_logs", "name": "ix_audit_entity", "keys": [("entity_type", A), ("entity_id", A), ("created_at", D)]},
    {"collection": "audit_logs", "name": "ix_audit_actor", "keys": [("actor_id", A), ("created_at", D)]},
    {"collection": "audit_logs", "name": "ttl_audit", "keys": [("created_at", A)], "ttl": 365 * 24 * 3600},
]


def ensure_indexes(db: Database) -> list[str]:
    created: list[str] = []
    for spec in INDEX_SPECS:
        coll = db[spec["collection"]]
        kwargs: dict = {"name": spec["name"], "unique": spec.get("unique", False)}
        if spec.get("ttl") is not None:
            kwargs["expireAfterSeconds"] = spec["ttl"]
        coll.create_index(spec["keys"], **kwargs)
        created.append(f"{spec['collection']}.{spec['name']}")
    return created


def index_names(db: Database) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for spec in INDEX_SPECS:
        coll = db[spec["collection"]]
        result[spec["collection"]] = set(coll.index_information().keys())
    return result
