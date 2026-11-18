import json
import time

import httpx

from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import log_event

RETRYABLE = {429, 500, 502, 503, 504}


class GroqClient:
    """Minimal OpenAI-compatible client with timeout, retry, and JSON parsing."""

    def __init__(self) -> None:
        self.model = settings.groq_model
        self.base_url = settings.groq_base_url.rstrip("/")

    def available(self) -> bool:
        return bool(settings.groq_api_key.strip()) and settings.ai_enabled

    def complete_json(self, *, system: str, user: str, feature: str, max_tokens: int | None = None) -> dict:
        if not self.available():
            raise AppError("AI_NOT_CONFIGURED", "AI is not configured on this server.", 503)
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens or settings.groq_max_output_tokens,
            "response_format": {"type": "json_object"},
        }
        # gpt-oss models are reasoning models. A low reasoning budget keeps latency and
        # token usage predictable for structured extraction tasks. Keep a floor on the
        # completion budget so reasoning tokens cannot crowd out the JSON answer.
        if self.model.startswith("openai/gpt-oss"):
            payload["max_tokens"] = max(payload["max_tokens"], 1200)
            if settings.groq_reasoning_effort in {"low", "medium", "high"}:
                payload["reasoning_effort"] = settings.groq_reasoning_effort
        headers = {"Authorization": f"Bearer {settings.groq_api_key}", "Content-Type": "application/json"}
        attempts = settings.groq_max_retries + 1
        last_error: Exception | None = None
        for attempt in range(attempts):
            started = time.perf_counter()
            try:
                with httpx.Client(timeout=settings.groq_request_timeout_seconds) as client:
                    response = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                if response.status_code in RETRYABLE and attempt < attempts - 1:
                    time.sleep(0.5 * (2**attempt))
                    continue
                if response.status_code >= 400:
                    log_event(level="warning", feature=feature, event="ai_http_error",
                              status=response.status_code, attempt=attempt)
                    raise AppError("AI_UNAVAILABLE", "The AI provider rejected the request.", 503)
                body = response.json()
                content = body["choices"][0]["message"]["content"]
                usage = body.get("usage") or {}
                log_event(level="info", feature=feature, event="ai_call", model=self.model,
                          latency_ms=round((time.perf_counter() - started) * 1000),
                          prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"))
                return self._parse(content)
            except httpx.TimeoutException:
                last_error = AppError("AI_UNAVAILABLE", "The AI provider timed out.", 503)
            except httpx.HTTPError:
                last_error = AppError("AI_UNAVAILABLE", "The AI provider is unreachable.", 503)
            except AppError:
                raise
            except (KeyError, ValueError):
                raise AppError("AI_INVALID_OUTPUT", "The AI provider returned an unexpected response.", 502)
            if attempt < attempts - 1:
                time.sleep(0.5 * (2**attempt))
        raise last_error or AppError("AI_UNAVAILABLE", "The AI provider is unavailable.", 503)

    @staticmethod
    def _parse(content: str) -> dict:
        text = (content or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise AppError("AI_INVALID_OUTPUT", "The AI response was not valid JSON.", 502)
        if not isinstance(data, dict):
            raise AppError("AI_INVALID_OUTPUT", "The AI response was not a JSON object.", 502)
        return data


groq = GroqClient()
