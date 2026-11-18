"""Chunking, embeddings and retrieval.

Embeddings use sentence-transformers when available, otherwise a deterministic
384-dimensional hashing vectorizer. Both are real embeddings; the active provider
is returned with every result so the UI can be honest about it.
"""

import math
from functools import lru_cache

import numpy as np
from bson import ObjectId

from app.core.config import settings
from app.database.mongo import get_db
from app.utils.dates import utcnow

_MODEL = None
_PROVIDER = "hashing"


@lru_cache(maxsize=1)
def _sentence_model():
    from sentence_transformers import SentenceTransformer  # type: ignore

    return SentenceTransformer(settings.embedding_model)


def embed_texts(texts: list[str]) -> tuple[np.ndarray, str]:
    global _MODEL, _PROVIDER
    if _MODEL is not None:
        return np.asarray(_MODEL.encode(texts, normalize_embeddings=True)), _PROVIDER
    try:
        model = _sentence_model()
        vectors = model.encode(texts, normalize_embeddings=True)
        _MODEL = model
        _PROVIDER = "sentence-transformers"
        return np.asarray(vectors), _PROVIDER
    except Exception:
        from sklearn.feature_extraction.text import HashingVectorizer

        vectorizer = HashingVectorizer(n_features=384, alternate_sign=False, norm="l2", ngram_range=(1, 2))
        vectors = vectorizer.transform(texts).toarray()
        from sklearn.preprocessing import normalize

        _PROVIDER = "hashing-tfidf"
        return normalize(vectors), _PROVIDER


def store_chunks(project_id: ObjectId, document: dict, chunks: list[dict]) -> tuple[int, str]:
    db = get_db()
    texts = [c["text"] for c in chunks]
    vectors, provider = embed_texts(texts)
    db.document_chunks.delete_many({"document_id": document["_id"]})
    db.document_vectors.delete_many({"document_id": document["_id"]})
    if not chunks:
        return 0, provider
    db.document_chunks.insert_many([
        {
            "project_id": project_id,
            "document_id": document["_id"],
            "chunk_index": c["chunk_index"],
            "page": c["page"],
            "text": c["text"],
            "token_count": len(c["text"].split()),
            "embedding_id": f"{document['_id']}:{c['chunk_index']}",
            "embedding_model": provider,
            "created_at": utcnow(),
        }
        for c in chunks
    ])
    db.document_vectors.insert_many([
        {
            "project_id": project_id,
            "document_id": document["_id"],
            "chunk_index": c["chunk_index"],
            "page": c["page"],
            "filename": document["filename"],
            "text": c["text"],
            "vector": [float(x) for x in vectors[i]],
            "provider": provider,
            "created_at": utcnow(),
        }
        for i, c in enumerate(chunks)
    ])
    return len(chunks), provider


def retrieve(project_id: ObjectId, question: str, *, document_id: str | None = None,
             top_k: int | None = None, min_score: float | None = None) -> tuple[list[dict], str]:
    db = get_db()
    query: dict = {"project_id": project_id}
    if document_id:
        query["document_id"] = ObjectId(document_id)
    vectors = list(db.document_vectors.find(query))
    if not vectors:
        return [], _PROVIDER
    qvec, provider = embed_texts([question])
    q = qvec[0]
    query_terms = _terms(question)
    scored = []
    for row in vectors:
        v = np.asarray(row["vector"], dtype=float)
        denom = (np.linalg.norm(q) * np.linalg.norm(v)) or 1.0
        cosine = float(np.dot(q, v) / denom)
        lex = _overlap(query_terms, _terms(row["text"]))
        # Hybrid score keeps short questions from being buried by long chunks.
        score = 0.6 * cosine + 0.4 * lex
        scored.append((score, cosine, lex, row))
    scored.sort(key=lambda item: item[0], reverse=True)
    threshold = settings.rag_min_score if min_score is None else min_score
    out = []
    for score, cosine, lex, row in scored[: (top_k or settings.rag_top_k)]:
        if score < threshold:
            continue
        out.append({
            "chunk_index": row["chunk_index"],
            "page": row.get("page"),
            "text": row["text"],
            "filename": row["filename"],
            "document_id": str(row["document_id"]),
            "score": round(score, 4),
            "cosine": round(cosine, 4),
            "lexical": round(lex, 4),
        })
    return out, provider


_STOPWORDS = {
    "the", "and", "for", "are", "was", "were", "with", "that", "this", "from", "what", "which",
    "how", "many", "much", "does", "did", "have", "has", "into", "must", "shall", "should", "will",
    "required", "require", "need", "needed", "per", "any", "all", "not", "but", "you", "your",
}


def _terms(text: str) -> set[str]:
    import re

    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


def _overlap(query_terms: set[str], chunk_terms: set[str]) -> float:
    if not query_terms:
        return 0.0
    return len(query_terms & chunk_terms) / len(query_terms)


def delete_vectors(document_id: ObjectId) -> None:
    db = get_db()
    db.document_vectors.delete_many({"document_id": document_id})
    db.document_chunks.delete_many({"document_id": document_id})


def cosine(a: list[float], b: list[float]) -> float:
    denom = (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))) or 1.0
    return sum(x * y for x, y in zip(a, b)) / denom
