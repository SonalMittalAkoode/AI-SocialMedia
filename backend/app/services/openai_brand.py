"""OpenAI brand/competitor website analysis.

Reuses the provider-neutral evidence pipeline from ``gemini_brand_analyzer`` unchanged: the same
system rules, server-assigned passage IDs, citation attachment, strict/lenient verification and
contact/colour/social merging. Only the model call differs (Responses API + Structured Outputs).
"""
import asyncio
import json

from app.core.config import settings
from app.core.intelligence_config import ai_settings
from app.services.gemini_brand_analyzer import GeminiAnalysis, GeminiBrandAnalyzer, MinimalGeminiAnalysis


class OpenAIBrandAnalyzer(GeminiBrandAnalyzer):
    provider = "openai"
    timeout_error = ("openai_timeout", "OpenAI took too long to respond.")

    def __init__(self, client=None):
        # The gateway is created lazily so a missing key fails the job explicitly instead of the worker.
        self._client = client

    @property
    def client(self):
        if self._client is None:
            from app.services.openai_provider import OpenAIGateway
            self._client = OpenAIGateway()
        return self._client

    @property
    def model(self):
        return settings.OPENAI_RESEARCH_MODEL

    async def close(self):
        if self._client is not None:
            await self._client.close()

    async def _request(self, content, system, minimal):
        schema = (MinimalGeminiAnalysis if minimal else GeminiAnalysis).model_json_schema()
        text, usage, _ = await asyncio.wait_for(self.client.structured(
            model=settings.OPENAI_RESEARCH_MODEL, system=system, content=content, schema=schema,
            name="brand_analysis", max_output_tokens=ai_settings.openai_analysis_max_output_tokens,
            reasoning=ai_settings.openai_research_reasoning, purpose="research",
            timeout=ai_settings.openai_analysis_timeout), ai_settings.openai_analysis_timeout + 5)
        data = json.loads(text)
        if isinstance(data, dict) and isinstance(data.get("social_links"), dict):
            # Strict schemas express the enum-keyed map as fixed nullable keys.
            data["social_links"] = {key: value for key, value in data["social_links"].items() if value}
        return json.dumps(data), usage
