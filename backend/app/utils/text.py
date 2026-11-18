import re
from decimal import Decimal, InvalidOperation

_WORD = re.compile(r"\S+")
_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")

_NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
}


def chunk_text(pages: list[str], max_words: int = 380, overlap_words: int = 50) -> list[dict]:
    """Chunk page text into overlapping windows, preserving page numbers."""
    chunks: list[dict] = []
    index = 0
    for page_no, page_text in enumerate(pages, start=1):
        words = page_text.split()
        if not words:
            continue
        start = 0
        while start < len(words):
            end = min(start + max_words, len(words))
            text = " ".join(words[start:end]).strip()
            if len(text) >= 20:
                chunks.append({"chunk_index": index, "page": page_no, "text": text})
                index += 1
            if end >= len(words):
                break
            start = max(end - overlap_words, start + 1)
    return chunks


def numbers_in(text: str) -> set[str]:
    found: set[str] = set()
    for match in _NUMBER.findall(text or ""):
        found.add(_normalize_number(match))
    for word, value in _NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", (text or "").lower()):
            found.add(str(value))
    return found


def _normalize_number(raw: str) -> str:
    try:
        value = Decimal(raw.replace(",", ""))
        return format(value.normalize(), "f")
    except InvalidOperation:
        return raw


def numbers_not_in(output: str, source: str) -> list[str]:
    """Numbers present in model output that do not appear in the source text."""
    return sorted(numbers_in(output) - numbers_in(source))


def first_sentences(text: str, limit: int = 6) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return [p.strip() for p in parts if p.strip()][:limit]


def truncate(text: str, max_chars: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= max_chars else text[: max_chars - 1].rstrip() + "…"


def keywords(text: str, vocabulary: list[str]) -> list[str]:
    low = (text or "").lower()
    return [w for w in vocabulary if re.search(rf"\b{re.escape(w)}\b", low)]
