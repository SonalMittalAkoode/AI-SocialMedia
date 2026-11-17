import asyncio
import ipaddress
import socket
from unittest.mock import AsyncMock
import httpx
import pytest

from app.core.extraction_config import extraction_settings as limits
from app.services.website_fetcher import validate_url, resolve_public, PublicNetworkBackend, WebsiteFetcher, public_ip
from app.services.html_extractor import parse_html
from app.services.website_extraction import extract_website
from app.services.extraction_errors import ExtractionError


def run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("url", ["https://www.python.org", "http://www.python.org/about"])
def test_public_url_syntax(url):
    assert validate_url(url) == url


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.org", "http://localhost", "http://127.0.0.1", "http://10.0.0.1", "http://192.168.1.2", "http://169.254.169.254", "http://[::1]", "http://[fc00::1]", "http://[fe80::1]", "http://2130706433", "http://0x7f000001", "http://127.1", "https://user:pass@example.org", "https://example.org:8080", "https://bad host.org", "https://[invalid", "http://host.internal"])
def test_unsafe_url_rejected(url):
    with pytest.raises(ExtractionError):
        validate_url(url)


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:8.8.8.8", "2002:0808:0808::1", "64:ff9b::808:808", "fec0::1"])
def test_non_public_addresses(ip):
    assert not public_ip(ipaddress.ip_address(ip))


def test_mixed_dns_and_alternative_ip_rejected(monkeypatch):
    async def check():
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(loop, "getaddrinfo", AsyncMock(return_value=[(socket.AF_INET, 1, 6, "", ("8.8.8.8", 443)), (socket.AF_INET, 1, 6, "", ("127.0.0.1", 443))]))
        with pytest.raises(ExtractionError, match="restricted"):
            await resolve_public("business.org", 443)
    run(check())


def test_connection_binds_public_numeric_ip_and_rechecks_dns(monkeypatch):
    from httpcore._backends.auto import AutoBackend
    dns = AsyncMock(side_effect=[["8.8.8.8"], ExtractionError("unsafe", "rebind blocked")])
    connect = AsyncMock(return_value=object())
    monkeypatch.setattr("app.services.website_fetcher.resolve_public", dns)
    monkeypatch.setattr(AutoBackend, "connect_tcp", connect)
    async def check():
        backend = PublicNetworkBackend()
        await backend.connect_tcp("business.org", 443)
        assert connect.call_args.args[:2] == ("8.8.8.8", 443)
        with pytest.raises(ExtractionError):
            await backend.connect_tcp("business.org", 443)
        assert connect.call_count == 1
    run(check())


def test_pinned_transport_preserves_hostname_for_tls_and_host_header(monkeypatch):
    from httpcore._backends.auto import AutoBackend
    from app.services.website_fetcher import PublicTransport
    class Socket:
        def __init__(self):self.written=b"";self.sni=None
        async def read(self,max_bytes,timeout=None):return b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
        async def write(self,buffer,timeout=None):self.written+=buffer
        async def aclose(self):pass
        async def start_tls(self,ssl_context,server_hostname=None,timeout=None):self.sni=server_hostname;return self
        def get_extra_info(self,info):return None
    stream=Socket()
    monkeypatch.setattr("app.services.website_fetcher.resolve_public",AsyncMock(return_value=["8.8.8.8"]))
    connector=AsyncMock(return_value=stream)
    monkeypatch.setattr(AutoBackend,"connect_tcp",connector)
    async def check():
        async with httpx.AsyncClient(transport=PublicTransport(),trust_env=False) as client:
            assert (await client.get("https://business.org")).text=="OK"
    run(check())
    assert stream.sni=="business.org"
    assert b"Host: business.org" in stream.written
    assert connector.call_args.args[:2]==("8.8.8.8",443)


class Stream(httpx.AsyncByteStream):
    def __init__(self, content):
        self.content = content
    async def __aiter__(self):
        for i in range(0, len(self.content), 100):
            yield self.content[i:i+100]


def fetcher(handler):
    return WebsiteFetcher(httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False, trust_env=False))


def response(content=b"hello", status=200, mime="text/html", **headers):
    return httpx.Response(status, headers={"content-type": mime, **headers}, stream=Stream(content))


def test_stream_limit_mime_redirects_timeout(monkeypatch):
    async def check():
        monkeypatch.setattr(limits, "max_bytes", 200)
        for handler, code in [
            (lambda r: response(b"a"*201), "body_limit"),
            (lambda r: response(mime="application/pdf"), "unsupported_content"),
            (lambda r: response(status=302, location="http://127.0.0.1"), "unsafe_url"),
            (lambda r: response(status=302, location="/loop"), "redirect_limit"),
            (lambda r: response(status=403), "restricted"),
            (lambda r: response(status=404), "website_error"),
            (lambda r: response(**{"content-encoding":"gzip"}), "unsupported_encoding"),
        ]:
            f = fetcher(handler)
            with pytest.raises(ExtractionError) as error:
                await f.get("https://business.org")
            assert error.value.code == code
            await f.close()
        def timeout(request):
            raise httpx.ReadTimeout("private")
        f = fetcher(timeout)
        with pytest.raises(ExtractionError) as error:
            await f.get("https://business.org")
        assert error.value.code == "website_timeout"
        await f.close()
    run(check())


HTML = b'''<html><head><title>Example Engineering</title><meta name="description" content="Useful business description"><script type="application/ld+json">{"@type":"Organization","name":"Example Engineering"}</script></head><body><nav>duplicate menu</nav><main><h1>Our services</h1><p>We design reliable software for independent businesses and provide ongoing technical support for teams.</p><p>We design reliable software for independent businesses and provide ongoing technical support for teams.</p><a href="/about">About us</a><a href="/services">Services</a><a href="https://instagram.com/example">Instagram</a><div hidden>hidden claim</div></main></body></html>'''


def test_metadata_cleaning_discovery_and_malformed_html():
    page, links, social = parse_html("https://business.org", HTML)
    assert page["title"] == "Example Engineering"
    assert page["description"] == "Useful business description"
    assert page["headings"] == ["Our services"]
    assert page["structured_data"][0]["name"] == "Example Engineering"
    assert page["cleaned_text"].count("We design") == 1
    assert "hidden claim" not in page["cleaned_text"] and "duplicate menu" not in page["cleaned_text"]
    assert links == ["https://business.org/about", "https://business.org/services"]
    assert social == {"instagram":"https://instagram.com/example"}
    assert parse_html("https://business.org", "<h1>Broken<p>Still readable")[0]["headings"]


def test_crawl_robots_scope_limits_and_empty_page(monkeypatch):
    async def check():
        calls=[]
        def handler(request):
            calls.append(str(request.url))
            if request.url.path == "/robots.txt":
                return response(b"User-agent: *\nDisallow: /services", mime="text/plain")
            return response(HTML)
        result = await extract_website("https://business.org", fetcher=fetcher(handler))
        assert len(result["pages"]) == 2
        assert "https://business.org/services" not in calls
        assert result["warnings"]
        f=fetcher(lambda r: response(b"User-agent: *\nDisallow: /",mime="text/plain") if r.url.path=="/robots.txt" else response(HTML))
        with pytest.raises(ExtractionError) as error:
            await extract_website("https://business.org",fetcher=f)
        assert error.value.code=="robots_restricted"
        f=fetcher(lambda r: response(status=404) if r.url.path=="/robots.txt" else response(b"<html></html>"))
        with pytest.raises(ExtractionError) as error:
            await extract_website("https://business.org",fetcher=f)
        assert error.value.code=="insufficient_content"
    run(check())


def test_redirect_path_obeys_robots_before_request():
    calls=[]
    def handler(r):
        calls.append(r.url.path)
        if r.url.path=="/robots.txt":return response(b"User-agent: *\nDisallow: /private",mime="text/plain")
        return response(status=302,location="/private")
    with pytest.raises(ExtractionError):
        run(extract_website("https://business.org",fetcher=fetcher(handler)))
    assert "/private" not in calls


@pytest.mark.parametrize("html", ['<meta name="robots" content="noai">', '<title>Just a moment</title><p>Checking your browser</p>'])
def test_explicit_ai_opt_out_and_access_challenges(html):
    with pytest.raises(ExtractionError) as error:
        parse_html("https://business.org",html)
    assert error.value.code=="restricted"


@pytest.mark.parametrize("url", ["https://@example.org", "https://:@example.org", "http://[2001:4860::1%eth0]"])
def test_empty_userinfo_and_scoped_addresses_rejected(url):
    with pytest.raises(ExtractionError):validate_url(url)


def test_nested_hidden_elements_do_not_crash_parser():
    # Regression: decomposing a hidden parent left hidden children with attrs=None.
    from app.services.html_extractor import parse_html
    html = '<html><body><main><div style="display:none"><span style="visibility:hidden">secret</span></div><p>Visible public business text for research.</p></main></body></html>'
    page, _, _ = parse_html("https://business.org", html)
    assert "Visible public business text" in page["cleaned_text"] and "secret" not in page["cleaned_text"]
