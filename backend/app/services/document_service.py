from bson import ObjectId

from app.ai import rag
from app.ai import service as ai_service
from app.ai.ocr import extract_pages
from app.core.config import settings
from app.core.errors import AppError, forbidden, not_found
from app.core.permissions import role_has
from app.database.mongo import get_db
from app.services import audit
from app.services.project_service import ProjectContext
from app.utils.dates import oid, utcnow
from app.utils.files import delete_storage, resolve_storage_path, save_bytes
from app.utils.serialize import entity, page
from app.utils.text import chunk_text


def upload(ctx: ProjectContext, content: bytes, filename: str, category: str = "other") -> dict:
    if not role_has(ctx.role, "document:upload"):
        raise forbidden()
    stored = save_bytes(content, filename, str(ctx.project_id), "document", settings.max_document_mb)
    db = get_db()
    existing = db.documents.find_one({"project_id": ctx.project_id, "sha256": stored["sha256"]})
    if existing:
        raise AppError("CONFLICT", "This document is already uploaded to the project.", 409,
                       [{"field": "file", "issue": str(existing["_id"])}])
    now = utcnow()
    doc = {
        "project_id": ctx.project_id,
        "filename": stored["filename"],
        "storage_key": stored["storage_key"],
        "mime": stored["mime"],
        "size_bytes": stored["size_bytes"],
        "sha256": stored["sha256"],
        "category": category,
        "processing_status": "uploaded",
        "pages": None,
        "chunk_count": None,
        "embedding_provider": None,
        "chroma_collection": f"proj_{ctx.project_id}",
        "error": None,
        "uploaded_by": ctx.user["_id"],
        "created_at": now,
        "updated_at": now,
    }
    result = db.documents.insert_one(doc)
    return get_document(ctx, str(result.inserted_id))


def list_documents(ctx: ProjectContext, *, status: str | None, category: str | None, page_no: int, page_size: int) -> dict:
    db = get_db()
    query: dict = {"project_id": ctx.project_id}
    if status:
        query["processing_status"] = status
    if category:
        query["category"] = category
    total = db.documents.count_documents(query)
    docs = db.documents.find(query).sort("created_at", -1).skip((page_no - 1) * page_size).limit(page_size)
    items = []
    for doc in docs:
        item = entity(doc)
        uploader = db.users.find_one({"_id": doc["uploaded_by"]}, {"name": 1})
        item["uploaded_by_name"] = uploader["name"] if uploader else "Unknown"
        items.append(item)
    return page(items, total, page_no, page_size)


def get_document(ctx: ProjectContext, document_id: str) -> dict:
    db = get_db()
    doc = db.documents.find_one({"_id": oid(document_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Document")
    data = entity(doc)
    uploader = db.users.find_one({"_id": doc["uploaded_by"]}, {"name": 1})
    data["uploaded_by_name"] = uploader["name"] if uploader else "Unknown"
    return data


def process_document(document_id: str) -> None:
    """Background job: extract pages, chunk, embed, store vectors."""
    db = get_db()
    doc = db.documents.find_one({"_id": ObjectId(document_id)})
    if not doc:
        return
    db.documents.update_one({"_id": doc["_id"]}, {"$set": {"processing_status": "processing", "updated_at": utcnow()}})
    try:
        path = resolve_storage_path(doc["storage_key"])
        pages = extract_pages(path)
        if sum(len(p.strip()) for p in pages) < 20:
            raise AppError("DOCUMENT_EMPTY", "No readable text was found in this document.", 422)
        db.document_pages.delete_many({"document_id": doc["_id"]})
        db.document_pages.insert_many([
            {"document_id": doc["_id"], "project_id": doc["project_id"], "page": i, "text": text}
            for i, text in enumerate(pages, start=1)
        ])
        chunks = chunk_text(pages, max_words=380, overlap_words=50)
        count, provider = rag.store_chunks(doc["project_id"], doc, chunks)
        db.documents.update_one(
            {"_id": doc["_id"]},
            {"$set": {
                "processing_status": "ready",
                "pages": len(pages),
                "chunk_count": count,
                "embedding_provider": provider,
                "error": None,
                "updated_at": utcnow(),
            }},
        )
    except AppError as exc:
        db.documents.update_one(
            {"_id": doc["_id"]},
            {"$set": {"processing_status": "failed", "error": {"code": exc.code, "message": exc.message},
                      "updated_at": utcnow()}},
        )
    except Exception as exc:  # pragma: no cover - defensive
        db.documents.update_one(
            {"_id": doc["_id"]},
            {"$set": {"processing_status": "failed",
                      "error": {"code": "DOCUMENT_PROCESSING_FAILED", "message": str(exc)[:300]},
                      "updated_at": utcnow()}},
        )


def retry(ctx: ProjectContext, document_id: str) -> dict:
    doc = get_document(ctx, document_id)
    if doc["processing_status"] == "ready":
        return doc
    db = get_db()
    db.documents.update_one({"_id": oid(document_id)}, {"$set": {"processing_status": "uploaded", "error": None}})
    return get_document(ctx, document_id)


def delete_document(ctx: ProjectContext, document_id: str) -> None:
    doc = get_db().documents.find_one({"_id": oid(document_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Document")
    if doc["uploaded_by"] != ctx.user["_id"] and not role_has(ctx.role, "document:delete_any"):
        raise forbidden()
    db = get_db()
    rag.delete_vectors(doc["_id"])
    db.document_pages.delete_many({"document_id": doc["_id"]})
    db.documents.delete_one({"_id": doc["_id"]})
    delete_storage(doc["storage_key"])
    audit.record(actor_id=ctx.user["_id"], project_id=ctx.project_id, action="document.delete",
                 entity_type="document", entity_id=doc["_id"], before={"filename": doc["filename"]})


def document_text(ctx: ProjectContext, document_id: str) -> dict:
    db = get_db()
    doc = db.documents.find_one({"_id": oid(document_id), "project_id": ctx.project_id})
    if not doc:
        raise not_found("Document")
    pages = list(db.document_pages.find({"document_id": doc["_id"]}).sort("page", 1))
    return {
        "document_id": document_id,
        "filename": doc["filename"],
        "pages": [{"page": p["page"], "text": p["text"]} for p in pages],
        "processing_status": doc["processing_status"],
    }


def ask(ctx: ProjectContext, question: str, document_id: str | None = None) -> dict:
    db = get_db()
    if document_id:
        doc = db.documents.find_one({"_id": oid(document_id), "project_id": ctx.project_id})
        if not doc:
            raise not_found("Document")
        if doc["processing_status"] != "ready":
            raise AppError("DOCUMENT_NOT_READY", "This document is still processing.", 409)

    chunks, provider = rag.retrieve(ctx.project_id, question, document_id=document_id)
    result = ai_service.document_answer(question, chunks, ctx.project_id, ctx.user["_id"])
    citations = [
        {
            "document_id": c["document_id"],
            "filename": c["filename"],
            "page": c["page"],
            "chunk_index": c["chunk_index"],
            "excerpt": c["text"][:300],
            "score": c["score"],
        }
        for c in chunks
    ]
    return {
        "answer": result["answer"],
        "grounded": result["grounded"] and bool(chunks),
        "citations": citations if result["grounded"] else [],
        "embedding_provider": provider,
        "method": result.get("method"),
        "model": result.get("model"),
    }
