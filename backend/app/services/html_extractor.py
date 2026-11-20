"""Bounded HTML parsing. No scripts, remote assets, or JSON-LD URLs are executed."""
import json
import re
from urllib.parse import parse_qs, unquote, urljoin, urlsplit
from bs4 import BeautifulSoup
from PIL import ImageColor

from app.services.website_fetcher import validate_url, origin
from app.services.extraction_errors import ExtractionError
from app.schemas.onboarding import social_url


def clean_text(value, maximum=10000):
    return re.sub(r"\s+", " ", value).strip()[:maximum]


EMAIL = re.compile(r"[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+", re.I)
OFFICE_LABEL = re.compile(r"^\s*(?:office(?: address)?|registered office|business address)\s*:\s*", re.I)
POSTAL_LOCATION = re.compile(r",\s*\d{3,6}\s+(?P<city>[^\d,]+),\s*(?P<country>[^\d,]+)$")
HEX_COLOR = r"#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])"
LOGO_WRAPPERS = 'a.logo, .site-logo, .brand-logo, .navbar-brand, [itemprop="logo"]'
LOGO_NAME = re.compile(r'(?:^|[-_.\s/])(?:logo(?:type|mark)?|wordmark|brandmark)(?:[-_.\s/]|$)', re.I)


def normalize_hex(color):
    color = color.lower()
    return '#' + ''.join(char * 2 for char in color[1:]) if len(color) == 4 else color


def css_brand_tokens(css):
    literal = rf"(?:{HEX_COLOR}|(?:rgb|hsl)\([0-9.,%\s+-]{{1,64}}\))"
    declarations = re.findall(rf"--([\w-]+)\s*:\s*({literal})\s*(?=[;}}]|$)", css, re.I)
    referenced = set(re.findall(r"var\(\s*--([\w-]+)", css, re.I))
    explicit = re.compile(r"^(?:color-)?(?:brand|primary|accent|secondary)(?:-|$)", re.I)
    general = {"color", "tw", "bs", "mui", "chakra", "radix", "gray", "grey", "neutral", "spacing", "text", "background", "surface", "button"}
    groups = {}
    colors = []
    for name, color in declarations:
        try:
            color = '#%02x%02x%02x' % ImageColor.getrgb(color)
        except ValueError:
            continue
        if explicit.match(name):
            colors.append(color)
        prefix, separator, suffix = name.lower().partition('-')
        if separator and prefix not in general and name in referenced and not suffix.isdigit():
            groups.setdefault(prefix, {})[name] = color
    for tokens in groups.values():
        if len(tokens) >= 2:
            colors.extend(tokens.values())
    return list(dict.fromkeys(colors))[:16]


def inline_logo(html):
    soup = BeautifulSoup(html, 'html.parser')
    for wrapper in soup.select(LOGO_WRAPPERS):
        svg = wrapper if wrapper.name == 'svg' else wrapper.find('svg')
        if svg is not None:
            if 'viewbox' in svg.attrs:
                svg['viewBox'] = svg.attrs.pop('viewbox')
            svg.attrs.setdefault('xmlns', 'http://www.w3.org/2000/svg')
            return str(svg).encode()
    return None


def site_palette(soup):
    theme = [tag.get("content", "").strip() for tag in soup.select('meta[name="theme-color" i]')]
    css = "\n".join(tag.get_text() for tag in soup.find_all("style"))
    tokens = css_brand_tokens(css)
    surfaces = [normalize_hex(color) for color in re.findall(rf"\bbackground(?:-color)?\s*:\s*({HEX_COLOR})", css, re.I)]
    # Basic black, white and gray surfaces are usually layout colors.
    accents = [color for color in surfaces if len({color[i:i + 2].lower() for i in (1, 3, 5)}) > 1]
    return list(dict.fromkeys(normalize_hex(color) for color in theme + tokens + accents if re.fullmatch(HEX_COLOR, color, re.I)))[:8]


def structured_location(address):
    if not isinstance(address, dict):
        return {}
    country = address.get("addressCountry")
    if isinstance(country, dict):
        country = country.get("name") or country.get("identifier")
    values = {
        "street": address.get("streetAddress"),
        "postal": address.get("postalCode"),
        "city": address.get("addressLocality"),
        "state": address.get("addressRegion"),
        "country": country,
    }
    return {key: clean_text(value, 500) for key, value in values.items() if isinstance(value, str) and value.strip()}


def public_contact_details(soup, structured, location):
    details = {}
    for link in soup.select('a[href^="mailto:" i]'):
        candidate = unquote(link["href"][7:].split("?", 1)[0]).strip()
        if len(candidate) <= 254 and EMAIL.fullmatch(candidate):
            details["public_email"] = candidate
            break
    if "public_email" not in details:
        for node in soup.find_all(string=EMAIL):
            candidate = str(node).strip()
            if len(candidate) <= 254 and EMAIL.fullmatch(candidate):
                details["public_email"] = candidate
                break
        else:
            for item in structured:
                candidate = item.get("email", "").removeprefix("mailto:")
                if len(candidate) <= 254 and EMAIL.fullmatch(candidate):
                    details["public_email"] = candidate
                    break

    address = ""
    for node in soup.find_all(string=OFFICE_LABEL):
        candidate = clean_text(OFFICE_LABEL.sub("", str(node)))
        if len(candidate) <= 500 and any(char.isdigit() for char in candidate):
            address = candidate
            break
    if address:
        if match := POSTAL_LOCATION.search(address):
            details.update({key: value.strip() for key, value in match.groupdict().items() if len(value.strip()) <= 100})
        state = location.get("state")
        street = location.get("street")
        if state and len(state) <= 100 and street and street.casefold() in address.casefold():
            details["state"] = state
    elif street := location.get("street"):
        postal_city = " ".join(filter(None, (location.get("postal"), location.get("city"))))
        address = ", ".join(dict.fromkeys(filter(None, (street, postal_city, location.get("state"), location.get("country")))))
        details.update({key: location[key] for key in ("city", "state", "country") if key in location and len(location[key]) <= 100})
    else:
        address_tag = soup.find("address")
        address = clean_text(address_tag.get_text(", ", strip=True), 500) if address_tag else ""
        if not any(c.isdigit() for c in address) or "@" in address:
            address = ""
    if address and len(address) <= 500:
        details["office_address"] = address
    return details


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
    location = {}
    logos = []
    colors = site_palette(soup)
    def add_logo(value, reason):
        if isinstance(value, dict): value = value.get("url") or value.get("contentUrl")
        if not isinstance(value, str): return
        try:
            target = validate_url(urljoin(url, value))
            if target not in [r["url"] for r in logos]: logos.append({"url":target,"source_url":url,"reason":reason})
        except (ExtractionError, ValueError): pass
    def image_source(image):
        srcset = image.get('data-srcset') or image.get('srcset') or ''
        candidates = srcset.strip().split()
        return image.get('data-src') or image.get('src') or (candidates[0].rstrip(',') if candidates else None)

    def logo_named(value):
        if not value:
            return False
        try:
            parts = urlsplit(value)
        except ValueError:
            return False
        paths = [parts.path, *parse_qs(parts.query).get('url', [])[:1]]
        return any(LOGO_NAME.search(unquote(path)) for path in paths)

    def visible(image):
        return image.get('aria-hidden') != 'true' and not image.has_attr('hidden')

    for anchor in soup.select('header a[href], nav a[href]')[:30]:
        try:
            target = urlsplit(validate_url(urljoin(url, anchor['href'])))
        except (ExtractionError, ValueError):
            continue
        if origin(target.geturl()) == origin(url) and target.path in ('', '/') and not target.query:
            for image in anchor.find_all('img', limit=3):
                if visible(image):
                    add_logo(image_source(image), 'website logo link')

    for selector, reason in (
        (', '.join(f'{wrapper} img' for wrapper in LOGO_WRAPPERS.split(', ')) + ', img[itemprop="logo"]', "website logo link"),
        ('img[alt*="logo" i], img[class*="logo" i], img[src*="/logo/" i]', "explicit website logo"),
    ):
        for image in soup.select(selector)[:20]:
            if visible(image):
                add_logo(image_source(image), reason)
    for image in soup.select('header img, nav img, img[src], img[data-src]')[:80]:
        if not visible(image):
            continue
        src = image_source(image)
        if logo_named(src):
            add_logo(src, 'explicit website logo')
    for script in soup.select('script[type="application/ld+json"]')[:10]:
        if len(script.get_text()) > 20000:
            continue
        try:
            data = json.loads(script.get_text())
            items = data if isinstance(data, list) else [data]
            if isinstance(data, dict):
                items += data.get("@graph", [])[:20] if isinstance(data.get("@graph"), list) else []
            for item in items[:20]:
                if not isinstance(item, dict):
                    continue
                raw_type = item.get('@type')
                types = raw_type if isinstance(raw_type, list) else [raw_type]
                if not any(isinstance(kind, str) and kind.rsplit('/', 1)[-1] in {"Organization", "LocalBusiness", "Corporation", "ProfessionalService", "Store", "Restaurant"} for kind in types):
                    continue
                structured.append({k: clean_text(str(item[k]), 1000) for k in ["name", "description", "address", "telephone", "email", "url", "sameAs"] if k in item})
                if not location.get("street"):
                    location = structured_location(item.get("address"))
                add_logo(item.get("logo"), "structured organization logo")
        except (ValueError, TypeError):
            pass
    for image in soup.select('header img')[:8]:
        add_logo(image_source(image), "website logo element")
    for tag in soup.select('link[rel~="preload"][as="image"][href]')[:15]:
        if logo_named(tag['href']):
            add_logo(tag['href'], 'preloaded website logo')
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
    stylesheets = []
    for link in soup.select('link[rel~="stylesheet"][href]')[:30]:
        try:
            target = validate_url(urljoin(url, link['href']))
        except ExtractionError:
            continue
        if re.search(r'font-awesome|fonts\.google|bootstrap|calendar|icons\.css', target, re.I):
            continue
        stylesheets.append(target)
    for element in soup.select("script,style,noscript,form,[hidden],[aria-hidden=true],.cookie-banner,#cookie-banner"):
        element.decompose()
    for element in soup.find_all(style=True):
        # A hidden ancestor decomposed earlier in this loop leaves its descendants without attrs.
        if element.decomposed or element.attrs is None:
            continue
        if re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", element.get("style", ""), re.I):
            element.decompose()
    contact_details = public_contact_details(soup, structured, location)
    for element in soup.select("nav,footer,header"):
        element.decompose()
    headings = [clean_text(h.get_text(" "), 300) for h in soup.find_all(["h1", "h2", "h3"])[:30]]
    root = soup.find("main") or soup.find("article") or soup.body or soup
    paragraphs = list(dict.fromkeys(clean_text(line, 2000) for line in root.get_text("\n").splitlines() if clean_text(line)))
    return {"url": url, **metadata, "headings": headings, "cleaned_text": "\n".join(paragraphs)[:12000], "structured_data": structured[:10], "contacts": list(dict.fromkeys(contacts))[:20], "contact_details": contact_details, "logo_candidates":logos[:5],"style_colors":colors,"stylesheet_urls":list(dict.fromkeys(stylesheets))[:2]}, list(dict.fromkeys(links))[:20], social
