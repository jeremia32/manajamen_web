from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import re
import secrets
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote, urljoin, urlparse

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class ConnectorError(Exception):
    pass


def _credential_key() -> bytes:
    from os import getenv

    secret = getenv("SOURCE_CREDENTIALS_KEY") or getenv("SUPABASE_SECRET_KEY") or getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not secret:
        raise ConnectorError("SUPABASE_SECRET_KEY diperlukan untuk mengenkripsi kredensial konektor.")
    return hashlib.sha256(("documind-source-credentials:" + secret).encode()).digest()


def encrypt_credentials(credentials: dict[str, str]) -> str:
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(_credential_key()).encrypt(nonce, json.dumps(credentials).encode(), None)
    return base64.urlsafe_b64encode(nonce + encrypted).decode()


def decrypt_credentials(value: str | None) -> dict[str, str]:
    if not value:
        return {}
    try:
        payload = base64.urlsafe_b64decode(value.encode())
        return json.loads(AESGCM(_credential_key()).decrypt(payload[:12], payload[12:], None))
    except Exception as error:
        raise ConnectorError("Kredensial sumber tidak dapat dibuka. Periksa SOURCE_CREDENTIALS_KEY dan key Supabase.") from error


def _github_headers(token: str = "") -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _github_repository(repository: str, token: str = "") -> tuple[dict[str, Any], dict[str, Any]]:
    repo = repository.strip().strip("/")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ConnectorError("Repository GitHub harus berformat owner/repo.")
    response = requests.get(f"https://api.github.com/repos/{repo}", headers=_github_headers(token), timeout=20)
    if response.status_code >= 400:
        raise ConnectorError(f"GitHub menolak repository (HTTP {response.status_code}). Periksa URL dan akses token.")
    info = response.json()
    tree_response = requests.get(
        f"https://api.github.com/repos/{repo}/git/trees/{quote(info['default_branch'], safe='')}",
        params={"recursive": "1"}, headers=_github_headers(token), timeout=30,
    )
    if tree_response.status_code >= 400:
        raise ConnectorError(f"GitHub gagal membaca file repository (HTTP {tree_response.status_code}).")
    return info, tree_response.json()


def _github_documents(repository: str, token: str = "", limit: int = 100) -> list[dict[str, Any]]:
    info, tree = _github_repository(repository, token)
    repo = info["full_name"]
    branch = info["default_branch"]
    files = [
        item for item in tree.get("tree", [])
        if item.get("type") == "blob"
        and item.get("path", "").lower().endswith((".md", ".mdx", ".txt", ".rst"))
        and ("/" not in item.get("path", "") or item.get("path", "").lower().startswith("docs/"))
    ][:limit]
    documents = []
    for item in files:
        path = item["path"]
        content_url = f"https://api.github.com/repos/{repo}/contents/{quote(path, safe='/')}"
        headers = _github_headers(token)
        headers["Accept"] = "application/vnd.github.raw+json"
        response = requests.get(content_url, params={"ref": branch}, headers=headers, timeout=20)
        if response.status_code >= 400:
            continue
        text = response.text[:2_000_000]
        if not text.strip():
            continue
        documents.append({
            "external_id": path,
            "title": f"{repo}/{path}",
            "text": text,
            "updated_at": item.get("sha"),
            "url": f"https://github.com/{repo}/blob/{branch}/{path}",
        })
    return documents


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.links: list[str] = []
        self.title_parts: list[str] = []
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._skip:
            self._skip -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        cleaned = " ".join(data.split())
        if not cleaned or self._skip:
            return
        if self._in_title:
            self.title_parts.append(cleaned)
        self.text.append(cleaned)


def _assert_public_web_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ConnectorError("URL hanya boleh menggunakan http:// atau https:// dan host publik.")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
    except OSError as error:
        raise ConnectorError(f"Host website tidak dapat di-resolve: {error}") from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ConnectorError("URL ke jaringan lokal, private, atau reserved tidak diizinkan.")


def _safe_web_get(url: str) -> requests.Response:
    current = url
    for _ in range(5):
        _assert_public_web_url(current)
        response = requests.get(current, headers={"User-Agent": "DocuMindKnowledgeBot/1.0"}, timeout=20, allow_redirects=False)
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("location")
            if not location:
                return response
            current = urljoin(current, location)
            continue
        return response
    raise ConnectorError("Website terlalu banyak melakukan redirect.")


def _website_documents(start_url: str, max_pages: int = 8) -> list[dict[str, Any]]:
    parsed = urlparse(start_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ConnectorError("URL web harus menggunakan http:// atau https://.")
    host = parsed.hostname.lower()
    queue = [start_url]
    seen: set[str] = set()
    documents = []
    while queue and len(documents) < max_pages:
        url = queue.pop(0).split("#", 1)[0]
        if url in seen:
            continue
        seen.add(url)
        try:
            response = _safe_web_get(url)
        except (requests.RequestException, ConnectorError) as error:
            if not documents:
                raise ConnectorError(f"Tidak dapat membuka halaman web: {error}") from error
            continue
        if response.status_code >= 400 or "text/html" not in response.headers.get("content-type", "").lower():
            if not documents:
                raise ConnectorError(f"Halaman web mengembalikan HTTP {response.status_code} atau bukan HTML.")
            continue
        parser = _PageParser()
        parser.feed(response.text[:2_000_000])
        text = "\n".join(parser.text)
        if len(text) > 200:
            documents.append({"external_id": url, "title": " ".join(parser.title_parts) or url, "text": text, "updated_at": response.headers.get("last-modified") or response.headers.get("etag"), "url": url})
        if len(seen) < max_pages:
            for link in parser.links:
                absolute = urljoin(url, link).split("#", 1)[0]
                target = urlparse(absolute)
                if target.scheme in {"http", "https"} and target.hostname and target.hostname.lower() == host and absolute not in seen and absolute not in queue:
                    queue.append(absolute)
    if not documents:
        raise ConnectorError("Tidak ditemukan halaman HTML berisi teks yang bisa diindeks.")
    return documents


def _notion_headers(token: str) -> dict[str, str]:
    if not token:
        raise ConnectorError("Notion integration token wajib diisi.")
    return {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}


def _rich_text(value: Any) -> str:
    if isinstance(value, list):
        return "".join(str(item.get("plain_text", "")) for item in value if isinstance(item, dict))
    if isinstance(value, dict):
        return _rich_text(value.get("rich_text") or value.get("title") or [])
    return ""


def _notion_block_text(block: dict[str, Any]) -> str:
    block_type = block.get("type")
    body = block.get(block_type, {}) if block_type else {}
    text = _rich_text(body.get("rich_text") or body.get("title") or [])
    if block_type in {"child_page", "child_database"}:
        text = str(body.get("title", ""))
    return text


def _notion_children(token: str, block_id: str, depth: int = 0) -> str:
    if depth > 3:
        return ""
    headers = _notion_headers(token)
    results: list[dict[str, Any]] = []
    cursor = None
    while True:
        params = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        response = requests.get(f"https://api.notion.com/v1/blocks/{block_id}/children", headers=headers, params=params, timeout=20)
        if response.status_code >= 400:
            raise ConnectorError(f"Notion gagal membaca isi halaman (HTTP {response.status_code}).")
        result = response.json()
        results.extend(result.get("results", []))
        if not result.get("has_more") or not result.get("next_cursor"):
            break
        cursor = result["next_cursor"]
    parts = []
    for block in results:
        text = _notion_block_text(block)
        if text:
            parts.append(text)
        if block.get("has_children"):
            nested = _notion_children(token, block["id"], depth + 1)
            if nested:
                parts.append(nested)
    return "\n".join(parts)


def _notion_documents(token: str, limit: int = 100) -> list[dict[str, Any]]:
    headers = _notion_headers(token)
    pages: list[dict[str, Any]] = []
    cursor = None
    while len(pages) < limit:
        payload: dict[str, Any] = {"page_size": min(limit - len(pages), 100), "filter": {"property": "object", "value": "page"}}
        if cursor:
            payload["start_cursor"] = cursor
        response = requests.post("https://api.notion.com/v1/search", headers=headers, json=payload, timeout=20)
        if response.status_code >= 400:
            raise ConnectorError(f"Notion menolak permintaan search (HTTP {response.status_code}). Periksa token dan akses integration.")
        result = response.json()
        pages.extend(result.get("results", []))
        if not result.get("has_more") or not result.get("next_cursor"):
            break
        cursor = result["next_cursor"]
    pages = pages[:limit]
    documents = []
    for page in pages:
        properties = page.get("properties", {})
        title = next((_rich_text(value) for value in properties.values() if isinstance(value, dict) and (value.get("type") == "title" or "title" in value)), "")
        body = _notion_children(token, page["id"])
        if title or body:
            documents.append({"external_id": page["id"], "title": title or "Notion page", "text": f"{title}\n\n{body}".strip(), "updated_at": page.get("last_edited_time"), "url": page.get("url")})
    return documents


def test_connector(source_type: str, credentials: dict[str, str]) -> int:
    if source_type == "github":
        _, tree = _github_repository(credentials.get("repository", ""), credentials.get("apiKey", ""))
        return sum(1 for item in tree.get("tree", []) if item.get("type") == "blob" and item.get("path", "").lower().endswith((".md", ".mdx", ".txt", ".rst")))
    if source_type == "website":
        return len(_website_documents(credentials.get("baseUrl", ""), max_pages=1))
    if source_type == "notion":
        response = requests.post("https://api.notion.com/v1/search", headers=_notion_headers(credentials.get("apiKey", "")), json={"page_size": 1, "filter": {"property": "object", "value": "page"}}, timeout=20)
        if response.status_code >= 400:
            raise ConnectorError(f"Notion menolak token (HTTP {response.status_code}). Periksa token dan page sharing.")
        result = response.json()
        return int(result.get("total", len(result.get("results", []))))
    raise ConnectorError(f"Konektor {source_type} belum didukung.")


def fetch_connector_documents(source_type: str, credentials: dict[str, str]) -> list[dict[str, Any]]:
    if source_type == "github":
        return _github_documents(credentials.get("repository", ""), credentials.get("apiKey", ""))
    if source_type == "website":
        return _website_documents(credentials.get("baseUrl", ""))
    if source_type == "notion":
        return _notion_documents(credentials.get("apiKey", ""))
    raise ConnectorError(f"Konektor {source_type} belum didukung.")
