import hashlib
import re
import uuid
from pathlib import Path

from app.core.config import settings
from app.core.errors import AppError

_STORAGE = Path(settings.storage_dir).resolve()


def _ext_from_magic(data: bytes) -> str | None:
    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"ID3"):
        return "mp3"
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        return "wav"
    if data.startswith(b"OggS"):
        return "ogg"
    if data[4:8] == b"ftyp":
        return "m4a"
    if data.startswith(b"\x1aE\xdf\xa3"):
        return "webm"
    return None


def detect_extension(data: bytes, filename: str) -> str:
    ext = _ext_from_magic(data)
    if ext:
        return ext
    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix in {"txt", "md", "csv"}:
        try:
            data.decode("utf-8")
            return suffix
        except UnicodeDecodeError:
            pass
    raise AppError("UNSUPPORTED_MEDIA_TYPE", "The uploaded file type is not supported.", 415)


def sanitize_filename(name: str) -> str:
    base = Path(name or "file").name
    base = re.sub(r"[^A-Za-z0-9._ \-()]", "_", base).strip() or "file"
    return base[:120]


def _project_dir(project_id: str) -> Path:
    safe = re.sub(r"[^a-f0-9]", "", project_id)
    path = (_STORAGE / safe).resolve()
    if _STORAGE not in path.parents and path != _STORAGE:
        raise AppError("INVALID_PATH", "Invalid storage path.", 400)
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_bytes(content: bytes, original_filename: str, project_id: str, kind: str, max_mb: int) -> dict:
    if len(content) == 0:
        raise AppError("VALIDATION_ERROR", "The uploaded file is empty.", 422)
    if len(content) > max_mb * 1024 * 1024:
        raise AppError("FILE_TOO_LARGE", f"File exceeds the {max_mb} MB limit.", 413)
    ext = detect_extension(content, original_filename)
    if kind == "pdf" and ext != "pdf":
        raise AppError("UNSUPPORTED_MEDIA_TYPE", "Expected a PDF file.", 415)
    if kind == "image" and ext not in {"png", "jpg"}:
        raise AppError("UNSUPPORTED_MEDIA_TYPE", "Expected a PNG or JPEG image.", 415)
    if kind == "audio" and ext not in {"wav", "webm", "mp3", "m4a", "ogg"}:
        raise AppError("UNSUPPORTED_MEDIA_TYPE", "Expected an audio file.", 415)
    if kind == "document" and ext not in {"pdf", "txt", "md"}:
        raise AppError("UNSUPPORTED_MEDIA_TYPE", "Expected a PDF, TXT, or MD file.", 415)
    if kind == "invoice" and ext not in {"pdf", "png", "jpg"}:
        raise AppError("UNSUPPORTED_MEDIA_TYPE", "Expected a PDF, PNG, or JPEG invoice.", 415)

    file_id = uuid.uuid4().hex
    target = _project_dir(project_id) / f"{file_id}.{ext}"
    target.write_bytes(content)
    return {
        "file_id": file_id,
        "storage_key": f"{target.parent.name}/{target.name}",
        "path": str(target),
        "filename": sanitize_filename(original_filename),
        "ext": ext,
        "mime": _mime_for(ext),
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def _mime_for(ext: str) -> str:
    return {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "txt": "text/plain",
        "md": "text/markdown",
        "wav": "audio/wav",
        "webm": "audio/webm",
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "ogg": "audio/ogg",
    }.get(ext, "application/octet-stream")


def resolve_storage_path(storage_key: str) -> Path:
    path = (_STORAGE / storage_key).resolve()
    if _STORAGE not in path.parents:
        raise AppError("INVALID_PATH", "Invalid file reference.", 400)
    if not path.exists():
        raise AppError("FILE_NOT_FOUND", "The stored file is missing.", 404)
    return path


def delete_storage(storage_key: str) -> None:
    try:
        resolve_storage_path(storage_key).unlink(missing_ok=True)
    except AppError:
        pass
