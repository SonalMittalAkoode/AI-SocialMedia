"""OpenAI provider: Responses API structured output and web search, and the Images API.

One gateway per process/worker. Credentials stay server-side and are never logged. Provider
error bodies are mapped to fixed application messages; they are never echoed to users.

Retry policy: the SDK's own retries are disabled. Only transient failures (timeouts, connection
errors, 5xx and request-rate 429s) are retried, at most ``ai_settings.openai_max_attempts`` times
with bounded backoff. Billing, quota, spend-limit, auth, permission, model-access and schema
errors are never retried.
"""
import asyncio
import base64
import random
import time

import openai
from openai import AsyncOpenAI

from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.services.extraction_errors import ExtractionError

# Documented 429 / insufficient_quota codes: retrying these never restores access.
BILLING_CODES = {
    "insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "billing_hard_limit_reached",
    "billing_not_active", "spend_limit_exceeded",
}
LABELS = {
    "text": "The OpenAI text model", "research": "The OpenAI research model", "search": "OpenAI web search",
    "image": "OpenAI image generation", "review": "The OpenAI image review",
}
# Keywords unsupported or unnecessary in strict Structured Outputs; bounds stay enforced by Pydantic.
OMITTED = {"maxLength", "minLength", "maxItems", "minItems", "pattern", "title", "default", "format",
           "examples", "discriminator", "uniqueItems", "maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum"}
BOUND_HINTS = (("maxLength", "At most {} characters."), ("minLength", "At least {} characters."),
               ("maxItems", "At most {} items."), ("minItems", "At least {} items."),
               ("maximum", "Maximum value {}."), ("minimum", "Minimum value {}."))


def configured() -> bool:
    return bool(settings.OPENAI_API_KEY and settings.OPENAI_API_KEY.get_secret_value().strip())


def _error_details(exc):
    body = getattr(exc, "body", None)
    error = body.get("error", body) if isinstance(body, dict) else {}
    error = error if isinstance(error, dict) else {}
    return error.get("code") or getattr(exc, "code", None), error.get("type") or getattr(exc, "type", None)


def map_error(exc, purpose="text") -> ExtractionError:
    """Fixed, user-safe ExtractionError for an OpenAI SDK exception."""
    label = LABELS.get(purpose, "OpenAI")
    if isinstance(exc, openai.APITimeoutError):
        return ExtractionError("openai_timeout", f"{label} timed out. Nothing was saved.", True)
    if isinstance(exc, openai.APIConnectionError):
        return ExtractionError("openai_unavailable", f"{label} could not be reached. Try again shortly.", True)
    code, kind = _error_details(exc)
    if isinstance(exc, openai.AuthenticationError):
        return ExtractionError("openai_auth_failed", "OpenAI rejected the server API key. Check OPENAI_API_KEY on the server.")
    if isinstance(exc, openai.PermissionDeniedError):
        return ExtractionError("openai_access_denied", f"{label} is not permitted for this API project (model access, organization verification or region).")
    if isinstance(exc, openai.NotFoundError):
        return ExtractionError("openai_model_unavailable", f"{label} is not available to this API project. Check the configured model ID.")
    if isinstance(exc, openai.RateLimitError):
        if code in BILLING_CODES or kind == "insufficient_quota":
            return ExtractionError("openai_billing_limit", "The OpenAI project has reached its credit, quota or spend limit. Requests are not retried; check API billing.")
        return ExtractionError("openai_rate_limited", f"{label} is rate limited. Try again shortly.", True)
    if isinstance(exc, (openai.BadRequestError, openai.UnprocessableEntityError)):
        if code == "moderation_blocked" or (isinstance(code, str) and "content_policy" in code):
            return ExtractionError("openai_content_blocked", "The provider's safety system declined this request. Revise the brief and try again.")
        return ExtractionError("openai_request_rejected", f"{label} rejected the request (unsupported option, tool or schema for this model).")
    if isinstance(exc, openai.APIStatusError) and exc.status_code >= 500:
        return ExtractionError("openai_unavailable", f"{label} is temporarily unavailable. Try again shortly.", True)
    return ExtractionError("openai_unavailable", f"{label} could not complete the request.")


def strict_schema(schema):
    """Convert a Pydantic JSON schema to OpenAI strict Structured Outputs form.

    Every object gets ``additionalProperties: false`` and lists every property as required.
    Enum-keyed maps (``dict[Literal[...], str]``) become objects with fixed nullable properties;
    callers drop the nulls (see ``drop_nulls``). Returns (schema, strict). ``strict`` is False when
    a free-form map remains, in which case the schema is sent non-strict and Pydantic still
    validates the full contract locally.
    """
    strict = True

    def walk(node):
        nonlocal strict
        if isinstance(node, list):
            return [walk(item) for item in node]
        if not isinstance(node, dict):
            return node
        names = node.get("propertyNames")
        extra = node.get("additionalProperties")
        if node.get("type") == "object" and isinstance(extra, dict) and isinstance(names, dict) and names.get("enum"):
            value = walk(extra)
            return {"type": "object", "properties": {key: {"anyOf": [value, {"type": "null"}]} for key in names["enum"]},
                    "required": list(names["enum"]), "additionalProperties": False}
        out = {key: walk(value) for key, value in node.items()
               if key not in OMITTED and key not in ("propertyNames", "properties", "$defs")}
        # Property and definition names are data, never keywords: walk their schemas, keep every name
        # (a field called "title", "default" or "format" must survive keyword stripping).
        for mapping in ("properties", "$defs"):
            if isinstance(node.get(mapping), dict):
                out[mapping] = {name: walk(value) for name, value in node[mapping].items()}
        # Bounds stripped above are restated as descriptions so the model can respect them;
        # Pydantic still enforces every bound locally.
        hints = [text.format(node[key]) for key, text in BOUND_HINTS if isinstance(node.get(key), int)]
        if hints:
            out["description"] = " ".join(filter(None, [out.get("description", ""), *hints]))
        if node.get("type") == "object" or "properties" in node:
            if isinstance(extra, dict) or (not node.get("properties") and extra is not False):
                strict = False
                return out
            out["properties"] = out.get("properties", {})
            out["required"] = list(out["properties"])
            out["additionalProperties"] = False
        return out

    return walk(schema), strict


def drop_nulls(value):
    """Remove null map entries produced by fixed nullable map properties."""
    if isinstance(value, dict):
        return {key: drop_nulls(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [drop_nulls(item) for item in value]
    return value


def usage_of(usage) -> dict:
    """Token usage exactly as reported; absent fields stay absent (never estimated)."""
    if usage is None:
        return {}
    out = {"provider": "openai"}
    for name in ("input_tokens", "output_tokens", "total_tokens"):
        if isinstance(value := getattr(usage, name, None), int):
            out[name] = value
    details = getattr(usage, "input_tokens_details", None)
    for source, target in (("cached_tokens", "cached_input_tokens"), ("image_tokens", "input_image_tokens"), ("text_tokens", "input_text_tokens")):
        if isinstance(value := getattr(details, source, None), int):
            out[target] = value
    details = getattr(usage, "output_tokens_details", None)
    for source, target in (("reasoning_tokens", "reasoning_tokens"), ("image_tokens", "output_image_tokens")):
        if isinstance(value := getattr(details, source, None), int):
            out[target] = value
    return out


def merge_usage(base: dict, extra: dict) -> dict:
    merged = dict(base or {})
    for key, value in (extra or {}).items():
        if isinstance(value, int) and not isinstance(value, bool):
            merged[key] = (merged.get(key) or 0) + value
        elif key not in merged:
            merged[key] = value
    return merged


class OpenAIGateway:
    """Thin, bounded wrapper over AsyncOpenAI used by every OpenAI workflow."""
    provider = "openai"

    def __init__(self, client=None, timeout=None):
        if client is None:
            if not configured():
                raise ExtractionError("openai_not_configured", "OpenAI is the selected AI provider but OPENAI_API_KEY is not configured.")
            client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY.get_secret_value(), max_retries=0,
                                 timeout=timeout or ai_settings.openai_timeout)
        self.client = client
        self.usage = {}

    async def close(self):
        close = getattr(self.client, "close", None)
        if close:
            await close()

    async def call(self, factory, purpose="text"):
        """Run ``factory()`` with bounded retries for transient failures only."""
        attempts = ai_settings.openai_max_attempts
        for attempt in range(attempts):
            try:
                return await factory()
            except openai.APIError as exc:
                error = map_error(exc, purpose)
                if not error.transient or attempt + 1 >= attempts:
                    raise error from None
                delay = min(8.0, 1.5 * 2 ** attempt) + random.uniform(0, 0.5)
                retry_after = getattr(getattr(exc, "response", None), "headers", {}).get("retry-after") if isinstance(exc, openai.RateLimitError) else None
                try:
                    delay = max(delay, min(float(retry_after), 20.0)) if retry_after else delay
                except ValueError:
                    pass
                await asyncio.sleep(delay)

    async def structured(self, *, model, system, content, schema, name, max_output_tokens, reasoning=None,
                         timeout=None, purpose="text", images=(), tools=None):
        """Responses API JSON output validated against ``schema``. Returns (text, usage, meta).

        Raises ValueError for empty/incomplete output (callers treat it as a validation failure),
        and ExtractionError for refusals and provider errors.
        """
        wire, strict = strict_schema(schema)
        parts = [{"type": "input_text", "text": content}]
        for image in images:
            parts.append({"type": "input_image", "image_url": "data:image/png;base64," + base64.b64encode(image).decode()})
        kwargs = {
            "model": model, "instructions": system, "input": [{"role": "user", "content": parts}],
            "text": {"format": {"type": "json_schema", "name": name, "schema": wire, "strict": strict}},
            "max_output_tokens": max_output_tokens, "store": False,
        }
        if reasoning:
            kwargs["reasoning"] = {"effort": reasoning}
        if tools:
            kwargs["tools"] = tools
        started = time.monotonic()
        response = await self.call(lambda: self.client.responses.create(**kwargs, timeout=timeout or ai_settings.openai_timeout), purpose)
        usage = usage_of(getattr(response, "usage", None))
        self.usage = merge_usage(self.usage, usage)
        meta = {"provider": "openai", "model": model, "duration_ms": int((time.monotonic() - started) * 1000)}
        if isinstance(getattr(response, "id", None), str):
            meta["response_id"] = response.id[:200]
        if isinstance(getattr(response, "model", None), str):
            meta["model_version"] = response.model[:200]
        for item in getattr(response, "output", None) or []:
            for part in getattr(item, "content", None) or []:
                if getattr(part, "type", None) == "refusal":
                    raise ExtractionError("openai_refused", f"{LABELS.get(purpose, 'OpenAI')} declined this request. Revise the input and try again.")
        if getattr(response, "status", "completed") == "incomplete":
            raise ValueError("Empty or oversized output")
        text = getattr(response, "output_text", "") or ""
        if not text.strip():
            raise ValueError("Empty or oversized output")
        return text, usage, meta
