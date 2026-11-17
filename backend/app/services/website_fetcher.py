"""HTTPX with a connection-time public-IP guard; original host remains TLS SNI/Host."""
import asyncio
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit, urljoin

import httpcore
import httpx
from httpcore._backends.auto import AutoBackend

from app.core.extraction_config import extraction_settings as limits
from app.services.extraction_errors import ExtractionError


def validate_url(value: str) -> str:
    try:
        if len(value) > 2048 or any(c.isspace() or ord(c) < 32 or c == "\\" for c in value):
            raise ValueError()
        u = httpx.URL(value)
        parsed = urlsplit(value)
        host = u.host.rstrip(".").lower()
        if u.scheme not in {"http", "https"} or not host or "%" in host or parsed.username is not None or parsed.password is not None or u.port not in {None, 80, 443}:
            raise ValueError()
        if (u.scheme == "https" and u.port == 80) or (u.scheme == "http" and u.port == 443):
            raise ValueError()
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".home", ".test", ".example", ".invalid")):
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if "." not in host or all(c in "0123456789.xabcdef" for c in host):
                raise ValueError()
        else:
            if not public_ip(address):
                raise ValueError()
        return str(u.copy_with(fragment=None))
    except (ValueError, httpx.InvalidURL):
        raise ExtractionError("unsafe_url", "Use a public HTTP(S) website on port 80 or 443 without credentials.") from None


def public_ip(address):
    # Exclude transition mechanisms as well as all special-use/non-global ranges.
    return address.is_global and not address.is_multicast and not address.is_reserved and not (
        isinstance(address, ipaddress.IPv6Address) and address not in ipaddress.ip_network("2000::/3")
    ) and not (
        isinstance(address, ipaddress.IPv6Address) and (address.ipv4_mapped or address.sixtofour or address.teredo or address in ipaddress.ip_network("64:ff9b::/96"))
    )


async def resolve_public(host: str, port: int):
    try:
        answers = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), timeout=limits.request_timeout)
        addresses = list(dict.fromkeys(row[4][0] for row in answers))
        if not addresses or any(not public_ip(ipaddress.ip_address(ip)) for ip in addresses):
            raise ExtractionError("unsafe_destination", "The website resolves to a restricted network address.")
        return addresses
    except (socket.gaierror, ValueError, asyncio.TimeoutError):
        raise ExtractionError("dns_failure", "The public website hostname could not be resolved.", True) from None


class PublicNetworkBackend(AutoBackend):
    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        # Resolve on EVERY socket creation and pass only a numeric validated IP to
        # the actual connector. No second hostname lookup can rebind the socket.
        if port not in {80, 443}:
            raise ExtractionError("unsafe_destination", "Unsupported website port.")
        addresses = await resolve_public(host, port)
        return await super().connect_tcp(addresses[0], port, timeout=timeout, local_address=None, socket_options=socket_options)


class PublicTransport(httpx.AsyncHTTPTransport):
    def __init__(self):
        super().__init__(trust_env=False, retries=0)
        # HTTPX's adapter handles request/response translation; HTTPcore's public
        # network_backend interface pins socket destinations. Versions are pinned.
        self._pool = httpcore.AsyncConnectionPool(ssl_context=ssl.create_default_context(), network_backend=PublicNetworkBackend(), max_connections=2, max_keepalive_connections=0, retries=0)


def origin(url):
    u = httpx.URL(url)
    return (u.scheme, u.host, u.port)


def canonical_redirect_allowed(initial, target):
    """Only an exact www alias and/or HTTP->HTTPS upgrade; never a downgrade."""
    left, right = origin(initial), origin(target)
    return (left[1].removeprefix("www.") == right[1].removeprefix("www.")
            and (left[0] == right[0] or (left[0], right[0]) == ("http", "https")))


class WebsiteFetcher:
    def __init__(self, client=None):
        self.client = client or httpx.AsyncClient(transport=PublicTransport(), trust_env=False, follow_redirects=False, timeout=limits.request_timeout, headers={"User-Agent": "SocialAIResearchBot/1.0", "Accept": "text/html,application/xhtml+xml", "Accept-Encoding": "identity"})

    async def close(self):
        await self.client.aclose()

    async def get(self, url, *, allowed_origin=None, robots=False, before_request=None, allow_canonical=False, media=False):
        url = validate_url(url)
        initial_url = url
        for redirect in range(limits.max_redirects + 1):
            if allowed_origin and origin(url) != allowed_origin and not (allow_canonical and canonical_redirect_allowed(initial_url, url)):
                error = ExtractionError("external_redirect", "The website redirected outside the permitted origin. Submit its final public URL instead.")
                error.redirect_to = url  # already validated; callers decide whether to follow
                raise error
            if before_request:
                await before_request(url)
            try:
                async with asyncio.timeout(limits.request_timeout):
                    async with self.client.stream("GET", url) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            if redirect == limits.max_redirects or not response.headers.get("location"):
                                raise ExtractionError("redirect_limit", "The website redirected too many times.")
                            url = validate_url(urljoin(url, response.headers["location"]))
                            continue
                        if robots and response.status_code in {404, 410}:
                            return url, "", response.status_code
                        if response.status_code in {401, 403, 429}:
                            raise ExtractionError("restricted", "The website restricts automated access. Enter details manually or try later.", response.status_code == 429)
                        if response.status_code >= 400:
                            raise ExtractionError("website_error", f"The website returned HTTP {response.status_code}.", response.status_code >= 500)
                        mime = response.headers.get("content-type", "").split(";")[0].lower()
                        if "noai" in response.headers.get("x-robots-tag", "").lower():
                            raise ExtractionError("restricted", "The website explicitly restricts AI processing.")
                        if mime not in ({"image/png","image/jpeg","image/webp","image/svg+xml"} if media else {"text/plain", "text/html"} if robots else {"text/html", "application/xhtml+xml"}):
                            raise ExtractionError("unsupported_content", "The website did not return supported HTML content.")
                        if response.headers.get("content-encoding", "identity").lower() not in {"", "identity"}:
                            raise ExtractionError("unsupported_encoding", "The website ignored the bounded uncompressed response request.")
                        body = bytearray()
                        async for chunk in response.aiter_raw(chunk_size=16384):
                            body.extend(chunk)
                            if len(body) > limits.max_bytes:
                                raise ExtractionError("body_limit", "The website response exceeded the page size limit.")
                        return (url, (bytes(body),mime), response.status_code) if media else (url, body.decode("utf-8", errors="replace"), response.status_code)
            except (httpx.TimeoutException, asyncio.TimeoutError):
                raise ExtractionError("website_timeout", "The website took too long to respond.", True) from None
            except httpx.RequestError:
                raise ExtractionError("website_unavailable", "The website could not be reached securely.", True) from None
