"""Document text extraction with optional OCR."""

from pathlib import Path

from app.core.errors import AppError


def extract_pages(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return [path.read_text(encoding="utf-8", errors="ignore")]
    if suffix != ".pdf":
        raise AppError("UNSUPPORTED_MEDIA_TYPE", "Only PDF, TXT, and MD documents are supported.", 415)
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise AppError("DOCUMENT_ENGINE_UNAVAILABLE", "PDF extraction is not available on this server.", 503)

    pages: list[str] = []
    with fitz.open(path) as doc:
        if doc.page_count > 300:
            raise AppError("VALIDATION_ERROR", "PDF exceeds the 300 page limit.", 422)
        for page in doc:
            text = page.get_text("text") or ""
            if len(text.strip()) < 40:
                text = _ocr_page(page) or text
            pages.append(text)
    return pages


def _ocr_page(page) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return ""
    try:
        pix = page.get_pixmap(dpi=200)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return pytesseract.image_to_string(image)
    except Exception:
        return ""


def extract_text(path: Path) -> str:
    return "\n\n".join(extract_pages(path))
