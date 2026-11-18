"""Deterministic fallbacks used when no LLM is configured.

These are explicitly labeled as rules, never as AI. They only restate facts that
appear in the input; anything not stated stays empty.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from app.utils.text import first_sentences, numbers_in

CATEGORY_KEYWORDS = {
    "cctv": ["cctv", "camera", "nvr", "dvr", "surveillance"],
    "electrical": ["electrical", "cable", "wiring", "panel", "db", "breaker", "power", "voltage", "shock", "light"],
    "fire_safety": ["fire", "smoke", "alarm", "sprinkler", "detector"],
    "av": ["speaker", "amplifier", "audio", "projector", "display", "microphone", "av "],
    "acoustic": ["acoustic", "soundproof", "sound proof", "panel install"],
    "networking": ["network", "switch", "lan", "cat6", "router", "wifi", "rack"],
    "bms": ["bms", "automation", "sensor", "hvac"],
    "civil": ["wall", "ceiling", "paint", "floor", "tile", "civil"],
    "material_shortage": ["shortage", "out of stock", "not delivered", "missing material"],
    "equipment_failure": ["not working", "failure", "broken", "faulty", "dead"],
}

_PENDING = ("pending", "remaining", "not completed", "balance work", "left")
_DONE = ("completed", "installed", "finished", "done", "pulled", "mounted", "tested")
_DELAY = ("delay", "stopped", "late", "hold", "waiting for", "idle")
_SAFETY = ("safety", "harness", "helmet", "injury", "hazard", "ppe")


def structure_report(notes: str, today: date) -> tuple[dict, list[str]]:
    sentences = first_sentences(notes, limit=12)
    completed, pending, delays, safety = [], [], [], []
    warnings: list[str] = []
    for sentence in sentences:
        low = sentence.lower()
        if any(k in low for k in _DELAY):
            delays.append(sentence)
        elif any(k in low for k in _SAFETY):
            safety.append(sentence)
        elif any(k in low for k in _PENDING):
            pending.append(sentence)
        elif any(k in low for k in _DONE):
            completed.append(sentence)
        else:
            completed.append(sentence)

    workers = None
    match = re.search(r"(\d{1,3})\s*(?:workers|labourers|laborers|people|technicians|helpers)", notes, re.I)
    if match:
        workers = int(match.group(1))
    else:
        warnings.append("Worker count was not stated in the notes.")

    proposal = {
        "work_completed": completed[:10],
        "work_pending": pending[:10],
        "workers_present": {"total": workers, "by_trade": []},
        "materials_consumed": [],
        "delays": delays[0] if delays else None,
        "safety_observations": safety[0] if safety else None,
        "next_day_recommendations": [],
        "summary": " ".join(sentences[:3])[:600],
    }
    warnings.append("Structured with local rules because no LLM is configured.")
    return proposal, warnings


def classify_issue(title: str, description: str) -> dict:
    text = f"{title} {description}".lower()
    scores = {cat: sum(1 for k in keys if k in text) for cat, keys in CATEGORY_KEYWORDS.items()}
    category = max(scores, key=scores.get) if max(scores.values(), default=0) > 0 else "other"
    critical_terms = ("fire", "smoke", "shock", "live wire", "collapse", "injury", "gas leak")
    high_terms = ("leak", "not working", "failure", "blocked", "short circuit", "no power")
    safety_flag = any(t in text for t in critical_terms + ("harness", "hazard", "safety"))
    if any(t in text for t in critical_terms):
        priority, severity = "critical", "safety"
    elif any(t in text for t in high_terms):
        priority, severity = "high", "major"
    elif any(t in text for t in ("minor", "cosmetic", "paint patch")):
        priority, severity = "low", "minor"
    else:
        priority, severity = "medium", "moderate"
    return {
        "category": category,
        "priority": priority,
        "severity": severity,
        "impact": "Requires site review; derived from the stated description using local rules.",
        "next_action": "Assign a qualified team member to inspect and confirm the issue on site.",
        "confidence": "low",
        "safety_flag": safety_flag,
        "method": "rules",
    }


def extract_invoice(text: str) -> dict:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    vendor = lines[0][:120] if lines else None
    number = None
    inv_match = re.search(r"invoice\s*(?:no|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})", text, re.I)
    if inv_match:
        number = inv_match.group(1).strip()
    po_match = re.search(r"\bPO[\s\-_#:]*([A-Z0-9\-]{3,})", text, re.I)
    po_number = po_match.group(1) if po_match else None
    date_value = None
    date_match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if date_match:
        date_value = date_match.group(1)
    else:
        dmy = re.search(r"(\d{2})[\/\-](\d{2})[\/\-](\d{4})", text)
        if dmy:
            date_value = f"{dmy.group(3)}-{dmy.group(2)}-{dmy.group(1)}"

    items = []
    for line in lines:
        parts = [p.strip() for p in re.split(r"\s*[|;]\s*", line)]
        if len(parts) >= 4:
            qty = _dec(parts[1])
            unit_price = _dec(parts[2])
            total = _dec(parts[3])
            if qty is not None and unit_price is not None:
                items.append({
                    "description": parts[0][:160],
                    "quantity": str(qty),
                    "unit": "pcs",
                    "unit_price": str(unit_price),
                    "line_total": str(total) if total is not None else None,
                })

    subtotal = _money_after(text, r"sub\s*total")
    tax = _money_after(text, r"(?:gst|tax|vat)")
    total = _money_after(text, r"(?<!sub)(?:grand\s*)?total")
    return {
        "vendor": vendor,
        "invoice_number": number,
        "invoice_date": date_value,
        "po_number": po_number,
        "items": items,
        "stated_subtotal": subtotal,
        "stated_tax": tax,
        "stated_total": total,
        "confidence": "low",
        "method": "rules",
        "warnings": ["Extracted with local rules because no LLM is configured."]
        if items or total else
        ["No structured items were detected; enter the invoice manually."],
    }


def _dec(value: str):
    cleaned = re.sub(r"[^\d.\-]", "", value or "")
    try:
        return Decimal(cleaned) if cleaned not in ("", "-", ".") else None
    except InvalidOperation:
        return None


def _money_after(text: str, label: str):
    match = re.search(label + r"[^\d]{0,20}([\d,]+(?:\.\d{1,2})?)", text, re.I)
    if not match:
        return None
    try:
        return str(Decimal(match.group(1).replace(",", "")))
    except InvalidOperation:
        return None


def narrate_summary(stats: dict, project_name: str, date_from: str, date_to: str) -> str:
    return (
        f"Between {date_from} and {date_to}, {project_name} recorded {stats.get('reports', 0)} daily reports "
        f"({stats.get('approved', 0)} approved, {stats.get('pending', 0)} awaiting approval). "
        f"Worker-days totalled {stats.get('worker_days', 0)}. "
        f"{stats.get('delays_reported', 0)} report(s) mentioned delays. "
        "This summary is generated from the recorded numbers only; no narrative model was configured."
    )


def answer_from_records(question: str, rows: list[dict]) -> str:
    if not rows:
        return "No matching records were found for this project."
    lines = []
    for row in rows[:12]:
        label = row.get("label", "Record")
        detail = row.get("detail", "")
        lines.append(f"- {label}: {detail}".rstrip(": "))
    return "Based on the project records:\n" + "\n".join(lines)


def explain_forecast(item: dict) -> str:
    return (
        f"{item['material']['name']}: {item['reason']} "
        f"Suggested reorder quantity is {item['suggested_reorder']} {item['material']['unit']} "
        f"for a {item['horizon_days']}-day horizon. This is a rule-based estimate."
    )


def explain_risk(factors: list[dict], band: str, score: int) -> str:
    top = sorted(factors, key=lambda f: f["weight"] * f["value"], reverse=True)[:3]
    parts = [f"{f['name'].replace('_', ' ')} ({round(f['value'] * 100)}% of its weight)" for f in top]
    return (
        f"The rule-based delay risk score is {score}/100 ({band}). "
        f"The largest contributing factors are: {', '.join(parts) if parts else 'none'}. "
        "This is a heuristic, not a validated prediction."
    )


def summarize_invoice_checks(discrepancies: list[dict]) -> str:
    if not discrepancies:
        return "No arithmetic or purchase-order discrepancies were detected."
    return f"{len(discrepancies)} discrepancy(ies) need review: " + "; ".join(d["message"] for d in discrepancies[:3])


def provenance_numbers(text: str) -> set[str]:
    return numbers_in(text)
