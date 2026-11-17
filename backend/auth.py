from __future__ import annotations

import os
from typing import Any

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

_supabase: Client | None = None
bearer_auth = HTTPBearer(auto_error=False)


def get_supabase() -> Client:
    global _supabase
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase belum dikonfigurasi. Isi URL dan SUPABASE_SECRET_KEY di .env.")
    if _supabase is None:
        _supabase = create_client(url, key)
    return _supabase


def require_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_auth),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Login diperlukan untuk mengakses fitur ini.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    public_key = (
        os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    )
    if not supabase_url or not public_key:
        raise HTTPException(
            status_code=503,
            detail="Konfigurasi Supabase Auth belum lengkap. Atur URL dan public/publishable key.",
        )

    try:
        response = requests.get(
            f"{supabase_url.rstrip('/')}/auth/v1/user",
            headers={
                "apikey": public_key,
                "Authorization": f"Bearer {credentials.credentials}",
            },
            timeout=10,
        )
    except requests.RequestException as error:
        raise HTTPException(status_code=503, detail="Supabase Auth tidak dapat dihubungi.") from error

    if response.status_code in {401, 403}:
        raise HTTPException(
            status_code=401,
            detail="Sesi login tidak valid atau sudah kedaluwarsa. Silakan login kembali.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Supabase Auth gagal memvalidasi sesi.")

    try:
        user = response.json()
    except ValueError as error:
        raise HTTPException(status_code=503, detail="Respons Supabase Auth tidak valid.") from error
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Sesi login tidak valid.")
    return user
