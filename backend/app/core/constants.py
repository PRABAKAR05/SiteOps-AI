ROLES = ["project_manager", "site_engineer", "supervisor", "storekeeper"]

PROJECT_TYPES = [
    "interior", "auditorium", "electrical", "cctv", "fire_alarm",
    "av", "networking", "bms", "mixed",
]
PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"]

TASK_STATUSES = ["not_started", "in_progress", "blocked", "completed", "cancelled"]

REPORT_STATUSES = ["draft", "submitted", "approved", "rejected"]

ISSUE_CATEGORIES = [
    "electrical", "cctv", "fire_safety", "av", "acoustic", "networking",
    "bms", "civil", "material_shortage", "equipment_failure", "other",
]
ISSUE_PRIORITIES = ["low", "medium", "high", "critical"]
ISSUE_SEVERITIES = ["minor", "moderate", "major", "safety"]
ISSUE_STATUSES = ["open", "assigned", "in_progress", "waiting", "resolved", "closed"]

ISSUE_TRANSITIONS = {
    "open": {"assigned", "in_progress", "waiting", "resolved"},
    "assigned": {"in_progress", "waiting", "open", "resolved"},
    "in_progress": {"waiting", "resolved"},
    "waiting": {"in_progress", "resolved", "open"},
    "resolved": {"closed", "in_progress"},
    "closed": set(),
}

MATERIAL_CATEGORIES = [
    "electrical", "cctv", "networking", "fire_safety", "av", "acoustic",
    "civil", "bms", "consumables", "other",
]
UNITS = ["pcs", "m", "box", "roll", "kg", "ltr", "set", "sqm"]
TRANSACTION_TYPES = ["opening", "receipt", "consumption", "return", "wastage", "adjustment"]

INVOICE_STATUSES = [
    "uploaded", "extracting", "extracted", "needs_review",
    "verified", "rejected", "failed",
]

DOCUMENT_STATUSES = ["uploaded", "processing", "ready", "failed"]
DOCUMENT_CATEGORIES = ["specification", "manual", "drawing", "procedure", "contract", "other"]

TASK_CATEGORIES = ISSUE_CATEGORIES + ["procurement", "commissioning"]

ALLOWED_UPLOAD_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "text/plain": "txt",
    "text/markdown": "md",
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
}
