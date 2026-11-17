import asyncio
import time
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from app.core.extraction_config import extraction_settings as limits
from app.services.website_fetcher import WebsiteFetcher, origin, validate_url
from app.services.html_extractor import parse_html
from app.services.extraction_errors import ExtractionError
from app.schemas.website import WebsiteContent


async def extract_website(url, stage=lambda _: None, fetcher=None):
    fetcher = fetcher or WebsiteFetcher()
    pages, warnings, social = [], [], {}
    robots_cache = {}
    last_request = {}
    async def permitted(target):
        key = origin(target)
        if key not in robots_cache:
            u = urlsplit(target)
            robots_url = f"{u.scheme}://{u.netloc}/robots.txt"
            _, text, code = await fetcher.get(robots_url, allowed_origin=key, robots=True)
            parser = RobotFileParser()
            parser.parse(text.splitlines() if code == 200 else [])
            robots_cache[key] = parser
            last_request[key] = time.monotonic()
        parser = robots_cache[key]
        if not parser.can_fetch("SocialAIResearchBot", target):
            raise ExtractionError("robots_restricted", "The website's robots policy does not permit this page.")
        rate = parser.request_rate("SocialAIResearchBot") or parser.request_rate("*")
        delay = max(0.3, parser.crawl_delay("SocialAIResearchBot") or parser.crawl_delay("*") or 0, rate.seconds / rate.requests if rate else 0)
        if delay > 10:
            raise ExtractionError("robots_restricted", "The website requires a crawl delay beyond this research job's limits.")
        await asyncio.sleep(max(0, delay - (time.monotonic() - last_request.get(key, 0))))
        last_request[key] = time.monotonic()
        return delay
    try:
        url = validate_url(url)
        stage("fetching")
        # Redirects are handled manually so each target's robots and network
        # policy are checked before its body is requested, including home redirects.
        canonical_origin = origin(url)
        queue = [url]
        visited = set()
        text_budget = limits.max_text
        seen_paragraphs = set()
        while queue and len(pages) < limits.max_pages:
            target = queue.pop(0)
            if target in visited:
                continue
            visited.add(target)
            try:
                # Strict same origin redirects for crawl pages. Homepage upgrades
                # are intentionally fail-closed; submit the final canonical URL.
                resolved, html, _ = await fetcher.get(target, allowed_origin=canonical_origin, before_request=permitted)
                stage("cleaning")
                page, links, found_social = parse_html(resolved, html)
                page["social_links"] = found_social
                unique = []
                for line in page["cleaned_text"].splitlines():
                    if line not in seen_paragraphs:
                        seen_paragraphs.add(line)
                        unique.append(line)
                page["cleaned_text"] = "\n".join(unique)
                page["cleaned_text"] = page["cleaned_text"][:text_budget]
                text_budget -= len(page["cleaned_text"])
                pages.append(page)
                social.update(found_social)
                if len(pages) == 1:
                    queue.extend(links)
                if text_budget <= 0:
                    break
                stage("fetching")
            except ExtractionError as exc:
                if not pages:
                    raise
                warnings.append(f"An additional page was skipped: {exc.code}")
        if sum(len(p["cleaned_text"]) for p in pages) < 120:
            raise ExtractionError("insufficient_content", "Not enough public business text was found. Enter details manually.")
        return WebsiteContent(requested_url=url, resolved_url=pages[0]["url"], pages=pages, social_links=social, warnings=warnings[:10]).model_dump()
    finally:
        await fetcher.close()
