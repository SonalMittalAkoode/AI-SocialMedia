"""Official Brave Web Search API only; no search-engine HTML scraping."""
import asyncio
from typing import Protocol
from urllib.parse import urlsplit
import httpx
from pydantic import BaseModel, Field
from app.core.intelligence_config import ai_settings as limits
from app.services.website_fetcher import validate_url
from app.services.extraction_errors import ExtractionError


class SearchCandidate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    website_url: str
    normalized_domain: str
    description: str = Field(max_length=3000)
    source_provider: str
    source_url: str


class CompetitorSearchProvider(Protocol):
    async def search_companies(self, queries: list[str]) -> list[SearchCandidate]: ...


def domain(url):
    return urlsplit(validate_url(url)).hostname.lower().removeprefix("www.")


def queries_for(context):
    industry = (context.get("industry") or context.get("business_type") or "business services")[:100]
    services = ", ".join(context.get("products_services", [])[:2])[:160]
    geography = " ".join(filter(None, [context.get("city"), context.get("country")]))[:150]
    # Names, private descriptions and user instructions are deliberately not sent.
    return list(dict.fromkeys([f"{industry} companies {geography}", f"{services or industry} providers {geography}", f"{industry} alternatives {geography}"]))[:limits.max_queries]


def normalize_candidates(rows, own_domain=None):
    candidates = {}
    for item in rows:
        try:
            url = validate_url(item["url"])
            key = domain(url)
            if key == own_domain or key in {"linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "wikipedia.org"}: continue
            if key not in candidates:
                candidates[key] = SearchCandidate(name=item["title"][:200], website_url=url, normalized_domain=key, description=(item.get("description") or "")[:3000], source_provider="brave", source_url=url)
        except (ValueError, KeyError, TypeError, ExtractionError): continue
    return list(candidates.values())[:limits.max_candidates]


class BraveSearchProvider:
    def __init__(self, client=None): self.client = client

    async def search_companies(self, queries):
        if not limits.brave_search_api_key or limits.search_provider != "brave":
            raise ExtractionError("search_provider_not_configured", "Search provider is not configured. Add competitors manually; no fictional recommendations are generated.")
        owned = self.client is None
        client = self.client or httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False)
        rows = []
        try:
            for query in queries[:limits.max_queries]:
                async with client.stream("GET", "https://api.search.brave.com/res/v1/web/search", params={"q":query, "count":limits.max_candidates, "text_decorations":"false"}, headers={"X-Subscription-Token":limits.brave_search_api_key.get_secret_value(), "Accept":"application/json"}) as response:
                    if response.status_code == 429: raise ExtractionError("search_rate_limited", "Search quota/rate limit reached. Try later or add competitors manually.")
                    if response.status_code != 200: raise ExtractionError("search_unavailable", "Search provider could not complete the request.", response.status_code >= 500)
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 1_000_000: raise ExtractionError("search_response_limit", "Search response exceeded the allowed size.")
                    data = __import__('json').loads(body)
                    rows.extend(data.get("web", {}).get("results", [])[:limits.max_candidates])
                await asyncio.sleep(1.1)
            return normalize_candidates(rows)
        except (httpx.RequestError, ValueError):
            raise ExtractionError("search_unavailable", "Search provider is temporarily unavailable.", True) from None
        finally:
            if owned: await client.aclose()
