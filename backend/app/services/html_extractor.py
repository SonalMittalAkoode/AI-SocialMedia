"""Bounded HTML parsing. No scripts, remote assets, or JSON-LD URLs are executed."""
import json
import re
from urllib.parse import urljoin, urlsplit
from bs4 import BeautifulSoup

from app.services.website_fetcher import validate_url, origin
from app.services.extraction_errors import ExtractionError
from app.schemas.onboarding import social_url


def clean_text(value, maximum=10000):
    return re.sub(r"\s+", " ", value).strip()[:maximum]


def parse_html(url, html):
    soup = BeautifulSoup(html, "html.parser")
    robots_meta = soup.find("meta", attrs={"name": re.compile(r"^robots$", re.I)})
    if robots_meta and "noai" in robots_meta.get("content", "").lower():
        raise ExtractionError("restricted", "The website explicitly restricts AI processing.")
    if soup.title and re.search(r"just a moment|access denied|attention required", soup.title.get_text(), re.I):
        raise ExtractionError("restricted", "The website returned an access challenge. Enter details manually.")
    def meta(*names):
        for name in names:
            tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
            if tag and tag.get("content"):
                return clean_text(tag["content"], 1000)
        return None
    def link_url(selector):
        tag = soup.select_one(selector)
        if not tag or not tag.get("href"):
            return None
        try:
            return validate_url(urljoin(url, tag["href"]))
        except ExtractionError:
            return None
    structured = []
    for script in soup.select('script[type="application/ld+json"]')[:10]:
        if len(script.get_text()) > 20000:
            continue
        try:
            data = json.loads(script.get_text())
            items = data if isinstance(data, list) else [data]
            if isinstance(data, dict):
                items += data.get("@graph", [])[:20] if isinstance(data.get("@graph"), list) else []
            for item in items[:20]:
                if not isinstance(item, dict) or item.get("@type") not in {"Organization", "LocalBusiness", "Corporation", "ProfessionalService", "Store", "Restaurant"}:
                    continue
                structured.append({k: clean_text(str(item[k]), 1000) for k in ["name", "description", "address", "telephone", "email", "url", "sameAs"] if k in item})
        except (ValueError, TypeError):
            pass
    social, links, contacts = {}, [], []
    for a in soup.find_all("a", href=True)[:500]:
        if a["href"].lower().startswith(("mailto:", "tel:")):
            contacts.append(clean_text(a["href"].split(":", 1)[1].split("?")[0], 200))
        absolute = urljoin(url, a["href"])
        try:
            normalized = validate_url(absolute)
            if origin(normalized) == origin(url) and re.search(r"about|service|product|contact", a.get_text(" ") + urlsplit(normalized).path, re.I):
                links.append(normalized)
            for platform in ["instagram", "facebook", "linkedin", "x"]:
                try:
                    social[platform] = social_url(normalized, platform)
                    break
                except ValueError:
                    continue
        except ExtractionError:
            pass
    metadata = {"title": clean_text(soup.title.get_text(), 500) if soup.title else None, "description": meta("description"), "og_title": meta("og:title"), "og_description": meta("og:description"), "og_image": meta("og:image"), "favicon": link_url('link[rel~="icon"]'), "canonical": link_url('link[rel="canonical"]')}
    for element in soup.select("script,style,noscript,nav,footer,header,form,[hidden],[aria-hidden=true],.cookie-banner,#cookie-banner"):
        element.decompose()
    for element in soup.find_all(style=True):
        # A hidden ancestor decomposed earlier in this loop leaves its descendants without attrs.
        if element.decomposed or element.attrs is None:
            continue
        if re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", element.get("style", ""), re.I):
            element.decompose()
    headings = [clean_text(h.get_text(" "), 300) for h in soup.find_all(["h1", "h2", "h3"])[:30]]
    root = soup.find("main") or soup.find("article") or soup.body or soup
    paragraphs = list(dict.fromkeys(clean_text(line, 2000) for line in root.get_text("\n").splitlines() if clean_text(line)))
    return {"url": url, **metadata, "headings": headings, "cleaned_text": "\n".join(paragraphs)[:12000], "structured_data": structured[:10], "contacts": list(dict.fromkeys(contacts))[:20]}, list(dict.fromkeys(links))[:20], social
