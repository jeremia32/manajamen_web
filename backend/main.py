from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager, suppress
from html import unescape
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, TypedDict
from uuid import NAMESPACE_URL, uuid4, uuid5
from urllib.parse import quote, urlencode, urlparse

from dotenv import load_dotenv
from backend.connectors import ConnectorError, decrypt_credentials, encrypt_credentials, fetch_connector_documents, test_connector
from docx import Document as DocxDocument
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from huggingface_hub import InferenceClient
from huggingface_hub.errors import HfHubHTTPError
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langgraph.graph import END, START, StateGraph
import msal
from openai import AuthenticationError
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFException
from pydantic import BaseModel, Field
from pypdf import PdfReader
import pdfplumber
import requests
from backend.auth import get_supabase, require_authenticated_user

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

logger = logging.getLogger(__name__)


async def _meeting_reminder_worker() -> None:
    while True:
        try:
            from backend.meetings import process_due_meeting_reminders

            await asyncio.to_thread(process_due_meeting_reminders)
        except Exception:
            logger.exception("Meeting reminder processing failed")
        await asyncio.sleep(max(10, int(os.getenv("MEETING_REMINDER_POLL_SECONDS", "30"))))


@asynccontextmanager
async def lifespan(_: FastAPI):
    reminder_task = asyncio.create_task(_meeting_reminder_worker())
    try:
        yield
    finally:
        reminder_task.cancel()
        with suppress(asyncio.CancelledError):
            await reminder_task


app = FastAPI(title="DocuMind LangGraph API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("BACKEND_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_SUFFIXES = {".pdf", ".docx", ".txt", ".md"}
text_splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=180)
_embeddings: dict[str, Any] = {}
_chat_models: dict[str, Any] = {}
HF_EMBEDDING_DIMENSION = 1024
HF_EMBEDDING_BATCH_SIZE = 16


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    sourceIds: list[str] = Field(default_factory=list)
    language: str = "id"
    conversationId: str | None = None


class DocumentQuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=12000)
    language: str = "id"
    provider: Literal["openai", "huggingface"] | None = None


class KnowledgeSourceInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    type: str = "outline"
    credentials: dict[str, str] = Field(default_factory=dict)


class MicrosoftSyncRequest(BaseModel):
    teamId: str = Field(min_length=1)
    channelId: str = Field(min_length=1)


class GoogleDriveImportRequest(BaseModel):
    fileId: str = Field(min_length=1, max_length=256)


class RAGState(TypedDict, total=False):
    question: str
    source_ids: list[str]
    language: str
    matches: list[dict[str, Any]]
    answer: str
    sources: list[dict[str, Any]]


class AnalysisResult(BaseModel):
    extractedFields: dict[str, str]
    summary: str
    risks: list[dict[str, str]]


class HuggingFaceEmbeddings:
    def __init__(self, token: str, model: str) -> None:
        self.client = InferenceClient(model=model, provider="auto", token=token, timeout=60)
        self.query_instruction = os.getenv(
            "HF_EMBEDDING_QUERY_INSTRUCTION",
            "Given a question, retrieve relevant passages that answer the question",
        )

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), HF_EMBEDDING_BATCH_SIZE):
            batch = texts[start:start + HF_EMBEDDING_BATCH_SIZE]
            try:
                output = self.client.feature_extraction(
                    batch,
                    normalize=True,
                    dimensions=HF_EMBEDDING_DIMENSION,
                )
            except HfHubHTTPError as error:
                status_code = getattr(getattr(error, "response", None), "status_code", None)
                if status_code in {401, 403}:
                    raise HTTPException(
                        status_code=503,
                        detail="Hugging Face menolak HF_TOKEN. Periksa token dan izin Inference Providers.",
                    ) from error
                if status_code == 402:
                    raise HTTPException(
                        status_code=402,
                        detail="Hugging Face Inference Providers membutuhkan billing atau kredit yang tersedia.",
                    ) from error
                raise HTTPException(
                    status_code=502,
                    detail=f"Hugging Face Inference Providers gagal (HTTP {status_code or 'unknown'}).",
                ) from error

            if hasattr(output, "tolist"):
                output = output.tolist()
            if not isinstance(output, list) or len(output) != len(batch):
                raise HTTPException(
                    status_code=502,
                    detail="Hugging Face mengembalikan jumlah embedding yang tidak sesuai dengan input.",
                )
            for vector in output:
                if not isinstance(vector, list) or len(vector) != HF_EMBEDDING_DIMENSION:
                    actual_dimension = len(vector) if isinstance(vector, list) else "unknown"
                    raise HTTPException(
                        status_code=502,
                        detail=f"Dimensi embedding Hugging Face tidak sesuai: diterima {actual_dimension}, diharapkan {HF_EMBEDDING_DIMENSION}.",
                    )
                vectors.append([float(value) for value in vector])
        return vectors

    def embed_query(self, text: str) -> list[float]:
        instructed_query = f"Instruct: {self.query_instruction}\nQuery: {text}"
        return self.embed_documents([instructed_query])[0]


def get_llm_provider(provider: str | None = None) -> str:
    selected = (provider or os.getenv("LLM_PROVIDER", "openai")).strip().lower()
    if selected not in {"openai", "huggingface"}:
        raise HTTPException(status_code=500, detail="LLM_PROVIDER harus bernilai openai atau huggingface.")
    return selected


def get_embedding_provider(provider: str | None = None) -> str:
    selected = (provider or os.getenv("EMBEDDING_PROVIDER", "openai")).strip().lower()
    if selected not in {"openai", "huggingface"}:
        raise HTTPException(status_code=500, detail="EMBEDDING_PROVIDER harus bernilai openai atau huggingface.")
    return selected


def get_embedding_column(provider: str | None = None) -> str:
    return "embedding_hf" if get_embedding_provider(provider) == "huggingface" else "embedding"


def is_provider_auth_error(error: Exception) -> bool:
    return isinstance(error, AuthenticationError) or getattr(error, "status_code", None) in {401, 403}


def provider_http_status(error: Exception) -> int:
    if getattr(error, "status_code", None) == 402:
        return 402
    return 503 if is_provider_auth_error(error) else 502


def provider_error_detail(error: Exception, provider: str | None = None) -> str:
    if getattr(error, "status_code", None) == 402:
        selected = (provider or os.getenv("LLM_PROVIDER", "openai")).strip().lower()
        if selected == "huggingface":
            return "Hugging Face Inference Providers mengembalikan HTTP 402. Periksa billing, kredit/saldo, dan akses provider untuk akun HF Anda."
        return "Provider AI mengembalikan HTTP 402. Periksa billing atau kredit akun provider."
    if is_provider_auth_error(error):
        if get_llm_provider(provider) == "openai":
            return "OpenAI menolak OPENAI_API_KEY. Periksa key dan akses model."
        return "Hugging Face menolak HF_TOKEN. Periksa token dan izin Inference Providers."
    return str(error)


def invoke_chat_with_fallback(
    messages: list[tuple[str, str]],
    provider: str | None = "huggingface",
) -> tuple[Any, str]:
    selected = get_llm_provider(provider)
    try:
        return get_chat_model(selected).invoke(messages), selected
    except Exception as primary_error:
        if selected != "huggingface" or not os.getenv("OPENAI_API_KEY"):
            raise

        try:
            result = get_chat_model("openai").invoke(messages)
        except Exception as fallback_error:
            raise HTTPException(
                status_code=provider_http_status(fallback_error),
                detail=(
                    "Hugging Face gagal: "
                    f"{provider_error_detail(primary_error, 'huggingface')} "
                    "Fallback OpenAI juga gagal: "
                    f"{provider_error_detail(fallback_error, 'openai')}"
                ),
            ) from fallback_error
        return result, "openai"


def get_embeddings(provider: str | None = None) -> Any:
    selected = get_embedding_provider(provider)
    if selected == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="OPENAI_API_KEY belum diatur di .env.")
        model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        cache_key = f"openai:{model}"
        if cache_key not in _embeddings:
            _embeddings[cache_key] = OpenAIEmbeddings(model=model, api_key=api_key)
        return _embeddings[cache_key]

    token = os.getenv("HF_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="HF_TOKEN belum diatur di .env. Token harus memiliki izin Inference Providers.")
    model = os.getenv("HF_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B")
    cache_key = f"huggingface:{model}"
    if cache_key not in _embeddings:
        _embeddings[cache_key] = HuggingFaceEmbeddings(token=token, model=model)
    return _embeddings[cache_key]


def embed_documents(texts: list[str], provider: str | None = None) -> list[list[float]]:
    selected = get_embedding_provider(provider)
    try:
        return get_embeddings(selected).embed_documents(texts)
    except AuthenticationError as error:
        detail = (
            "OpenAI menolak OPENAI_API_KEY. Periksa key dan akses model."
            if selected == "openai"
            else "Hugging Face menolak HF_TOKEN. Periksa token dan izin Inference Providers."
        )
        raise HTTPException(status_code=503, detail=detail) from error


def embed_query(text: str, provider: str | None = None) -> list[float]:
    selected = get_embedding_provider(provider)
    try:
        return get_embeddings(selected).embed_query(text)
    except AuthenticationError as error:
        detail = (
            "OpenAI menolak OPENAI_API_KEY. Periksa key dan akses model."
            if selected == "openai"
            else "Hugging Face menolak HF_TOKEN. Periksa token dan izin Inference Providers."
        )
        raise HTTPException(status_code=503, detail=detail) from error


def get_chat_model(provider: str | None = None) -> Any:
    selected = get_llm_provider(provider)
    if selected == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="OPENAI_API_KEY belum diatur di .env.")
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        cache_key = f"openai:{model}"
        if cache_key not in _chat_models:
            _chat_models[cache_key] = ChatOpenAI(model=model, temperature=0, api_key=api_key)
        return _chat_models[cache_key]

    token = os.getenv("HF_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="HF_TOKEN belum diatur di .env. Token harus memiliki izin Inference Providers.")
    model = os.getenv("HF_CHAT_MODEL", "openai/gpt-oss-120b:cheapest")
    cache_key = f"huggingface:{model}"
    if cache_key not in _chat_models:
        _chat_models[cache_key] = ChatOpenAI(
            model=model,
            base_url="https://router.huggingface.co/v1",
            temperature=0,
            api_key=token,
        )
    return _chat_models[cache_key]


def retrieve(question: str, source_ids: list[str] | None = None, limit: int = 6) -> list[dict[str, Any]]:
    provider = get_embedding_provider()
    embedding = embed_query(question, provider)
    rpc_name = "match_document_chunks_hf" if provider == "huggingface" else "match_document_chunks"
    response = get_supabase().rpc(
        rpc_name,
        {"query_embedding": embedding, "match_count": limit, "filter": {}, "source_ids": source_ids or None},
    ).execute()
    return response.data or []


def retrieve_node(state: RAGState) -> dict[str, Any]:
    return {"matches": retrieve(state["question"], state.get("source_ids"))}


def answer_node(state: RAGState) -> dict[str, Any]:
    matches = state.get("matches", [])
    if not matches:
        return {
            "answer": "Saya belum menemukan dokumen yang relevan. Unggah dan indeks dokumen terlebih dahulu, lalu coba lagi.",
            "sources": [],
        }
    context = "\n\n".join(
        f"[Sumber {index}: {item.get('document_name', 'Dokumen')} | chunk {item.get('id')} ]\n{item.get('content', '')}"
        for index, item in enumerate(matches, start=1)
    )
    language = state.get("language", "id")
    result = get_chat_model().invoke([
        ("system", "Jawab berdasarkan konteks dokumen saja. Jika konteks tidak mendukung jawaban, nyatakan keterbatasannya. Sertakan rujukan [Sumber N] pada klaim penting. Jawab dalam Bahasa Indonesia jika language=id, selain itu ikuti nilai language. Jangan mengarang fakta."),
        ("human", f"Pertanyaan: {state['question']}\nBahasa: {language}\n\nKonteks:\n{context}"),
    ])
    sources = [
        {
            "documentName": item.get("document_name", "Dokumen"),
            "page": item.get("metadata", {}).get("page", 1),
            "snippet": item.get("content", "")[:320],
            "sourceId": item.get("document_id"),
        }
        for item in matches
    ]
    return {"answer": str(result.content), "sources": sources}


graph_builder = StateGraph(RAGState)
graph_builder.add_node("retrieve", retrieve_node)
graph_builder.add_node("answer", answer_node)
graph_builder.add_edge(START, "retrieve")
graph_builder.add_edge("retrieve", "answer")
graph_builder.add_edge("answer", END)
rag_graph = graph_builder.compile()


def extract_text(filename: str, content: bytes) -> tuple[str, list[dict[str, Any]]]:
    suffix = Path(filename).suffix.lower()
    page_texts: list[dict[str, Any]] = []
    if suffix == ".pdf":
        for page_number, page in enumerate(PdfReader(BytesIO(content)).pages, start=1):
            text = page.extract_text() or ""
            if text.strip():
                page_texts.append({"page": page_number, "text": text})
    elif suffix == ".docx":
        text = "\n".join(paragraph.text for paragraph in DocxDocument(BytesIO(content)).paragraphs)
        page_texts.append({"page": 1, "text": text})
    else:
        page_texts.append({"page": 1, "text": content.decode("utf-8", errors="replace")})
    if not any(item["text"].strip() for item in page_texts):
        raise HTTPException(status_code=422, detail="Tidak ada teks yang dapat diekstrak dari dokumen.")
    return "\n\n".join(item["text"] for item in page_texts), page_texts


def extract_pdfplumber_pages(content: bytes) -> list[dict[str, Any]]:
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            pages = [
                {"page": page_number, "text": text}
                for page_number, page in enumerate(pdf.pages, start=1)
                if (text := page.extract_text() or "").strip()
            ]
    except (PDFException, PDFPasswordIncorrect, ValueError) as error:
        raise HTTPException(status_code=422, detail="PDF tidak valid, terenkripsi, atau tidak dapat dibaca.") from error
    if not pages:
        raise HTTPException(
            status_code=422,
            detail="Tidak ada teks digital yang dapat diekstrak. Fitur ini tidak melakukan OCR dan tidak mendukung PDF hasil scan tanpa teks.",
        )
    return pages


def safe_filename(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", Path(filename).name) or "document"


def outline_settings() -> tuple[str, str, str, str]:
    base_url = os.getenv("OUTLINE_BASE_URL", "").rstrip("/")
    api_key = os.getenv("OUTLINE_API_KEY", "")
    collection_id = os.getenv("OUTLINE_COLLECTION_ID", "")
    collection_name = os.getenv("OUTLINE_COLLECTION_NAME", "Outline")
    if not base_url or not api_key or not collection_id:
        raise HTTPException(status_code=503, detail="Konfigurasi OUTLINE_BASE_URL, OUTLINE_API_KEY, dan OUTLINE_COLLECTION_ID harus diisi di .env backend.")
    return base_url, api_key, collection_id, collection_name


def outline_api_call(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    base_url, api_key, _, _ = outline_settings()
    try:
        response = requests.post(
            f"{base_url}/api/{action}",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
    except requests.exceptions.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat menghubungi Outline ({base_url}). Periksa DNS, VPN, atau koneksi jaringan server. ({error})") from error
    try:
        body = response.json()
    except ValueError as error:
        raise HTTPException(status_code=502, detail=f"Outline mengembalikan respons non-JSON (HTTP {response.status_code}).") from error
    if not response.ok or body.get("ok") is False:
        message = body.get("message") or body.get("error") or f"HTTP {response.status_code}"
        raise HTTPException(status_code=502, detail=f"Outline {action} gagal: {message}")
    data = body.get("data", body)
    return data if isinstance(data, dict) else {"data": data, "pagination": body.get("pagination", {})}


def list_outline_documents(collection_id: str, limit: int = 100) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    offset = 0
    while offset < 5000:
        result = outline_api_call("documents.list", {"collectionId": collection_id, "limit": limit, "offset": offset})
        batch = result.get("data", [])
        if not isinstance(batch, list) or not batch:
            break
        documents.extend(item for item in batch if isinstance(item, dict))
        offset += len(batch)
        pagination = result.get("pagination") or {}
        total = pagination.get("total") if isinstance(pagination, dict) else None
        if total is not None and offset >= int(total):
            break
        if len(batch) < limit:
            break
    return documents


def outline_document_text(document: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if document.get("text"):
        return document, str(document["text"])
    document_id = document.get("id")
    if not document_id:
        return document, ""
    detail = outline_api_call("documents.info", {"id": document_id})
    info = detail.get("data", detail)
    if not isinstance(info, dict):
        return document, ""
    return {**document, **info}, str(info.get("text") or "")


def outline_source_id(collection_id: str) -> str:
    return f"outline-{collection_id}"


def normalize_timestamp(value: Any) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds")
    except ValueError:
        return str(value)


def ensure_outline_source() -> dict[str, Any]:
    _, _, collection_id, collection_name = outline_settings()
    supabase = get_supabase()
    source_id = outline_source_id(collection_id)
    current = supabase.table("knowledge_sources").select("*").eq("id", source_id).execute().data or []
    if current:
        return current[0]
    result = supabase.table("knowledge_sources").insert({
        "id": source_id,
        "name": collection_name,
        "type": "outline",
        "status": "not_synced",
        "document_count": 0,
    }).execute()
    return result.data[0]


def ensure_upload_source(name: str = "Unggah File") -> dict[str, Any]:
    supabase = get_supabase()
    source_id = "uploaded-files"
    current = supabase.table("knowledge_sources").select("*").eq("id", source_id).execute().data or []
    if current:
        return current[0]
    result = supabase.table("knowledge_sources").insert({
        "id": source_id,
        "name": name,
        "type": "pdf",
        "status": "connected",
        "document_count": 0,
    }).execute()
    log_event("source_created", "Sumber unggahan dibuat", "File upload akan diindeks ke basis pengetahuan.", source_id=source_id)
    return result.data[0]


def serialize_source(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": source["id"],
        "name": source["name"],
        "type": source["type"],
        "status": source["status"],
        "documentCount": source["document_count"],
        "lastSync": source.get("last_sync"),
    }


def log_event(event_type: str, title: str, detail: str = "", source_id: str | None = None, document_id: str | None = None) -> None:
    try:
        get_supabase().table("workspace_events").insert({
            "event_type": event_type,
            "title": title,
            "detail": detail,
            "source_id": source_id,
            "document_id": document_id,
        }).execute()
    except Exception:
        pass


MICROSOFT_SCOPES = ["User.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Read.All"]
MICROSOFT_SESSION_COOKIE = "microsoft_session_id"


def microsoft_settings() -> tuple[str, str, str, str]:
    client_id = os.getenv("MICROSOFT_CLIENT_ID", "")
    client_secret = os.getenv("MICROSOFT_CLIENT_SECRET", "")
    tenant_id = os.getenv("MICROSOFT_TENANT_ID", "")
    redirect_uri = os.getenv("MICROSOFT_REDIRECT_URI", "")
    if not all((client_id, client_secret, tenant_id, redirect_uri)):
        raise HTTPException(status_code=503, detail="Microsoft OAuth belum dikonfigurasi. Isi MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID, dan MICROSOFT_REDIRECT_URI di backend .env.")
    return client_id, client_secret, tenant_id, redirect_uri


def microsoft_app(token_cache: msal.SerializableTokenCache | None = None) -> msal.ConfidentialClientApplication:
    client_id, client_secret, tenant_id, _ = microsoft_settings()
    return msal.ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=client_secret,
        token_cache=token_cache,
    )


def microsoft_connection(request: Request) -> dict[str, Any]:
    connection_id = request.cookies.get(MICROSOFT_SESSION_COOKIE)
    if not connection_id:
        raise HTTPException(status_code=401, detail="Hubungkan akun Microsoft terlebih dahulu.")
    result = get_supabase().table("microsoft_connections").select("*").eq("id", connection_id).maybe_single().execute().data
    if not result:
        raise HTTPException(status_code=401, detail="Sesi Microsoft tidak ditemukan. Hubungkan ulang akun Anda.")
    return result


def microsoft_graph_token(connection: dict[str, Any]) -> str:
    credentials = decrypt_credentials(connection.get("token_cache_encrypted"))
    cache = msal.SerializableTokenCache()
    cache.deserialize(credentials.get("cache", ""))
    client = microsoft_app(cache)
    accounts = client.get_accounts(username=connection.get("email") or None)
    if not accounts:
        raise HTTPException(status_code=401, detail="Token Microsoft kedaluwarsa. Hubungkan ulang akun Anda.")
    result = client.acquire_token_silent(MICROSOFT_SCOPES, account=accounts[0])
    if not result or "access_token" not in result:
        raise HTTPException(status_code=401, detail="Tidak dapat memperbarui token Microsoft. Hubungkan ulang akun Anda.")
    if cache.has_state_changed:
        get_supabase().table("microsoft_connections").update({
            "token_cache_encrypted": encrypt_credentials({"cache": cache.serialize()}),
            "expires_at": datetime.fromtimestamp(result.get("expires_on", 0), timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", connection["id"]).execute()
    return result["access_token"]


def graph_get(url: str, token: str) -> dict[str, Any]:
    current = url
    while current:
        if urlparse(current).hostname != "graph.microsoft.com":
            raise HTTPException(status_code=502, detail="Microsoft Graph mengembalikan pagination URL yang tidak valid.")
        response = None
        for attempt in range(4):
            response = requests.get(current, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, timeout=30)
            if response.status_code != 429:
                break
            if attempt == 3:
                raise HTTPException(status_code=429, detail="Microsoft Graph membatasi request berulang. Coba sinkronkan lagi beberapa saat.")
            try:
                retry_after = min(int(response.headers.get("Retry-After", "3")), 15)
            except ValueError:
                retry_after = 3
            time.sleep(retry_after)
        if response.status_code >= 400:
            message = ""
            try:
                message = response.json().get("error", {}).get("message", "")
            except ValueError:
                pass
            raise HTTPException(status_code=response.status_code, detail=f"Microsoft Graph gagal (HTTP {response.status_code}): {message or 'Periksa permission Microsoft Graph dan admin consent.'}")
        return response.json()
    return {}


def graph_list(url: str, token: str, max_items: int = 5000) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    current = url
    while current and len(items) < max_items:
        page = graph_get(current, token)
        values = page.get("value", [])
        items.extend(item for item in values if isinstance(item, dict))
        current = page.get("@odata.nextLink") or page.get("@odata.nextlink")
    return items[:max_items]


def microsoft_message_text(message: dict[str, Any]) -> str:
    body = message.get("body") or {}
    content = str(body.get("content") or "")
    if body.get("contentType", "text").lower() == "html":
        content = re.sub(r"<(br|/p|/div|/li)\b[^>]*>", "\n", content, flags=re.IGNORECASE)
        content = re.sub(r"<[^>]+>", " ", content)
    return unescape(re.sub(r"\s+", " ", content)).strip()


@app.get("/microsoft/auth/start", dependencies=[Depends(require_authenticated_user)])
def microsoft_auth_start() -> dict[str, str]:
    _, _, _, redirect_uri = microsoft_settings()
    try:
        flow = microsoft_app().initiate_auth_code_flow(scopes=MICROSOFT_SCOPES, redirect_uri=redirect_uri)
        if "auth_uri" not in flow or "state" not in flow:
            raise HTTPException(status_code=502, detail="Microsoft tidak memberikan authorization URL.")
        supabase = get_supabase()
        supabase.table("microsoft_oauth_states").delete().lt("expires_at", datetime.now(timezone.utc).isoformat()).execute()
        supabase.table("microsoft_oauth_states").insert({
            "state": flow["state"],
            "flow": flow,
            "expires_at": (datetime.now(timezone.utc) + __import__("datetime").timedelta(minutes=10)).isoformat(),
        }).execute()
        return {"authorizationUrl": flow["auth_uri"]}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal memulai Microsoft OAuth: {error}") from error


@app.post("/microsoft/auth/callback")
def microsoft_auth_callback(payload: dict[str, str]) -> dict[str, Any]:
    state = payload.get("state", "")
    if not state or not payload.get("code"):
        raise HTTPException(status_code=400, detail="OAuth callback tidak memiliki code/state.")
    supabase = get_supabase()
    state_row = supabase.table("microsoft_oauth_states").select("flow, expires_at").eq("state", state).maybe_single().execute().data
    if not state_row or datetime.fromisoformat(state_row["expires_at"].replace("Z", "+00:00")) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="State Microsoft OAuth tidak ditemukan atau kedaluwarsa. Coba hubungkan ulang.")
    flow = state_row["flow"]
    supabase.table("microsoft_oauth_states").delete().eq("state", state).execute()
    token_cache = msal.SerializableTokenCache()
    try:
        result = microsoft_app(token_cache).acquire_token_by_auth_code_flow(flow, payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Microsoft OAuth state tidak valid. Coba hubungkan ulang.") from error
    if "access_token" not in result:
        message = result.get("error_description") or result.get("error") or "Microsoft login gagal."
        raise HTTPException(status_code=401, detail=message)

    claims = result.get("id_token_claims") or {}
    user_id = claims.get("oid") or claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Microsoft tidak memberikan identitas user.")
    cache_payload = token_cache.serialize()
    if not cache_payload:
        raise HTTPException(status_code=500, detail="Microsoft berhasil login tetapi token cache tidak dapat disimpan.")
    connection_row = {
        "microsoft_user_id": str(user_id),
        "tenant_id": claims.get("tid"),
        "display_name": claims.get("name", "Microsoft user"),
        "email": claims.get("preferred_username") or claims.get("email") or "",
        "token_cache_encrypted": encrypt_credentials({"cache": cache_payload}),
        "expires_at": datetime.fromtimestamp(int(result.get("expires_on", time.time() + int(result.get("expires_in", 3600)))), timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    saved = supabase.table("microsoft_connections").upsert(connection_row, on_conflict="microsoft_user_id").execute().data
    connection = saved[0]
    log_event("microsoft_connected", "Microsoft Teams terhubung", f"Akun {connection_row['display_name']} berhasil dihubungkan.")
    return {"connectionId": connection["id"], "displayName": connection["display_name"], "email": connection["email"]}


@app.get("/microsoft/connection", dependencies=[Depends(require_authenticated_user)])
def microsoft_connection_status(request: Request) -> dict[str, Any]:
    connection_id = request.cookies.get(MICROSOFT_SESSION_COOKIE)
    if not connection_id:
        return {"connected": False}
    connection = get_supabase().table("microsoft_connections").select("id, display_name, email, tenant_id, updated_at").eq("id", connection_id).maybe_single().execute().data
    if not connection:
        return {"connected": False}
    return {"connected": True, **connection}


@app.delete("/microsoft/connection", dependencies=[Depends(require_authenticated_user)])
def microsoft_disconnect(request: Request) -> dict[str, bool]:
    connection = microsoft_connection(request)
    get_supabase().table("microsoft_connections").delete().eq("id", connection["id"]).execute()
    return {"disconnected": True}


@app.get("/microsoft/teams", dependencies=[Depends(require_authenticated_user)])
def microsoft_teams(request: Request) -> list[dict[str, Any]]:
    connection = microsoft_connection(request)
    token = microsoft_graph_token(connection)
    teams = graph_list("https://graph.microsoft.com/v1.0/me/joinedTeams?$select=id,displayName,description&$top=100", token)
    rows = [{
        "id": str(team["id"]),
        "connection_id": connection["id"],
        "display_name": team.get("displayName") or "Team",
        "description": team.get("description") or "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    } for team in teams if team.get("id")]
    if rows:
        get_supabase().table("microsoft_teams").upsert(rows, on_conflict="connection_id,id").execute()
    return [{"id": row["id"], "displayName": row["display_name"], "description": row["description"]} for row in rows]


@app.get("/microsoft/teams/{team_id}/channels", dependencies=[Depends(require_authenticated_user)])
def microsoft_channels(team_id: str, request: Request) -> list[dict[str, Any]]:
    connection = microsoft_connection(request)
    supabase = get_supabase()
    team = supabase.table("microsoft_teams").select("id").eq("connection_id", connection["id"]).eq("id", team_id).maybe_single().execute().data
    if not team:
        raise HTTPException(status_code=404, detail="Team tidak tersedia pada akun Microsoft ini. Muat ulang daftar Team.")
    token = microsoft_graph_token(connection)
    channels = graph_list(f"https://graph.microsoft.com/v1.0/teams/{quote(team_id, safe='')}/channels?$select=id,displayName,description,membershipType&$top=100", token)
    rows = [{
        "id": str(channel["id"]),
        "connection_id": connection["id"],
        "team_id": team_id,
        "display_name": channel.get("displayName") or "Channel",
        "description": channel.get("description") or "",
        "membership_type": channel.get("membershipType"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    } for channel in channels if channel.get("id")]
    if rows:
        supabase.table("microsoft_channels").upsert(rows, on_conflict="connection_id,team_id,id").execute()
    return [{"id": row["id"], "displayName": row["display_name"], "description": row["description"], "membershipType": row["membership_type"]} for row in rows]


@app.post("/microsoft/messages/sync", dependencies=[Depends(require_authenticated_user)])
def microsoft_sync_messages(request: Request, selection: MicrosoftSyncRequest) -> dict[str, Any]:
    connection = microsoft_connection(request)
    supabase = get_supabase()
    channel = supabase.table("microsoft_channels").select("id, display_name").eq(
        "connection_id", connection["id"]
    ).eq("team_id", selection.teamId).eq("id", selection.channelId).maybe_single().execute().data
    if not channel:
        raise HTTPException(status_code=404, detail="Channel tidak tersedia. Muat ulang Team dan Channel terlebih dahulu.")

    token = microsoft_graph_token(connection)
    base = f"https://graph.microsoft.com/v1.0/teams/{quote(selection.teamId, safe='')}/channels/{quote(selection.channelId, safe='')}/messages?$top=50"
    roots = graph_list(base, token, max_items=1000)
    messages = list(roots)
    for root in roots:
        if root.get("replyToId") or not root.get("id") or not int(root.get("replyCount", 0) or 0):
            continue
        replies_url = f"https://graph.microsoft.com/v1.0/teams/{quote(selection.teamId, safe='')}/channels/{quote(selection.channelId, safe='')}/messages/{quote(str(root['id']), safe='')}/replies?$top=50"
        messages.extend(graph_list(replies_url, token, max_items=500))

    rows = []
    for message in messages:
        message_id = message.get("id")
        if not message_id:
            continue
        sender = (message.get("from") or {}).get("user") or {}
        rows.append({
            "platform": "microsoft_teams",
            "external_message_id": str(message_id),
            "connection_id": connection["id"],
            "team_id": selection.teamId,
            "channel_id": selection.channelId,
            "sender_id": sender.get("id"),
            "sender_name": sender.get("displayName") or "Unknown user",
            "message_text": microsoft_message_text(message),
            "created_at": message.get("createdDateTime"),
            "raw_message": message,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        })
    if rows:
        supabase.table("platform_messages").upsert(rows, on_conflict="platform,external_message_id").execute()
    log_event("teams_messages_synced", "Pesan Microsoft Teams disinkronkan", f"{len(rows)} pesan dari {channel['display_name']}.")
    return {"platform": "microsoft_teams", "teamId": selection.teamId, "channelId": selection.channelId, "syncedCount": len(rows)}


@app.get("/health")
def health() -> dict[str, Any]:
    llm_provider = os.getenv("LLM_PROVIDER", "openai").lower()
    embedding_provider = os.getenv("EMBEDDING_PROVIDER", "openai").lower()
    return {
        "status": "ok",
        "service": "documind-langgraph",
        "supabase_configured": bool(os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
        "huggingface_configured": bool(os.getenv("HF_TOKEN")),
        "embedding_provider": embedding_provider,
        "embedding_model": os.getenv(
            "OPENAI_EMBEDDING_MODEL" if embedding_provider == "openai" else "HF_EMBEDDING_MODEL",
            "text-embedding-3-small" if embedding_provider == "openai" else "Qwen/Qwen3-Embedding-0.6B",
        ),
        "chat_model": os.getenv(
            "OPENAI_MODEL" if llm_provider == "openai" else "HF_CHAT_MODEL",
            "gpt-4o-mini" if llm_provider == "openai" else "openai/gpt-oss-120b:cheapest",
        ),
        "llm_provider": llm_provider,
    }


@app.get("/dashboard", dependencies=[Depends(require_authenticated_user)])
def dashboard_summary() -> dict[str, Any]:
    try:
        supabase = get_supabase()
        source_count = supabase.table("knowledge_sources").select("id", count="exact", head=True).execute().count or 0
        document_analysis_count = supabase.table("workspace_events").select("id", count="exact", head=True).eq("event_type", "document_analyzed").execute().count or 0
        question_count = supabase.table("workspace_events").select("id", count="exact", head=True).eq("event_type", "question_answered").execute().count or 0
        action_count = supabase.table("workspace_events").select("id", count="exact", head=True).eq("event_type", "action_completed").execute().count or 0
        events = supabase.table("workspace_events").select(
            "id, event_type, title, detail, source_id, document_id, created_at"
        ).order("created_at", desc=True).limit(8).execute().data or []
        return {
            "metrics": {
                "documentsAnalyzed": document_analysis_count,
                "knowledgeSources": source_count,
                "questionsAnswered": question_count,
                "actionsCompleted": action_count,
            },
            "activities": [
                {
                    "id": event["id"],
                    "type": event["event_type"],
                    "title": event["title"],
                    "detail": event.get("detail", ""),
                    "createdAt": event["created_at"],
                }
                for event in events
            ],
        }
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal membaca dashboard Supabase: {error}") from error


@app.get("/knowledge/sources", dependencies=[Depends(require_authenticated_user)])
def list_knowledge_sources() -> list[dict[str, Any]]:
    try:
        if all(os.getenv(name) for name in ("OUTLINE_BASE_URL", "OUTLINE_API_KEY", "OUTLINE_COLLECTION_ID")):
            ensure_outline_source()
        response = get_supabase().table("knowledge_sources").select(
            "id, name, type, status, document_count, last_sync"
        ).order("created_at").execute()
        return [serialize_source(source) for source in response.data or []]
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal membaca sumber pengetahuan dari Supabase: {error}") from error


@app.post("/knowledge/sources", dependencies=[Depends(require_authenticated_user)])
def create_knowledge_source(source: KnowledgeSourceInput) -> dict[str, Any]:
    try:
        if source.type == "outline":
            current = ensure_outline_source()
            result = get_supabase().table("knowledge_sources").update({"name": source.name}).eq("id", current["id"]).execute()
            return serialize_source(result.data[0] if result.data else {**current, "name": source.name})
        if source.type == "pdf":
            current = ensure_upload_source(source.name)
            result = get_supabase().table("knowledge_sources").update({"name": source.name}).eq("id", current["id"]).execute()
            return serialize_source(result.data[0] if result.data else {**current, "name": source.name})
        if source.type not in {"github", "website", "notion"}:
            raise HTTPException(status_code=501, detail=f"Konektor {source.type} belum didukung backend.")
        if source.type == "github" and not source.credentials.get("repository"):
            raise HTTPException(status_code=422, detail="Repository GitHub wajib diisi dengan format owner/repo.")
        if source.type == "website" and not source.credentials.get("baseUrl"):
            raise HTTPException(status_code=422, detail="URL website wajib diisi.")
        if source.type == "notion" and not source.credentials.get("apiKey"):
            raise HTTPException(status_code=422, detail="Integration token Notion wajib diisi.")

        source_id = f"{source.type}-{uuid4()}"
        row = {
            "id": source_id,
            "name": source.name,
            "type": source.type,
            "status": "not_synced",
            "document_count": 0,
            "credentials_encrypted": encrypt_credentials(source.credentials),
        }
        result = get_supabase().table("knowledge_sources").insert(row).execute()
        log_event("source_created", "Sumber pengetahuan ditambahkan", f"{source.name} ({source.type}).", source_id=source_id)
        return serialize_source(result.data[0])
    except HTTPException:
        raise
    except ConnectorError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal menyimpan sumber pengetahuan: {error}") from error


@app.post("/knowledge/sources/test", dependencies=[Depends(require_authenticated_user)])
def test_knowledge_source(source: KnowledgeSourceInput) -> dict[str, Any]:
    try:
        if source.type == "outline":
            _, _, collection_id, _ = outline_settings()
            result = outline_api_call("documents.list", {"collectionId": collection_id, "limit": 1, "offset": 0})
            batch = result.get("data", [])
            pagination = result.get("pagination") or {}
            count = pagination.get("total", len(batch) if isinstance(batch, list) else 0) if isinstance(pagination, dict) else 0
        else:
            count = test_connector(source.type, source.credentials)
        return {"success": True, "message": f"Koneksi {source.type} berhasil.", "documentCount": count}
    except HTTPException:
        raise
    except ConnectorError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Tes koneksi {source.type} gagal: {error}") from error


@app.post("/knowledge/sources/{source_id}/sync", dependencies=[Depends(require_authenticated_user)])
def sync_knowledge_source(source_id: str) -> dict[str, Any]:
    try:
        source_rows = get_supabase().table("knowledge_sources").select("*").eq("id", source_id).execute().data or []
        if not source_rows:
            raise HTTPException(status_code=404, detail="Sumber pengetahuan tidak ditemukan.")
        source = source_rows[0]
        if source["type"] == "outline":
            _, _, collection_id, _ = outline_settings()
            listed_documents = list_outline_documents(collection_id)
            documents = []
            for item in listed_documents:
                document, text = outline_document_text(item)
                documents.append({
                    "external_id": str(document.get("id") or ""),
                    "title": str(document.get("title") or document.get("id") or "Outline document"),
                    "text": text,
                    "updated_at": document.get("updatedAt") or document.get("updated_at"),
                    "url": document.get("url"),
                })
        else:
            credentials = decrypt_credentials(source.get("credentials_encrypted"))
            documents = fetch_connector_documents(source["type"], credentials)

        added = 0
        updated = 0
        failed = 0
        skipped = 0
        errors: list[str] = []
        provider_failure = False
        supabase = get_supabase()
        embedding_provider = get_embedding_provider()
        embedding_column = get_embedding_column(embedding_provider)

        supabase.table("knowledge_sources").update({"status": "syncing"}).eq("id", source_id).execute()
        for document in documents:
            document_id: str | None = None
            try:
                external_id = str(document.get("external_id") or "")
                content = str(document.get("text") or "")
                if not external_id or not content.strip():
                    failed += 1
                    continue

                document_id = str(uuid5(NAMESPACE_URL, f"{source['type']}:{source_id}:{external_id}"))
                updated_at = normalize_timestamp(document.get("updated_at"))
                existing_rows = supabase.table("documents").select("id, status, source_updated_at").eq("id", document_id).execute().data or []
                existing = existing_rows[0] if existing_rows else None
                if existing and existing.get("status") == "indexed" and normalize_timestamp(existing.get("source_updated_at")) == updated_at:
                    skipped += 1
                    continue

                chunks = text_splitter.split_text(content)
                if not chunks:
                    failed += 1
                    continue

                row = {
                    "id": document_id,
                    "name": str(document.get("title") or external_id),
                    "mime_type": "text/markdown" if source["type"] in {"outline", "github", "notion"} else "text/html",
                    "size_bytes": len(content.encode("utf-8")),
                    "storage_path": None,
                    "status": "processing",
                    "source_id": source_id,
                    "source_name": source["name"],
                    "source_type": source["type"],
                    "external_id": external_id,
                    "source_updated_at": updated_at,
                }
                supabase.table("documents").upsert(row, on_conflict="id").execute()

                vectors: list[list[float]] = []
                for start in range(0, len(chunks), 64):
                    vectors.extend(embed_documents(chunks[start:start + 64], embedding_provider))
                supabase.table("document_chunks").delete().eq("document_id", document_id).execute()
                chunk_rows = [
                    {
                        "document_id": document_id,
                        "chunk_index": index,
                        "content": chunk,
                        embedding_column: vectors[index],
                        "metadata": {
                            "page": 1,
                            "source": source["type"],
                            "source_url": document.get("url"),
                            "external_id": external_id,
                        },
                    }
                    for index, chunk in enumerate(chunks)
                ]
                supabase.table("document_chunks").insert(chunk_rows).execute()
                supabase.table("documents").update({"status": "indexed"}).eq("id", document_id).execute()
                if existing:
                    updated += 1
                else:
                    added += 1
            except Exception as error:
                if isinstance(error, HTTPException):
                    errors.append(str(error.detail))
                    provider_failure = provider_failure or error.status_code in {502, 503}
                else:
                    errors.append("Gagal memproses dokumen dari sumber pengetahuan.")
                if document_id:
                    try:
                        supabase.table("documents").update({"status": "failed"}).eq("id", document_id).execute()
                    except Exception:
                        pass
                failed += 1
                if provider_failure:
                    break

        count_rows = supabase.table("documents").select("id").eq("source_id", source_id).execute().data or []
        status = "error" if provider_failure or (failed and not (added or updated or skipped)) else "connected"
        last_sync = datetime.now(timezone.utc).isoformat()
        supabase.table("knowledge_sources").update({
            "status": status,
            "document_count": len(count_rows),
            "last_sync": last_sync,
        }).eq("id", source_id).execute()
        log_event("source_synced", "Sumber pengetahuan disinkronkan", f"{source['name']}: {added} baru, {updated} diperbarui, {failed} gagal.", source_id=source_id)
        return {
            "syncId": str(uuid4()),
            "sourceId": source_id,
            "status": "error" if provider_failure else "partial" if failed else "success",
            "documentCount": len(count_rows),
            "added": added,
            "updated": updated,
            "skipped": skipped,
            "failed": failed,
            "errors": errors[:5],
        }
    except HTTPException:
        raise
    except Exception as error:
        try:
            get_supabase().table("knowledge_sources").update({"status": "error"}).eq("id", source_id).execute()
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"Sinkronisasi Outline gagal: {error}") from error


@app.delete("/knowledge/sources/{source_id}", dependencies=[Depends(require_authenticated_user)])
def delete_knowledge_source(source_id: str) -> dict[str, bool]:
    try:
        supabase = get_supabase()
        documents = supabase.table("documents").select("id, storage_path").eq("source_id", source_id).execute().data or []
        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "documents")
        storage_paths = [item["storage_path"] for item in documents if item.get("storage_path")]
        if storage_paths:
            supabase.storage.from_(bucket).remove(storage_paths)
        supabase.table("documents").delete().eq("source_id", source_id).execute()
        supabase.table("knowledge_sources").delete().eq("id", source_id).execute()
        return {"deleted": True}
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal menghapus sumber: {error}") from error


@app.get("/documents", dependencies=[Depends(require_authenticated_user)])
def list_documents() -> dict[str, Any]:
    try:
        response = get_supabase().table("documents").select(
            "id, name, mime_type, size_bytes, status, created_at, source_id, source_name, source_type"
        ).order("created_at", desc=True).execute()
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal membaca daftar dokumen: {error}") from error
    documents = [
        {
            "id": item["id"],
            "name": item["name"],
            "type": item["mime_type"],
            "size": f"{item['size_bytes'] / (1024 * 1024):.1f} MB",
            "status": item["status"].capitalize(),
            "createdAt": item["created_at"],
            "sourceId": item.get("source_id"),
            "sourceName": item.get("source_name") or "Unggah file",
        }
        for item in response.data or []
    ]
    return {"documents": documents}


def index_document(
    filename: str,
    content_type: str,
    content: bytes,
    source_id: str,
    source_name: str,
    source_type: str,
    *,
    extracted_pages: list[dict[str, Any]] | None = None,
    embed_chunks: bool = True,
) -> dict[str, str]:
    filename = safe_filename(filename)
    if Path(filename).suffix.lower() not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Format file yang didukung: PDF, DOCX, TXT, dan MD.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Ukuran file maksimum adalah 50 MB.")

    document_id = str(uuid4())
    storage_path = f"{document_id}/{filename}"
    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "documents")
    supabase = get_supabase()
    uploaded = False
    try:
        if extracted_pages is None:
            _, pages = extract_text(filename, content)
        else:
            pages = extracted_pages
        chunks: list[dict[str, Any]] = []
        for page in pages:
            for chunk in text_splitter.split_text(page["text"]):
                chunks.append({"content": chunk, "metadata": {"page": page["page"]}})
        if not chunks:
            raise HTTPException(status_code=422, detail="Dokumen tidak memiliki teks yang dapat diindeks.")

        embedding_vectors = embed_documents([chunk["content"] for chunk in chunks]) if embed_chunks else None
        embedding_column = get_embedding_column() if embedding_vectors is not None else None
        supabase.storage.from_(bucket).upload(
            storage_path,
            content,
            file_options={"content-type": content_type or "application/octet-stream", "upsert": "false"},
        )
        uploaded = True
        supabase.table("documents").insert({
            "id": document_id,
            "name": filename,
            "mime_type": content_type or "application/octet-stream",
            "size_bytes": len(content),
            "storage_path": storage_path,
            "status": "processing",
            "source_id": source_id,
            "source_name": source_name,
            "source_type": source_type,
        }).execute()
        rows = []
        for index, chunk in enumerate(chunks):
            row = {
                "document_id": document_id,
                "chunk_index": index,
                "content": chunk["content"],
                "metadata": chunk["metadata"],
            }
            if embedding_vectors is not None and embedding_column is not None:
                row[embedding_column] = embedding_vectors[index]
            rows.append(row)
        supabase.table("document_chunks").insert(rows).execute()
        supabase.table("documents").update({"status": "indexed"}).eq("id", document_id).execute()
        source_rows = supabase.table("documents").select("id").eq("source_id", source_id).execute().data or []
        supabase.table("knowledge_sources").update({"document_count": len(source_rows), "status": "connected"}).eq("id", source_id).execute()
        log_event("document_uploaded", f"{filename} diindeks", "File berhasil disimpan dan masuk ke basis pengetahuan.", document_id=document_id)
        return {"documentId": document_id, "status": "indexed"}
    except HTTPException:
        raise
    except Exception as error:
        if uploaded:
            try:
                supabase.storage.from_(bucket).remove([storage_path])
                supabase.table("documents").delete().eq("id", document_id).execute()
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"Gagal mengunggah atau mengindeks dokumen: {error}") from error


@app.post("/documents/upload", dependencies=[Depends(require_authenticated_user)])
async def upload_document(file: UploadFile = File(...)) -> dict[str, str]:
    filename = file.filename or "document"
    if Path(safe_filename(filename)).suffix.lower() not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Format file yang didukung: PDF, DOCX, TXT, dan MD.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    return index_document(filename, file.content_type or "application/octet-stream", content, "uploaded-files", "Unggah File", "pdf")


@app.post("/documents/extract-pdf", dependencies=[Depends(require_authenticated_user)])
async def extract_digital_pdf(file: UploadFile = File(...)) -> dict[str, str]:
    filename = file.filename or "document.pdf"
    if Path(safe_filename(filename)).suffix.lower() != ".pdf":
        raise HTTPException(status_code=415, detail="Fitur ekstraksi digital hanya menerima file PDF.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Ukuran file maksimum adalah 50 MB.")
    pages = extract_pdfplumber_pages(content)
    return index_document(
        filename,
        file.content_type or "application/pdf",
        content,
        "pdfplumber-files",
        "Ekstraksi PDF Digital",
        "pdfplumber",
        extracted_pages=pages,
        embed_chunks=False,
    )


GOOGLE_DRIVE_OAUTH_STATES_TABLE = "google_drive_oauth_states"
GOOGLE_DRIVE_CONNECTIONS_TABLE = "google_drive_connections"
GOOGLE_DRIVE_SESSION_COOKIE = "google_drive_session_id"
GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3"
GOOGLE_DRIVE_FILE_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/vnd.google-apps.document": ".pdf",
}


def google_drive_settings() -> tuple[str, str, str]:
    client_id = os.getenv("GOOGLE_DRIVE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_DRIVE_CLIENT_SECRET", "")
    redirect_uri = os.getenv("GOOGLE_DRIVE_REDIRECT_URI", "")
    if not all((client_id, client_secret, redirect_uri)):
        raise HTTPException(
            status_code=503,
            detail="Google Drive belum dikonfigurasi. Isi GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, dan GOOGLE_DRIVE_REDIRECT_URI di .env.",
        )
    return client_id, client_secret, redirect_uri


def google_drive_connection(request: Request) -> dict[str, Any]:
    connection_id = request.cookies.get(GOOGLE_DRIVE_SESSION_COOKIE)
    if not connection_id:
        raise HTTPException(status_code=401, detail="Hubungkan akun Google Drive terlebih dahulu.")
    connection = get_supabase().table(GOOGLE_DRIVE_CONNECTIONS_TABLE).select("*").eq("id", connection_id).maybe_single().execute().data
    if not connection:
        raise HTTPException(status_code=401, detail="Sesi Google Drive tidak ditemukan. Hubungkan ulang akun Anda.")
    return connection


def google_error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:300]
    error = payload.get("error", {})
    if isinstance(error, dict):
        return str(error.get("message") or error.get("error_description") or error.get("status") or "Google API menolak request.")
    return str(payload.get("error_description") or error or "Google API menolak request.")


def google_drive_access_token(connection: dict[str, Any]) -> str:
    try:
        credentials = decrypt_credentials(connection.get("credentials_encrypted"))
    except ConnectorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    access_token = credentials.get("access_token", "")
    if access_token and float(credentials.get("expires_at", "0")) > time.time() + 60:
        return access_token
    refresh_token = credentials.get("refresh_token", "")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Token Google Drive tidak dapat diperbarui. Hubungkan ulang akun Anda.")
    client_id, client_secret, _ = google_drive_settings()
    try:
        response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=20,
        )
    except requests.exceptions.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat memperbarui sesi Google Drive: {error}") from error
    if not response.ok:
        raise HTTPException(status_code=401, detail=f"Sesi Google Drive kedaluwarsa: {google_error_detail(response)}")
    token_payload = response.json()
    credentials.update({
        "access_token": token_payload["access_token"],
        "expires_at": str(time.time() + int(token_payload.get("expires_in", 3600))),
    })
    get_supabase().table(GOOGLE_DRIVE_CONNECTIONS_TABLE).update({
        "credentials_encrypted": encrypt_credentials(credentials),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", connection["id"]).execute()
    return credentials["access_token"]


def google_drive_request(url: str, token: str, *, params: dict[str, str] | None = None, stream: bool = False) -> requests.Response:
    try:
        response = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=60 if stream else 30,
            stream=stream,
        )
    except requests.exceptions.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat menghubungi Google Drive: {error}") from error
    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Google Drive menolak request (HTTP {response.status_code}): {google_error_detail(response)}",
        )
    return response


@app.post("/google-drive/auth/start", dependencies=[Depends(require_authenticated_user)])
def google_drive_auth_start() -> dict[str, str]:
    client_id, _, redirect_uri = google_drive_settings()
    state = secrets.token_urlsafe(32)
    supabase = get_supabase()
    now = datetime.now(timezone.utc)
    supabase.table(GOOGLE_DRIVE_OAUTH_STATES_TABLE).delete().lt("expires_at", now.isoformat()).execute()
    supabase.table(GOOGLE_DRIVE_OAUTH_STATES_TABLE).insert({
        "state": state,
        "expires_at": (now + timedelta(minutes=10)).isoformat(),
    }).execute()
    authorization_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email https://www.googleapis.com/auth/drive.readonly",
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    })
    return {"authorizationUrl": authorization_url, "state": state}


@app.post("/google-drive/auth/callback")
def google_drive_auth_callback(payload: dict[str, str]) -> dict[str, str]:
    state = payload.get("state", "")
    code = payload.get("code", "")
    if not state or not code:
        raise HTTPException(status_code=400, detail="OAuth Google tidak mengembalikan code/state.")
    supabase = get_supabase()
    state_row = supabase.table(GOOGLE_DRIVE_OAUTH_STATES_TABLE).select("expires_at").eq("state", state).maybe_single().execute().data
    if not state_row or datetime.fromisoformat(state_row["expires_at"].replace("Z", "+00:00")) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="State Google OAuth tidak ditemukan atau kedaluwarsa. Coba hubungkan ulang.")
    supabase.table(GOOGLE_DRIVE_OAUTH_STATES_TABLE).delete().eq("state", state).execute()

    client_id, client_secret, redirect_uri = google_drive_settings()
    try:
        token_response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=20,
        )
    except requests.exceptions.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat menyelesaikan login Google: {error}") from error
    if not token_response.ok:
        raise HTTPException(status_code=401, detail=f"Login Google gagal: {google_error_detail(token_response)}")
    token_payload = token_response.json()
    if not token_payload.get("access_token") or not token_payload.get("refresh_token"):
        raise HTTPException(status_code=401, detail="Google tidak memberikan token akses jangka panjang. Coba hubungkan ulang dan setujui akses Drive.")

    try:
        profile_response = requests.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token_payload['access_token']}"},
            timeout=20,
        )
    except requests.exceptions.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat membaca profil akun Google: {error}") from error
    if not profile_response.ok:
        raise HTTPException(status_code=502, detail=f"Google gagal mengembalikan profil akun: {google_error_detail(profile_response)}")
    profile = profile_response.json()
    google_user_id = profile.get("sub")
    if not google_user_id:
        raise HTTPException(status_code=401, detail="Google tidak memberikan identitas akun.")
    credentials = {
        "access_token": token_payload["access_token"],
        "refresh_token": token_payload["refresh_token"],
        "expires_at": str(time.time() + int(token_payload.get("expires_in", 3600))),
    }
    saved = supabase.table(GOOGLE_DRIVE_CONNECTIONS_TABLE).upsert({
        "google_user_id": str(google_user_id),
        "display_name": profile.get("name") or profile.get("email") or "Google user",
        "email": profile.get("email", ""),
        "credentials_encrypted": encrypt_credentials(credentials),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="google_user_id").execute().data
    if not saved:
        raise HTTPException(status_code=502, detail="Login Google berhasil tetapi sesi tidak dapat disimpan.")
    return {"connectionId": saved[0]["id"], "email": saved[0]["email"]}


@app.get("/google-drive/connection", dependencies=[Depends(require_authenticated_user)])
def google_drive_connection_status(request: Request) -> dict[str, Any]:
    connection_id = request.cookies.get(GOOGLE_DRIVE_SESSION_COOKIE)
    if not connection_id:
        return {"connected": False}
    connection = get_supabase().table(GOOGLE_DRIVE_CONNECTIONS_TABLE).select("id, display_name, email").eq("id", connection_id).maybe_single().execute().data
    if not connection:
        return {"connected": False}
    return {"connected": True, **connection}


@app.delete("/google-drive/connection", dependencies=[Depends(require_authenticated_user)])
def google_drive_disconnect(request: Request) -> dict[str, bool]:
    connection = google_drive_connection(request)
    try:
        credentials = decrypt_credentials(connection.get("credentials_encrypted"))
    except ConnectorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    refresh_token = credentials.get("refresh_token")
    if refresh_token:
        try:
            response = requests.post("https://oauth2.googleapis.com/revoke", data={"token": refresh_token}, timeout=20)
        except requests.exceptions.RequestException as error:
            raise HTTPException(status_code=502, detail=f"Tidak dapat mencabut akses Google: {error}") from error
        if not response.ok:
            raise HTTPException(status_code=502, detail=f"Google gagal mencabut akses (HTTP {response.status_code}).")
    get_supabase().table(GOOGLE_DRIVE_CONNECTIONS_TABLE).delete().eq("id", connection["id"]).execute()
    return {"disconnected": True}


@app.get("/google-drive/files", dependencies=[Depends(require_authenticated_user)])
def google_drive_files(request: Request) -> dict[str, Any]:
    connection = google_drive_connection(request)
    token = google_drive_access_token(connection)
    supported_mimes = list(GOOGLE_DRIVE_FILE_TYPES)
    query = "trashed = false and (" + " or ".join(f"mimeType = '{mime}'" for mime in supported_mimes) + ")"
    response = google_drive_request(
        f"{GOOGLE_DRIVE_API}/files",
        token,
        params={
            "q": query,
            "pageSize": "100",
            "orderBy": "modifiedTime desc",
            "fields": "files(id,name,mimeType,size,modifiedTime,webViewLink)",
        },
    )
    return {
        "email": connection["email"],
        "files": [
            {
                "id": item["id"],
                "name": item["name"],
                "mimeType": item["mimeType"],
                "size": item.get("size"),
                "modifiedTime": item.get("modifiedTime"),
                "webViewLink": item.get("webViewLink"),
            }
            for item in response.json().get("files", [])
            if item.get("id") and item.get("mimeType") in GOOGLE_DRIVE_FILE_TYPES
        ],
    }


@app.post("/google-drive/import", dependencies=[Depends(require_authenticated_user)])
def google_drive_import(request: Request, selection: GoogleDriveImportRequest) -> dict[str, str]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", selection.fileId):
        raise HTTPException(status_code=400, detail="ID file Google Drive tidak valid.")
    connection = google_drive_connection(request)
    token = google_drive_access_token(connection)
    file_url = f"{GOOGLE_DRIVE_API}/files/{quote(selection.fileId, safe='')}"
    metadata = google_drive_request(file_url, token, params={"fields": "id,name,mimeType,size"}).json()
    mime_type = metadata.get("mimeType", "")
    extension = GOOGLE_DRIVE_FILE_TYPES.get(mime_type)
    if not extension:
        raise HTTPException(status_code=415, detail="Format Drive yang didukung: Google Docs, PDF, DOCX, TXT, dan MD.")
    try:
        if int(metadata.get("size") or "0") > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Ukuran file maksimum adalah 50 MB.")
    except ValueError as error:
        raise HTTPException(status_code=502, detail="Google Drive mengembalikan ukuran file yang tidak valid.") from error

    is_google_doc = mime_type == "application/vnd.google-apps.document"
    download_url = f"{file_url}/export" if is_google_doc else file_url
    download_params = {"mimeType": "application/pdf"} if is_google_doc else {"alt": "media"}
    response = google_drive_request(download_url, token, params=download_params, stream=True)
    content = bytearray()
    try:
        for part in response.iter_content(chunk_size=64 * 1024):
            content.extend(part)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Ukuran file maksimum adalah 50 MB.")
    except requests.exceptions.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Unduhan dari Google Drive terputus: {error}") from error
    finally:
        response.close()
    filename = metadata.get("name") or "google-drive-file"
    if is_google_doc:
        filename = f"{Path(filename).stem}.pdf"
        mime_type = "application/pdf"
    elif Path(filename).suffix.lower() != extension:
        filename = f"{filename}{extension}"
    return index_document(filename, mime_type, bytes(content), "google-drive", "Google Drive", "google-drive")


@app.post("/assistant/chat", dependencies=[Depends(require_authenticated_user)])
def assistant_chat(request: ChatRequest) -> dict[str, Any]:
    supabase = get_supabase()
    conversation_id = request.conversationId
    if conversation_id:
        existing = supabase.table("chat_conversations").select("id").eq("id", conversation_id).maybe_single().execute().data
        if not existing:
            raise HTTPException(status_code=404, detail="Percakapan tidak ditemukan.")
    else:
        conversation = supabase.table("chat_conversations").insert({"title": request.message[:100]}).execute().data
        conversation_id = conversation[0]["id"]

    supabase.table("chat_messages").insert({
        "conversation_id": conversation_id,
        "role": "user",
        "content": request.message,
        "sources": [],
    }).execute()
    try:
        result = rag_graph.invoke({
            "question": request.message,
            "source_ids": request.sourceIds,
            "language": request.language,
        })
    except HTTPException as error:
        supabase.table("chat_messages").insert({
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": str(error.detail),
            "sources": [],
        }).execute()
        supabase.table("chat_conversations").update({"updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", conversation_id).execute()
        raise
    except Exception as error:
        supabase.table("chat_messages").insert({
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": "Asisten mengalami kesalahan saat menjawab. Coba lagi setelah memeriksa koneksi provider.",
            "sources": [],
        }).execute()
        supabase.table("chat_conversations").update({"updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", conversation_id).execute()
        raise HTTPException(
            status_code=provider_http_status(error),
            detail=f"Gagal menjalankan alur RAG: {provider_error_detail(error)}",
        ) from error
    answer = result.get("answer", "")
    sources = result.get("sources", [])
    supabase.table("chat_messages").insert({
        "conversation_id": conversation_id,
        "role": "assistant",
        "content": answer,
        "sources": sources,
    }).execute()
    supabase.table("chat_conversations").update({"updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", conversation_id).execute()
    log_event("question_answered", "Pertanyaan dijawab", "Asisten AI menjawab pertanyaan dari basis pengetahuan.")
    return {
        "answer": answer,
        "sources": sources,
        "conversationId": conversation_id,
        "steps": ["Menelusuri basis pengetahuan", "Menyusun jawaban dari konteks dokumen"],
        "proposedActions": [],
    }


@app.get("/assistant/conversations", dependencies=[Depends(require_authenticated_user)])
def list_conversations() -> list[dict[str, Any]]:
    try:
        rows = get_supabase().table("chat_conversations").select("id, title, created_at, updated_at").order("updated_at", desc=True).limit(100).execute().data or []
        return [{"id": row["id"], "title": row["title"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]} for row in rows]
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal memuat riwayat percakapan: {error}") from error


@app.get("/assistant/conversations/{conversation_id}", dependencies=[Depends(require_authenticated_user)])
def get_conversation(conversation_id: str) -> dict[str, Any]:
    try:
        supabase = get_supabase()
        conversation = supabase.table("chat_conversations").select("id, title, created_at, updated_at").eq("id", conversation_id).maybe_single().execute().data
        if not conversation:
            raise HTTPException(status_code=404, detail="Percakapan tidak ditemukan.")
        messages = supabase.table("chat_messages").select("id, role, content, sources, created_at").eq("conversation_id", conversation_id).order("created_at").execute().data or []
        return {
            "id": conversation["id"],
            "title": conversation["title"],
            "messages": [{"id": item["id"], "role": item["role"], "content": item["content"], "sources": item.get("sources") or [], "createdAt": item["created_at"]} for item in messages],
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal memuat percakapan: {error}") from error


@app.delete("/assistant/conversations/{conversation_id}", dependencies=[Depends(require_authenticated_user)])
def delete_conversation(conversation_id: str) -> dict[str, bool]:
    try:
        get_supabase().table("chat_conversations").delete().eq("id", conversation_id).execute()
        return {"deleted": True}
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal menghapus percakapan: {error}") from error


@app.get("/search", dependencies=[Depends(require_authenticated_user)])
def search(q: str, language: str = "id") -> dict[str, Any]:
    if not q.strip():
        return {"query": q, "results": []}
    try:
        matches = retrieve(q, limit=8)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Gagal mencari dokumen: {error}") from error
    results = [
        {
            "type": "document",
            "id": item.get("document_id"),
            "title": item.get("document_name", "Dokumen"),
            "source": "Basis pengetahuan",
            "snippet": item.get("content", "")[:320],
            "href": "/knowledge",
            "similarity": item.get("similarity"),
        }
        for item in matches
    ]
    return {"query": q, "language": language, "results": results}


@app.get("/documents/{document_id}/text", dependencies=[Depends(require_authenticated_user)])
def get_document_text(document_id: str) -> dict[str, Any]:
    supabase = get_supabase()
    document = supabase.table("documents").select("id, name").eq("id", document_id).maybe_single().execute().data
    if not document:
        raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan.")
    chunks = supabase.table("document_chunks").select("content, metadata").eq(
        "document_id", document_id
    ).order("chunk_index").execute().data or []
    if not chunks:
        raise HTTPException(status_code=409, detail="Teks dokumen belum tersedia.")

    pages: dict[int, list[str]] = {}
    for chunk in chunks:
        metadata = chunk.get("metadata") or {}
        try:
            page_number = int(metadata.get("page", 1))
        except (TypeError, ValueError):
            page_number = 1
        pages.setdefault(page_number, []).append(chunk["content"])

    text = "\n\n".join(
        f"--- Halaman {page_number} ---\n" + "\n".join(contents)
        for page_number, contents in sorted(pages.items())
    )
    return {
        "documentId": document["id"],
        "name": document["name"],
        "pageCount": len(pages),
        "text": text,
    }


@app.post("/documents/{document_id}/summarize", dependencies=[Depends(require_authenticated_user)])
def summarize_document(document_id: str) -> dict[str, Any]:
    supabase = get_supabase()
    document = supabase.table("documents").select("id, name").eq("id", document_id).maybe_single().execute().data
    if not document:
        raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan.")

    chunks = supabase.table("document_chunks").select("content, metadata").eq(
        "document_id", document_id
    ).order("chunk_index").limit(81).execute().data or []
    if not chunks:
        raise HTTPException(status_code=409, detail="Teks dokumen belum tersedia.")
    partial = len(chunks) > 80
    context = "\n\n".join(
        f"[Halaman {item.get('metadata', {}).get('page', 'tidak diketahui')}]\n{item['content']}"
        for item in chunks[:80]
    )
    try:
        result, provider_used = invoke_chat_with_fallback([
            ("system", "Buat ringkasan dokumen yang akurat dalam Bahasa Indonesia. Susun dalam bagian: gambaran umum, poin-poin penting, pihak/tanggal/angka penting jika ada, dan kesimpulan. Gunakan hanya informasi yang tertulis; jangan menambah fakta."),
            ("human", f"Dokumen: {document['name']}\n\nIsi dokumen:\n{context}"),
        ])
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=provider_http_status(error),
            detail=f"Gagal membuat ringkasan dengan Hugging Face: {provider_error_detail(error, 'huggingface')}",
        ) from error
    return {
        "summary": str(result.content),
        "partial": partial,
        "chunksUsed": min(len(chunks), 80),
        "providerUsed": provider_used,
        "fallbackUsed": provider_used != "huggingface",
    }


@app.post("/documents/{document_id}/analyze", dependencies=[Depends(require_authenticated_user)])
def analyze_document(document_id: str) -> dict[str, Any]:
    supabase = get_supabase()
    try:
        response = supabase.table("document_chunks").select("content, metadata").eq(
            "document_id", document_id
        ).order("chunk_index").execute()
        chunks = response.data or []
        if not chunks:
            raise HTTPException(status_code=404, detail="Dokumen belum ditemukan atau belum selesai diindeks.")
        context = "\n\n".join(item["content"] for item in chunks[:40])
        result = get_chat_model().with_structured_output(AnalysisResult, method="json_mode").invoke([
            ("system", "Analisis isi dokumen dan kembalikan JSON valid dengan bentuk {\"extractedFields\": {\"nama field\": \"nilai\"}, \"summary\": \"ringkasan\", \"risks\": [{\"title\": \"judul\", \"severity\": \"High|Medium|Low\", \"detail\": \"penjelasan\"}]}. Ekstrak pihak, tanggal, kewajiban, dan ketentuan yang benar-benar tercantum. Daftar risiko harus berisi risiko nyata dari isi dokumen. Jawab dalam Bahasa Indonesia."),
            ("human", context),
        ])
        document = supabase.table("documents").select("name").eq("id", document_id).maybe_single().execute().data or {}
        log_event("document_analyzed", f"{document.get('name') or 'Dokumen'} dianalisis", "Ekstraksi data, ringkasan, dan risiko selesai.", document_id=document_id)
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=provider_http_status(error),
            detail=f"Gagal menganalisis dokumen: {provider_error_detail(error)}",
        ) from error


@app.post("/documents/{document_id}/ask", dependencies=[Depends(require_authenticated_user)])
def ask_document(document_id: str, request: DocumentQuestionRequest) -> dict[str, Any]:
    supabase = get_supabase()
    try:
        document_response = supabase.table("documents").select("id, name").eq("id", document_id).maybe_single().execute()
        document = document_response.data
        if not document:
            raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan.")

        chunk_response = supabase.table("document_chunks").select("content, metadata").eq(
            "document_id", document_id
        ).order("chunk_index").limit(40).execute()
        chunks = chunk_response.data or []
        if not chunks:
            raise HTTPException(status_code=409, detail="Dokumen belum selesai diindeks.")

        context = "\n\n".join(
            f"[Halaman {chunk.get('metadata', {}).get('page', 'tidak diketahui')}]\n{chunk['content']}"
            for chunk in chunks
        )
        primary_provider = request.provider or get_llm_provider()
        result, provider_used = invoke_chat_with_fallback([
            ("system", "Jawab pertanyaan hanya berdasarkan dokumen yang diberikan. Jika jawabannya tidak ada di dokumen, katakan dengan jelas. Jangan mengarang fakta. Jawab dalam Bahasa Indonesia jika language=id."),
            ("human", f"Pertanyaan: {request.question}\nBahasa: {request.language}\n\nDokumen: {document['name']}\n\nIsi dokumen:\n{context}"),
        ], primary_provider)
        log_event("question_answered", "Pertanyaan dokumen dijawab", f"Jawaban dibuat dari {document['name']}.", document_id=document_id)
        return {
            "answer": str(result.content),
            "providerUsed": provider_used,
            "fallbackUsed": provider_used != primary_provider,
            "sources": [
                {
                    "documentName": document["name"],
                    "page": chunk.get("metadata", {}).get("page", 1),
                    "snippet": chunk["content"][:320],
                }
                for chunk in chunks[:5]
            ],
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=provider_http_status(error),
            detail=f"Gagal menjawab pertanyaan dokumen: {provider_error_detail(error, request.provider)}",
        ) from error


from backend.meetings import router as meetings_router

app.include_router(meetings_router)