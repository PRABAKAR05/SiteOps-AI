import threading
import time
from collections import defaultdict, deque

from app.core.errors import AppError

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def check(bucket: str, limit: int, window_seconds: int) -> None:
    """Sliding-window limiter. Instance-local by design; documented in docs/06."""
    now = time.monotonic()
    cutoff = now - window_seconds
    with _lock:
        q = _hits[bucket]
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= limit:
            retry = max(1, int(window_seconds - (now - q[0])))
            raise AppError(
                "RATE_LIMITED",
                f"Too many requests. Try again in {retry} seconds.",
                429,
                [{"field": "retry_after", "issue": str(retry)}],
            )
        q.append(now)


def reset() -> None:
    with _lock:
        _hits.clear()
