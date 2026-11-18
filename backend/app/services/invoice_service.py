from decimal import Decimal, InvalidOperation

from bson import ObjectId

from app.ai import service as ai_service
from app.ai.ocr import extract_text
from app.core.errors import AppError, forbidden, not_found
from app.core.permissions import role_has
from app.database.mongo import get_db
from app.services import audit, notify
from app.services.project_service import ProjectContext
from app.utils.dates import oid, utcnow
from app.utils.files import resolve_storage_path, save_bytes
from app.utils.serialize import entity, page


def _to_minor(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int((Decimal(str(value)).quantize(Decimal("0.01"))) * 100)
    except (InvalidOperation, ValueError):
        return None


def _to_dec(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def upload(ctx: ProjectContext, content: bytes, filename: str, po_id: str | None = None) -> dict:
    if not role_has(ctx.role, "invoice:upload"):
        raise forbidden()
    stored = save_bytes(content, filename, str(ctx.project_id), "invoice", 10)
    db = get_db()
    if po_id:
        po = db.purchase_orders.find_one({"_id": oid(po_id), "project_id": ctx.project_id})
        if not po:
            raise AppError("VALIDATION_ERROR", "Purchase order not found in this project.", 422)
    now = utcnow()
    doc = {
        "project_id": ctx.project_id,
        "vendor": None,
        "invoice_number": None,
        "invoice_date": None,
        "purchase_order_id": oid(po_id) if po_id else None,
        "file": {k: stored[k] for k in ("file_id", "storage_key", "filename", "mime", "size_bytes", "sha256")},
        "extracted_items": [],
        "ai_extraction": None,
        "stated": {"subtotal_minor": None, "tax_minor": None, "total_minor": None},
        "computed": {"line_totals_minor": [], "subtotal_minor": None, "tax_minor": None, "total_minor": None},
        "discrepancies": [],
        "currency": "INR",
        "verification_status": "uploaded",
        "verification": None,
        "error": None,
        "uploaded_by": ctx.user["_id"],
        "created_at": now,
        "updated_at": now,
    }
    result = db.invoices.insert_one(doc)
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action="invoice.upload",
                 entity_type="invoice", entity_id=result.inserted_id, after={"filename": stored["filename"]})
    return get_invoice(ctx, str(result.inserted_id))


def get_invoice(ctx: ProjectContext, invoice_id: str) -> dict:
    db = get_db()
    doc = db.invoices.find_one({"_id": oid(invoice_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Invoice")
    data = entity(doc)
    uploader = db.users.find_one({"_id": doc["uploaded_by"]}, {"name": 1})
    verifier = db.users.find_one({"_id": doc["verification"]["by"]}, {"name": 1}) if doc.get("verification") else None
    data["uploaded_by_name"] = uploader["name"] if uploader else "Unknown"
    data["verified_by_name"] = verifier["name"] if verifier else None
    data["file_url"] = f"/api/v1/invoices/{invoice_id}/file"
    return data


def list_invoices(ctx: ProjectContext, *, status: str | None, q: str | None, page_no: int, page_size: int) -> dict:
    db = get_db()
    query: dict = {"project_id": ctx.project_id}
    if status:
        query["verification_status"] = status
    if q:
        query["$or"] = [{"vendor": {"$regex": q, "$options": "i"}},
                        {"invoice_number": {"$regex": q, "$options": "i"}}]
    total = db.invoices.count_documents(query)
    docs = db.invoices.find(query).sort("created_at", -1).skip((page_no - 1) * page_size).limit(page_size)
    items = []
    for doc in docs:
        item = entity(doc)
        item.pop("ai_extraction", None)
        item.pop("extracted_items", None)
        uploader = db.users.find_one({"_id": doc["uploaded_by"]}, {"name": 1})
        item["uploaded_by_name"] = uploader["name"] if uploader else "Unknown"
        items.append(item)
    return page(items, total, page_no, page_size)


def extract_invoice(ctx: ProjectContext, invoice_id: str) -> dict:
    if not role_has(ctx.role, "invoice:upload"):
        raise forbidden()
    db = get_db()
    doc = db.invoices.find_one({"_id": oid(invoice_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Invoice")
    if doc["verification_status"] in {"verified", "rejected"}:
        raise AppError("CONFLICT", "Verified or rejected invoices cannot be re-extracted.", 409)

    db.invoices.update_one({"_id": doc["_id"]}, {"$set": {"verification_status": "extracting", "updated_at": utcnow()}})
    try:
        raw_text = extract_text(resolve_storage_path(doc["file"]["storage_key"]))
    except AppError:
        raise
    except Exception as exc:
        _fail(doc, "INVOICE_UNREADABLE", f"Could not read the file: {exc}")
        raise AppError("INVOICE_UNREADABLE", "The invoice file could not be read.", 422)

    if len(raw_text.strip()) < 30:
        _fail(doc, "INVOICE_UNREADABLE", "No readable text was found in the upload.")
        raise AppError("INVOICE_UNREADABLE", "No readable text was found. Upload a clearer scan or enter details manually.", 422)

    try:
        parsed = ai_service.extract_invoice(raw_text, ctx.project_id, ctx.user["_id"])
        normalized = _normalize(parsed)
    except AppError as exc:
        _fail(doc, "AI_EXTRACTION_FAILED", exc.message)
        raise
    except Exception:
        _fail(doc, "AI_EXTRACTION_FAILED", "Unexpected extraction failure.")
        raise AppError("AI_INVALID_OUTPUT", "Invoice extraction failed validation.", 502)

    computed = _compute(normalized["items"])
    stated = {
        "subtotal_minor": _to_minor(normalized.get("stated_subtotal")),
        "tax_minor": _to_minor(normalized.get("stated_tax")),
        "total_minor": _to_minor(normalized.get("stated_total")),
    }
    discrepancies = _build_discrepancies(normalized["items"], computed, stated)
    po = _match_po(ctx, doc, normalized.get("po_number"))
    if po:
        discrepancies.extend(_compare_po(po, normalized["items"]))
    if normalized.get("invoice_number"):
        duplicate = db.invoices.find_one({
            "project_id": ctx.project_id,
            "invoice_number": normalized["invoice_number"],
            "_id": {"$ne": doc["_id"]},
        })
        if duplicate:
            discrepancies.append({
                "code": "DUPLICATE_INVOICE_NUMBER", "field": "invoice_number",
                "expected": None, "found": normalized["invoice_number"], "severity": "medium",
                "message": "Another invoice in this project uses the same invoice number.",
            })

    status = "needs_review" if discrepancies or normalized["confidence"] != "high" else "extracted"
    db.invoices.update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "vendor": normalized.get("vendor"),
            "invoice_number": normalized.get("invoice_number"),
            "invoice_date": normalized.get("invoice_date"),
            "purchase_order_id": po["_id"] if po else doc.get("purchase_order_id"),
            "extracted_items": normalized["items"],
            "ai_extraction": {
                "model": parsed.get("model"),
                "method": parsed.get("method", "rules"),
                "prompt_version": "invoice.v1",
                "confidence": normalized["confidence"],
                "warnings": parsed.get("warnings", []),
            },
            "computed": computed,
            "stated": stated,
            "discrepancies": discrepancies,
            "verification_status": status,
            "raw_text_chars": len(raw_text),
            "raw_text": raw_text[:20000],
            "error": None,
            "updated_at": utcnow(),
        }},
    )
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action="invoice.extract",
                 entity_type="invoice", entity_id=doc["_id"], after={"status": status, "discrepancies": len(discrepancies)})
    return get_invoice(ctx, invoice_id)


def _normalize(parsed: dict) -> dict:
    items = []
    for raw in parsed.get("items") or []:
        qty = _to_dec(raw.get("quantity"))
        unit_price = _to_minor(raw.get("unit_price"))
        line_total = _to_minor(raw.get("line_total"))
        if not raw.get("description"):
            continue
        items.append({
            "description": str(raw["description"])[:160],
            "quantity": format(qty, "f") if qty is not None else None,
            "unit": str(raw.get("unit") or "pcs")[:12],
            "unit_price_minor": unit_price,
            "line_total_minor": line_total,
        })
    invoice_date = parsed.get("invoice_date")
    if isinstance(invoice_date, str) and len(invoice_date) < 10:
        invoice_date = None
    return {
        "vendor": parsed.get("vendor"),
        "invoice_number": parsed.get("invoice_number"),
        "invoice_date": invoice_date,
        "po_number": parsed.get("po_number"),
        "items": items,
        "stated_subtotal": parsed.get("stated_subtotal"),
        "stated_tax": parsed.get("stated_tax"),
        "stated_total": parsed.get("stated_total"),
        "confidence": parsed.get("confidence") if parsed.get("confidence") in {"low", "medium", "high"} else "low",
    }


def _compute(items: list[dict]) -> dict:
    totals = []
    subtotal = 0
    for item in items:
        qty = _to_dec(item.get("quantity"))
        price = item.get("unit_price_minor")
        if qty is not None and price is not None:
            line = int((qty * Decimal(price)).quantize(Decimal("1")))
        else:
            line = item.get("line_total_minor")
        totals.append(line)
        if line:
            subtotal += line
    tax = None
    return {"line_totals_minor": totals, "subtotal_minor": subtotal, "tax_minor": tax, "total_minor": subtotal}


def _build_discrepancies(items: list[dict], computed: dict, stated: dict) -> list[dict]:
    out: list[dict] = []
    for index, (item, line) in enumerate(zip(items, computed["line_totals_minor"])):
        printed = item.get("line_total_minor")
        if printed is not None and line is not None and printed != line:
            out.append({
                "code": "LINE_TOTAL_MISMATCH", "field": f"items[{index}].line_total",
                "expected": line, "found": printed, "severity": "high",
                "message": f"Line {index + 1} total {_fmt(printed)} does not match quantity × unit price ({_fmt(line)}).",
            })
    if stated["subtotal_minor"] is not None and computed["subtotal_minor"] is not None \
            and stated["subtotal_minor"] != computed["subtotal_minor"]:
        out.append({
            "code": "SUBTOTAL_MISMATCH", "field": "stated_subtotal",
            "expected": computed["subtotal_minor"], "found": stated["subtotal_minor"], "severity": "high",
            "message": f"Stated subtotal {_fmt(stated['subtotal_minor'])} differs from the computed subtotal {_fmt(computed['subtotal_minor'])}.",
        })
    if stated["total_minor"] is not None and computed["subtotal_minor"] and \
            stated["total_minor"] < computed["subtotal_minor"]:
        out.append({
            "code": "TOTAL_BELOW_SUBTOTAL", "field": "stated_total",
            "expected": computed["subtotal_minor"], "found": stated["total_minor"], "severity": "high",
            "message": "Invoice total is lower than the sum of its line items.",
        })
    if not items:
        out.append({
            "code": "NO_ITEMS_EXTRACTED", "field": "items", "expected": None, "found": None,
            "severity": "medium", "message": "No line items were extracted; verify the invoice manually.",
        })
    return out


def _match_po(ctx: ProjectContext, invoice: dict, po_number: str | None):
    db = get_db()
    if invoice.get("purchase_order_id"):
        return db.purchase_orders.find_one({"_id": invoice["purchase_order_id"], "project_id": ctx.project_id})
    if po_number:
        return db.purchase_orders.find_one({"po_number": po_number, "project_id": ctx.project_id})
    return None


def _compare_po(po: dict, items: list[dict]) -> list[dict]:
    out: list[dict] = []
    po_items = {str(i.get("description", "")).strip().lower(): i for i in po.get("items", [])}
    seen = set()
    for item in items:
        key = item["description"].strip().lower()
        match = po_items.get(key)
        if not match:
            out.append({
                "code": "ITEM_NOT_ON_PO", "field": "items", "expected": None, "found": item["description"],
                "severity": "medium", "message": f"'{item['description']}' does not appear on {po['po_number']}.",
            })
            continue
        seen.add(key)
        po_qty = _to_dec(match.get("quantity"))
        inv_qty = _to_dec(item.get("quantity"))
        if po_qty is not None and inv_qty is not None and po_qty != inv_qty:
            out.append({
                "code": "QUANTITY_MISMATCH", "field": f"items.{item['description']}.quantity",
                "expected": format(po_qty, "f"), "found": format(inv_qty, "f"), "severity": "high",
                "message": f"Quantity for '{item['description']}' differs from {po['po_number']}.",
            })
        po_price = match.get("unit_price_minor")
        inv_price = item.get("unit_price_minor")
        if po_price is not None and inv_price is not None and po_price != inv_price:
            out.append({
                "code": "PRICE_MISMATCH", "field": f"items.{item['description']}.unit_price",
                "expected": po_price, "found": inv_price, "severity": "high",
                "message": f"Unit price for '{item['description']}' differs from {po['po_number']}.",
            })
    for key, po_item in po_items.items():
        if key not in seen:
            out.append({
                "code": "PO_ITEM_MISSING", "field": "items", "expected": po_item.get("description"),
                "found": None, "severity": "medium",
                "message": f"'{po_item.get('description')}' is on {po['po_number']} but missing from the invoice.",
            })
    return out


def verify(ctx: ProjectContext, invoice_id: str, decision: str, notes: str | None, corrected: dict | None) -> dict:
    if not role_has(ctx.role, "invoice:verify"):
        raise forbidden()
    db = get_db()
    doc = db.invoices.find_one({"_id": oid(invoice_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Invoice")
    if doc["verification_status"] not in {"extracted", "needs_review"}:
        raise AppError("CONFLICT", "Only extracted invoices can be verified or rejected.", 409)

    update: dict = {
        "verification_status": decision,
        "verification": {
            "decision": decision,
            "notes": (notes or "")[:1000],
            "by": ctx.user["_id"],
            "at": utcnow(),
            "field_snapshot": {
                "vendor": doc.get("vendor"),
                "invoice_number": doc.get("invoice_number"),
                "computed_total_minor": (doc.get("computed") or {}).get("total_minor"),
                "stated_total_minor": (doc.get("stated") or {}).get("total_minor"),
            },
        },
        "updated_at": utcnow(),
    }
    if corrected:
        update["vendor"] = corrected.get("vendor", doc.get("vendor"))
        update["invoice_number"] = corrected.get("invoice_number", doc.get("invoice_number"))
    db.invoices.update_one({"_id": doc["_id"]}, {"$set": update})
    notify.create(
        user_id=doc["uploaded_by"], title=f"Invoice {decision}",
        body=f"Invoice {doc.get('invoice_number') or doc['file']['filename']} was {decision}.",
        type_="invoice_verified", project_id=ctx.project_id, link=f"/invoices/{invoice_id}",
    )
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action=f"invoice.{decision}",
                 entity_type="invoice", entity_id=doc["_id"],
                 before=update["verification"]["field_snapshot"], after={"decision": decision})
    return get_invoice(ctx, invoice_id)


def _fail(doc: dict, code: str, message: str) -> None:
    get_db().invoices.update_one(
        {"_id": doc["_id"]},
        {"$set": {"verification_status": "failed", "error": {"code": code, "message": message}, "updated_at": utcnow()}},
    )


def _fmt(minor: int | None) -> str:
    return f"₹{minor / 100:,.2f}" if minor is not None else "—"
