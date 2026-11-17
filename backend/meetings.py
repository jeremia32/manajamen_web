from __future__ import annotations

import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth import get_supabase, require_authenticated_user
from backend.connectors import ConnectorError, decrypt_credentials, encrypt_credentials

router = APIRouter()
logger = logging.getLogger(__name__)
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_CONNECTION_TABLE = "meeting_google_connection"
GOOGLE_STATES_TABLE = "meeting_google_oauth_states"


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    profile_photo_url: str | None = Field(default=None, max_length=2048)
    position: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)


class MeetingInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=12000)
    starts_at: datetime
    ends_at: datetime
    timezone: str = Field(default="Asia/Jakarta", max_length=64)
    location: str = Field(default="", max_length=500)
    meeting_type: str = Field(default="team", max_length=80)
    participant_ids: list[UUID] = Field(default_factory=list, max_length=100)


class MeetingResponseInput(BaseModel):
    invitation_status: str


class AttendanceInput(BaseModel):
    attendance_status: str


class GoogleOAuthCallback(BaseModel):
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=1, max_length=256)


def _user_id(user: dict[str, Any]) -> UUID:
    try:
        return UUID(str(user["id"]))
    except (KeyError, ValueError, TypeError) as error:
        raise HTTPException(status_code=401, detail="Identitas login tidak valid.") from error


def _profile_for_user(user: dict[str, Any]) -> dict[str, Any]:
    user_id = _user_id(user)
    supabase = get_supabase()
    profile = (
        supabase.table("profiles")
        .select("user_id, email, full_name, profile_photo_url, position, department, account_status, last_seen_at")
        .eq("user_id", str(user_id))
        .maybe_single()
        .execute()
        .data
    )
    email = str(user.get("email") or "")
    if not profile:
        metadata = user.get("user_metadata") if isinstance(user.get("user_metadata"), dict) else {}
        profile = (
            supabase.table("profiles")
            .upsert(
                {
                    "user_id": str(user_id),
                    "email": email,
                    "full_name": str(metadata.get("full_name") or metadata.get("name") or "")[:120],
                    "profile_photo_url": metadata.get("avatar_url") or metadata.get("picture"),
                },
                on_conflict="user_id",
            )
            .select("user_id, email, full_name, profile_photo_url, position, department, account_status, last_seen_at")
            .execute()
            .data[0]
        )
    elif email != profile.get("email"):
        profile = (
            supabase.table("profiles")
            .update({"email": email, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("user_id", str(user_id))
            .select("user_id, email, full_name, profile_photo_url, position, department, account_status, last_seen_at")
            .execute()
            .data[0]
        )
    if profile.get("account_status") != "active":
        raise HTTPException(status_code=403, detail="Akun workspace tidak aktif.")
    return profile


def _is_meeting_admin(user: dict[str, Any]) -> bool:
    configured = {
        email.strip().casefold()
        for email in os.getenv("MEETING_ADMIN_EMAILS", "").split(",")
        if email.strip()
    }
    return str(user.get("email") or "").casefold() in configured


def _require_meeting_admin(user: dict[str, Any]) -> None:
    if not os.getenv("MEETING_ADMIN_EMAILS", "").strip():
        raise HTTPException(status_code=503, detail="Atur MEETING_ADMIN_EMAILS di backend untuk mengelola kalender bersama.")
    if not _is_meeting_admin(user):
        raise HTTPException(status_code=403, detail="Hanya admin workspace yang dapat mengelola kalender bersama.")


def _profile_payload(profile: dict[str, Any]) -> dict[str, Any]:
    last_seen = profile.get("last_seen_at")
    online = False
    if last_seen:
        try:
            seen_at = datetime.fromisoformat(str(last_seen).replace("Z", "+00:00"))
            if seen_at.tzinfo is None:
                seen_at = seen_at.replace(tzinfo=timezone.utc)
            online = datetime.now(timezone.utc) - seen_at.astimezone(timezone.utc) <= timedelta(seconds=90)
        except ValueError:
            logger.warning("Ignoring invalid last_seen_at value for profile %s", profile.get("user_id"))
    return {**profile, "online_status": "online" if online else "offline"}


def _validate_profile_photo(url: str | None) -> str | None:
    if not url:
        return None
    if not url.startswith(("https://", "http://")):
        raise HTTPException(status_code=422, detail="Foto profil harus menggunakan URL HTTP atau HTTPS.")
    return url


@router.get("/profiles/me")
def get_my_profile(user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    return _profile_payload(_profile_for_user(user))


@router.patch("/profiles/me")
def update_my_profile(
    payload: ProfileUpdate,
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    profile = _profile_for_user(user)
    updates = payload.model_dump(exclude_unset=True)
    if "full_name" in updates:
        updates["full_name"] = (updates["full_name"] or "").strip()
        if not updates["full_name"]:
            raise HTTPException(status_code=422, detail="Nama lengkap wajib diisi.")
    if "position" in updates:
        updates["position"] = (updates["position"] or "").strip()
    if "department" in updates:
        updates["department"] = (updates["department"] or "").strip()
    if "profile_photo_url" in updates:
        updates["profile_photo_url"] = _validate_profile_photo(updates["profile_photo_url"])
    if updates:
        result = (
            get_supabase()
            .table("profiles")
            .update({**updates, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("user_id", str(profile["user_id"]))
            .select("user_id, email, full_name, profile_photo_url, position, department, account_status, last_seen_at")
            .execute()
            .data
        )
        if not result:
            raise HTTPException(status_code=502, detail="Profil tidak dapat disimpan.")
        profile = result[0]
    return _profile_payload(profile)


@router.post("/profiles/presence")
def update_presence(user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, str]:
    profile = _profile_for_user(user)
    seen_at = datetime.now(timezone.utc).isoformat()
    (
        get_supabase()
        .table("profiles")
        .update({"last_seen_at": seen_at, "updated_at": seen_at})
        .eq("user_id", str(profile["user_id"]))
        .execute()
    )
    return {"last_seen_at": seen_at}


@router.get("/profiles")
def list_profiles(
    q: str = "",
    department: str = "",
    position: str = "",
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> list[dict[str, Any]]:
    _profile_for_user(user)
    supabase = get_supabase()

    def profile_query() -> Any:
        query = supabase.table("profiles").select(
            "user_id, email, full_name, profile_photo_url, position, department, account_status, last_seen_at"
        ).eq("account_status", "active")
        if department:
            query = query.eq("department", department)
        if position:
            query = query.eq("position", position)
        return query

    if q.strip():
        search = q.strip()[:100]
        name_matches = profile_query().ilike("full_name", f"%{search}%").limit(250).execute().data or []
        email_matches = profile_query().ilike("email", f"%{search}%").limit(250).execute().data or []
        profiles = {str(item["user_id"]): item for item in [*name_matches, *email_matches]}.values()
    else:
        profiles = profile_query().order("full_name").limit(500).execute().data or []
    return [_profile_payload(profile) for profile in profiles]


def _calendar_settings() -> tuple[str, str, str]:
    client_id = os.getenv("GOOGLE_MEET_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_MEET_CLIENT_SECRET", "")
    redirect_uri = os.getenv("GOOGLE_MEET_REDIRECT_URI", "")
    if not all((client_id, client_secret, redirect_uri)):
        raise HTTPException(
            status_code=503,
            detail="Google Calendar belum dikonfigurasi. Isi GOOGLE_MEET_CLIENT_ID, GOOGLE_MEET_CLIENT_SECRET, dan GOOGLE_MEET_REDIRECT_URI di backend.",
        )
    return client_id, client_secret, redirect_uri


def _google_api_error(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:300]
    error = payload.get("error", {})
    if isinstance(error, dict):
        return str(error.get("message") or error.get("status") or "Google Calendar menolak request.")
    return str(error or "Google Calendar menolak request.")


def _shared_calendar_connection() -> dict[str, Any]:
    connection = (
        get_supabase()
        .table(GOOGLE_CONNECTION_TABLE)
        .select("*")
        .eq("singleton", True)
        .maybe_single()
        .execute()
        .data
    )
    if not connection:
        raise HTTPException(status_code=503, detail="Kalender Google workspace belum dihubungkan oleh admin.")
    return connection


def _save_calendar_credentials(connection: dict[str, Any], credentials: dict[str, str]) -> None:
    (
        get_supabase()
        .table(GOOGLE_CONNECTION_TABLE)
        .update({
            "credentials_encrypted": encrypt_credentials(credentials),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("singleton", True)
        .execute()
    )


def _refresh_calendar_token(connection: dict[str, Any], credentials: dict[str, str]) -> str:
    refresh_token = credentials.get("refresh_token", "")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Token kalender Google tidak dapat diperbarui. Admin perlu menghubungkan ulang akun kalender.")
    client_id, client_secret, _ = _calendar_settings()
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
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat memperbarui akses Google Calendar: {error}") from error
    if not response.ok:
        raise HTTPException(status_code=401, detail=f"Sesi Google Calendar kedaluwarsa: {_google_api_error(response)}")
    token_payload = response.json()
    credentials.update({
        "access_token": token_payload["access_token"],
        "expires_at": str(time.time() + int(token_payload.get("expires_in", 3600))),
    })
    try:
        _save_calendar_credentials(connection, credentials)
    except ConnectorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    return credentials["access_token"]


def _calendar_access_token(connection: dict[str, Any], *, force_refresh: bool = False) -> str:
    try:
        credentials = decrypt_credentials(connection.get("credentials_encrypted"))
    except ConnectorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    if not force_refresh and credentials.get("access_token") and float(credentials.get("expires_at", "0")) > time.time() + 60:
        return credentials["access_token"]
    return _refresh_calendar_token(connection, credentials)


def _calendar_api(
    connection: dict[str, Any],
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    for attempt in range(2):
        token = _calendar_access_token(connection, force_refresh=attempt == 1)
        try:
            response = requests.request(
                method,
                f"{GOOGLE_CALENDAR_API}{path}",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                json=payload,
                timeout=30,
            )
        except requests.RequestException as error:
            raise HTTPException(status_code=502, detail=f"Tidak dapat menghubungi Google Calendar: {error}") from error
        if response.status_code == 401 and attempt == 0:
            continue
        if not response.ok:
            raise HTTPException(
                status_code=502,
                detail=f"Google Calendar menolak request (HTTP {response.status_code}): {_google_api_error(response)}",
            )
        if not response.content:
            return {}
        return response.json()
    raise HTTPException(status_code=401, detail="Sesi Google Calendar tidak valid. Admin perlu menghubungkan ulang akun kalender.")


def _calendar_event_payload(
    title: str,
    description: str,
    starts_at: datetime,
    ends_at: datetime,
    timezone_name: str,
    location: str,
    attendees: list[str],
) -> dict[str, Any]:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as error:
        raise HTTPException(status_code=422, detail="Zona waktu meeting tidak valid.") from error
    return {
        "summary": title,
        "description": description,
        "location": location or None,
        "start": {"dateTime": starts_at.astimezone(zone).isoformat(), "timeZone": timezone_name},
        "end": {"dateTime": ends_at.astimezone(zone).isoformat(), "timeZone": timezone_name},
        "attendees": [{"email": email} for email in sorted(set(attendees))],
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "email", "minutes": 5760},
                {"method": "email", "minutes": 1440},
                {"method": "email", "minutes": 30},
                {"method": "email", "minutes": 0},
            ],
        },
    }


def _meeting_attendee_emails(user_ids: list[str]) -> list[str]:
    if not user_ids:
        return []
    profiles = (
        get_supabase()
        .table("profiles")
        .select("user_id, email, account_status")
        .in_("user_id", user_ids)
        .execute()
        .data
        or []
    )
    profile_by_id = {str(profile["user_id"]): profile for profile in profiles}
    missing = [user_id for user_id in user_ids if user_id not in profile_by_id or not profile_by_id[user_id].get("email")]
    inactive = [user_id for user_id in user_ids if user_id in profile_by_id and profile_by_id[user_id].get("account_status") != "active"]
    if missing:
        raise HTTPException(status_code=422, detail="Setiap peserta harus merupakan user aktif dengan email terverifikasi.")
    if inactive:
        raise HTTPException(status_code=422, detail="Peserta yang dipilih memiliki akun tidak aktif.")
    return [str(profile_by_id[user_id]["email"]) for user_id in user_ids]


def _create_google_meet_event(
    connection: dict[str, Any],
    meeting_data: MeetingInput,
    attendee_emails: list[str],
) -> tuple[str, str]:
    event_payload = _calendar_event_payload(
        meeting_data.title.strip(),
        meeting_data.description,
        meeting_data.starts_at,
        meeting_data.ends_at,
        meeting_data.timezone,
        meeting_data.location,
        attendee_emails,
    )
    event_payload["conferenceData"] = {
        "createRequest": {
            "requestId": str(uuid4()),
            "conferenceSolutionKey": {"type": "hangoutsMeet"},
        }
    }
    event = _calendar_api(
        connection,
        "POST",
        "/calendars/primary/events",
        params={"conferenceDataVersion": 1, "sendUpdates": "all"},
        payload=event_payload,
    )
    event_id = str(event.get("id") or "")
    if not event_id:
        raise HTTPException(status_code=502, detail="Google Calendar tidak mengembalikan ID event.")
    meet_link = _event_meet_link(event)
    for _ in range(10):
        if meet_link:
            break
        conference_status = ((event.get("conferenceData") or {}).get("createRequest") or {}).get("status", {}).get("statusCode")
        if conference_status == "failure":
            break
        time.sleep(1)
        event = _calendar_api(connection, "GET", f"/calendars/primary/events/{event_id}")
        meet_link = _event_meet_link(event)
    if not meet_link:
        _calendar_api(
            connection,
            "DELETE",
            f"/calendars/primary/events/{event_id}",
            params={"sendUpdates": "none"},
        )
        raise HTTPException(status_code=502, detail="Google Calendar membuat event tetapi tidak menghasilkan link Google Meet.")
    return event_id, meet_link


def _event_meet_link(event: dict[str, Any]) -> str:
    link = event.get("hangoutLink")
    if link:
        return str(link)
    conference = event.get("conferenceData") or {}
    for entry_point in conference.get("entryPoints", []):
        if entry_point.get("entryPointType") == "video" and entry_point.get("uri"):
            return str(entry_point["uri"])
    return ""


def _meeting_profiles(meeting_ids: list[str]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    if not meeting_ids:
        return {}, {}
    participants = (
        get_supabase()
        .table("meeting_participants")
        .select("meeting_id, user_id, invitation_status, attendance_status")
        .in_("meeting_id", meeting_ids)
        .execute()
        .data
        or []
    )
    meetings = (
        get_supabase()
        .table("meetings")
        .select("id, organizer_id")
        .in_("id", meeting_ids)
        .execute()
        .data
        or []
    )
    user_ids = list({
        *[str(row["user_id"]) for row in participants],
        *[str(meeting["organizer_id"]) for meeting in meetings],
    })
    profiles = (
        get_supabase()
        .table("profiles")
        .select("user_id, email, full_name, profile_photo_url, position, department, last_seen_at")
        .in_("user_id", user_ids)
        .execute()
        .data
        or []
    ) if user_ids else []
    profile_map = {str(profile["user_id"]): _profile_payload(profile) for profile in profiles}
    participants_by_meeting: dict[str, list[dict[str, Any]]] = {}
    for row in participants:
        profile = profile_map.get(str(row["user_id"]), {})
        participants_by_meeting.setdefault(str(row["meeting_id"]), []).append({
            **profile,
            "user_id": str(row["user_id"]),
            "invitation_status": row["invitation_status"],
            "attendance_status": row["attendance_status"],
        })
    return profile_map, participants_by_meeting


def _meeting_payloads(meetings: list[dict[str, Any]], *, include_participants: bool = False) -> list[dict[str, Any]]:
    if not meetings:
        return []
    meeting_ids = [str(meeting["id"]) for meeting in meetings]
    profile_map, participants_by_meeting = _meeting_profiles(meeting_ids)
    payloads = []
    now = datetime.now(timezone.utc)
    for meeting in meetings:
        participants = participants_by_meeting.get(str(meeting["id"]), [])
        starts_at = datetime.fromisoformat(str(meeting["starts_at"]).replace("Z", "+00:00"))
        ends_at = datetime.fromisoformat(str(meeting["ends_at"]).replace("Z", "+00:00"))
        status = meeting["status"]
        if status == "scheduled" and starts_at <= now < ends_at:
            status = "ongoing"
        elif status in {"scheduled", "ongoing"} and ends_at <= now:
            status = "completed"
        result = {
            **meeting,
            "status": status,
            "organizer": profile_map.get(str(meeting["organizer_id"])),
            "participant_count": len(participants),
        }
        if include_participants:
            result["participants"] = participants
        payloads.append(result)
    return payloads


def _get_meeting(meeting_id: UUID) -> dict[str, Any]:
    meeting = (
        get_supabase()
        .table("meetings")
        .select("*")
        .eq("id", str(meeting_id))
        .maybe_single()
        .execute()
        .data
    )
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting tidak ditemukan.")
    return meeting


def _authorize_meeting(meeting: dict[str, Any], user: dict[str, Any]) -> None:
    user_id = str(_user_id(user))
    if str(meeting["organizer_id"]) == user_id or _is_meeting_admin(user):
        return
    participant = (
        get_supabase()
        .table("meeting_participants")
        .select("user_id")
        .eq("meeting_id", str(meeting["id"]))
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Meeting tidak ditemukan.")


def _validate_schedule(payload: MeetingInput) -> None:
    if payload.starts_at.tzinfo is None or payload.ends_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="Waktu meeting harus menyertakan zona waktu.")
    if payload.starts_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Meeting harus dijadwalkan pada waktu mendatang.")
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="Waktu selesai harus setelah waktu mulai.")
    try:
        ZoneInfo(payload.timezone)
    except ZoneInfoNotFoundError as error:
        raise HTTPException(status_code=422, detail="Zona waktu meeting tidak valid.") from error


def _normalized_participant_ids(participant_ids: list[UUID], organizer_id: UUID) -> list[str]:
    return sorted({str(user_id) for user_id in participant_ids if user_id != organizer_id})


def _database_meeting_payload(
    payload: MeetingInput,
    *,
    organizer_id: str | None = None,
    event_id: str,
    meet_link: str,
) -> dict[str, Any]:
    return {
        "p_title": payload.title.strip(),
        "p_description": payload.description.strip(),
        "p_organizer_id": organizer_id,
        "p_starts_at": payload.starts_at.astimezone(timezone.utc).isoformat(),
        "p_ends_at": payload.ends_at.astimezone(timezone.utc).isoformat(),
        "p_timezone": payload.timezone,
        "p_location": payload.location.strip(),
        "p_meeting_type": payload.meeting_type.strip(),
        "p_google_calendar_event_id": event_id,
        "p_google_meet_link": meet_link,
        "p_participant_ids": [str(user_id) for user_id in payload.participant_ids],
    }


def _database_meeting_update_payload(payload: MeetingInput, event_id: str, meet_link: str) -> dict[str, Any]:
    result = _database_meeting_payload(payload, event_id=event_id, meet_link=meet_link)
    result.pop("p_organizer_id")
    return result


@router.get("/meetings/calendar/connection")
def calendar_connection_status(user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    _profile_for_user(user)
    connection = (
        get_supabase()
        .table(GOOGLE_CONNECTION_TABLE)
        .select("email, display_name, connected_by, updated_at")
        .eq("singleton", True)
        .maybe_single()
        .execute()
        .data
    )
    return {
        "connected": bool(connection),
        "can_manage": _is_meeting_admin(user),
        "calendar": connection,
    }


@router.post("/meetings/calendar/auth/start")
def start_calendar_oauth(user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, str]:
    _profile_for_user(user)
    _require_meeting_admin(user)
    client_id, _, redirect_uri = _calendar_settings()
    state = secrets.token_urlsafe(32)
    supabase = get_supabase()
    now = datetime.now(timezone.utc)
    supabase.table(GOOGLE_STATES_TABLE).delete().lt("expires_at", now.isoformat()).execute()
    supabase.table(GOOGLE_STATES_TABLE).insert({
        "state": state,
        "user_id": str(_user_id(user)),
        "expires_at": (now + timedelta(minutes=10)).isoformat(),
    }).execute()
    authorization_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile https://www.googleapis.com/auth/calendar.events",
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    })
    return {"authorization_url": authorization_url, "state": state}


@router.post("/meetings/calendar/auth/callback")
def complete_calendar_oauth(payload: GoogleOAuthCallback) -> dict[str, Any]:
    supabase = get_supabase()
    state_row = (
        supabase.table(GOOGLE_STATES_TABLE)
        .select("user_id, expires_at")
        .eq("state", payload.state)
        .maybe_single()
        .execute()
        .data
    )
    if not state_row or datetime.fromisoformat(str(state_row["expires_at"]).replace("Z", "+00:00")) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="State Google OAuth tidak ditemukan atau kedaluwarsa. Coba hubungkan ulang.")
    supabase.table(GOOGLE_STATES_TABLE).delete().eq("state", payload.state).execute()

    admin = supabase.auth.admin.get_user_by_id(state_row["user_id"])
    admin_user = getattr(admin, "user", None)
    admin_email = getattr(admin_user, "email", None) if admin_user else None
    if not admin_email or not _is_meeting_admin({"email": admin_email}):
        raise HTTPException(status_code=403, detail="Admin workspace tidak lagi diizinkan menghubungkan kalender bersama.")

    client_id, client_secret, redirect_uri = _calendar_settings()
    try:
        token_response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": payload.code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=20,
        )
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat menyelesaikan OAuth Google Calendar: {error}") from error
    if not token_response.ok:
        raise HTTPException(status_code=401, detail=f"OAuth Google Calendar gagal: {_google_api_error(token_response)}")
    token_payload = token_response.json()
    if not token_payload.get("access_token") or not token_payload.get("refresh_token"):
        raise HTTPException(status_code=401, detail="Google tidak mengembalikan refresh token. Admin perlu menghubungkan ulang dan menyetujui akses kalender.")

    try:
        profile_response = requests.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token_payload['access_token']}"},
            timeout=20,
        )
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Tidak dapat membaca profil akun Google: {error}") from error
    if not profile_response.ok:
        raise HTTPException(status_code=502, detail=f"Google gagal mengembalikan profil akun: {_google_api_error(profile_response)}")
    google_profile = profile_response.json()
    google_user_id = google_profile.get("sub")
    if not google_user_id:
        raise HTTPException(status_code=401, detail="Google tidak memberikan identitas akun.")
    credentials = {
        "access_token": token_payload["access_token"],
        "refresh_token": token_payload["refresh_token"],
        "expires_at": str(time.time() + int(token_payload.get("expires_in", 3600))),
    }
    try:
        encrypted_credentials = encrypt_credentials(credentials)
    except ConnectorError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    connection = supabase.table(GOOGLE_CONNECTION_TABLE).upsert(
        {
            "singleton": True,
            "google_user_id": str(google_user_id),
            "display_name": google_profile.get("name") or google_profile.get("email") or "Google workspace",
            "email": google_profile.get("email", ""),
            "credentials_encrypted": encrypted_credentials,
            "connected_by": state_row["user_id"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="singleton",
    ).select("email").execute().data
    if not connection:
        raise HTTPException(status_code=502, detail="Google berhasil dihubungkan tetapi koneksi tidak dapat disimpan.")
    return {"connected": True, "email": connection[0]["email"]}


@router.delete("/meetings/calendar/connection")
def disconnect_calendar(user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, bool]:
    _profile_for_user(user)
    _require_meeting_admin(user)
    connection = _shared_calendar_connection()
    try:
        credentials = decrypt_credentials(connection.get("credentials_encrypted"))
    except ConnectorError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    refresh_token = credentials.get("refresh_token")
    if refresh_token:
        try:
            response = requests.post("https://oauth2.googleapis.com/revoke", data={"token": refresh_token}, timeout=20)
        except requests.RequestException as error:
            raise HTTPException(status_code=502, detail=f"Tidak dapat mencabut akses kalender Google: {error}") from error
        if not response.ok:
            raise HTTPException(status_code=502, detail=f"Google gagal mencabut akses kalender (HTTP {response.status_code}).")
    get_supabase().table(GOOGLE_CONNECTION_TABLE).delete().eq("singleton", True).execute()
    return {"disconnected": True}


@router.get("/meetings")
def list_meetings(user: dict[str, Any] = Depends(require_authenticated_user)) -> list[dict[str, Any]]:
    profile = _profile_for_user(user)
    user_id = str(profile["user_id"])
    own_meetings = (
        get_supabase()
        .table("meetings")
        .select("*")
        .eq("organizer_id", user_id)
        .order("starts_at", desc=True)
        .limit(500)
        .execute()
        .data
        or []
    )
    participations = (
        get_supabase()
        .table("meeting_participants")
        .select("meeting_id")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    meeting_ids = {str(meeting["id"]) for meeting in own_meetings}
    meeting_ids.update(str(row["meeting_id"]) for row in participations)
    if not meeting_ids:
        return []
    meetings = (
        get_supabase()
        .table("meetings")
        .select("*")
        .in_("id", list(meeting_ids))
        .order("starts_at", desc=True)
        .limit(1000)
        .execute()
        .data
        or []
    )
    return _meeting_payloads(meetings)


@router.post("/meetings")
def create_meeting(
    payload: MeetingInput,
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    profile = _profile_for_user(user)
    _validate_schedule(payload)
    connection = _shared_calendar_connection()
    participant_ids = _normalized_participant_ids(payload.participant_ids, _user_id(user))
    attendee_emails = _meeting_attendee_emails(participant_ids)
    event_id, meet_link = _create_google_meet_event(connection, payload, attendee_emails)
    db_payload = _database_meeting_payload(payload, organizer_id=str(profile["user_id"]), event_id=event_id, meet_link=meet_link)
    try:
        result = get_supabase().rpc("create_meeting_transaction", db_payload).execute().data
        meeting_id = str(result)
    except Exception as error:
        logger.exception("Could not save meeting after creating Google Calendar event %s", event_id)
        try:
            _calendar_api(
                connection,
                "DELETE",
                f"/calendars/primary/events/{event_id}",
                params={"sendUpdates": "all"},
            )
        except HTTPException:
            logger.exception("Could not roll back orphaned Google Calendar event %s", event_id)
            raise HTTPException(
                status_code=502,
                detail="Meeting gagal disimpan dan event Google Calendar tidak dapat dibatalkan. Hubungi admin workspace.",
            ) from error
        raise HTTPException(status_code=502, detail="Meeting gagal disimpan; event Google Calendar sudah dibatalkan.") from error
    return get_meeting(UUID(meeting_id), user)


@router.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: UUID, user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    _profile_for_user(user)
    meeting = _get_meeting(meeting_id)
    _authorize_meeting(meeting, user)
    return _meeting_payloads([meeting], include_participants=True)[0]


@router.patch("/meetings/{meeting_id}")
def update_meeting(
    meeting_id: UUID,
    payload: MeetingInput,
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    profile = _profile_for_user(user)
    meeting = _get_meeting(meeting_id)
    if str(meeting["organizer_id"]) != str(profile["user_id"]) and not _is_meeting_admin(user):
        raise HTTPException(status_code=403, detail="Hanya organizer atau admin yang dapat mengubah meeting.")
    if meeting["status"] != "scheduled":
        raise HTTPException(status_code=409, detail="Meeting yang sedang berjalan atau sudah selesai tidak dapat diubah.")
    _validate_schedule(payload)
    participant_ids = _normalized_participant_ids(payload.participant_ids, UUID(str(meeting["organizer_id"])))
    attendee_emails = _meeting_attendee_emails(participant_ids)
    participant_rows = (
        get_supabase()
        .table("meeting_participants")
        .select("user_id")
        .eq("meeting_id", str(meeting_id))
        .execute()
        .data
        or []
    )
    old_attendee_emails = _meeting_attendee_emails([str(row["user_id"]) for row in participant_rows])
    connection = _shared_calendar_connection()
    old_start = datetime.fromisoformat(str(meeting["starts_at"]).replace("Z", "+00:00"))
    old_end = datetime.fromisoformat(str(meeting["ends_at"]).replace("Z", "+00:00"))
    old_event_payload = _calendar_event_payload(
        meeting["title"], meeting.get("description", ""), old_start, old_end,
        meeting.get("timezone") or "Asia/Jakarta", meeting.get("location") or "", old_attendee_emails,
    )
    new_event_payload = _calendar_event_payload(
        payload.title.strip(), payload.description, payload.starts_at, payload.ends_at,
        payload.timezone, payload.location, attendee_emails,
    )
    event_id = str(meeting["google_calendar_event_id"])
    _calendar_api(
        connection,
        "PATCH",
        f"/calendars/primary/events/{event_id}",
        params={"sendUpdates": "all"},
        payload=new_event_payload,
    )
    try:
        result = get_supabase().rpc(
            "update_meeting_transaction",
            {
                **_database_meeting_update_payload(payload, event_id, str(meeting["google_meet_link"])),
                "p_meeting_id": str(meeting_id),
            },
        ).execute()
        if result.data is None:
            raise RuntimeError("Database tidak mengembalikan hasil perubahan meeting.")
    except Exception as error:
        logger.exception("Could not save meeting changes after updating Google Calendar event %s", event_id)
        try:
            _calendar_api(
                connection,
                "PATCH",
                f"/calendars/primary/events/{event_id}",
                params={"sendUpdates": "none"},
                payload=old_event_payload,
            )
        except HTTPException:
            logger.exception("Could not roll back Google Calendar event %s", event_id)
            raise HTTPException(
                status_code=502,
                detail="Perubahan jadwal gagal disimpan dan event Google Calendar tidak dapat dipulihkan. Hubungi admin workspace.",
            ) from error
        raise HTTPException(status_code=502, detail="Perubahan meeting gagal disimpan; event Google Calendar sudah dipulihkan.") from error
    return get_meeting(meeting_id, user)


@router.post("/meetings/{meeting_id}/participants")
def add_meeting_participants(
    meeting_id: UUID,
    payload: list[UUID],
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    profile = _profile_for_user(user)
    meeting = _get_meeting(meeting_id)
    if str(meeting["organizer_id"]) != str(profile["user_id"]) and not _is_meeting_admin(user):
        raise HTTPException(status_code=403, detail="Hanya organizer atau admin yang dapat menambah peserta.")
    if meeting["status"] != "scheduled":
        raise HTTPException(status_code=409, detail="Peserta hanya dapat ditambahkan ke meeting terjadwal.")
    new_ids = _normalized_participant_ids(payload, UUID(str(meeting["organizer_id"])))
    existing_rows = (
        get_supabase()
        .table("meeting_participants")
        .select("user_id")
        .eq("meeting_id", str(meeting_id))
        .execute()
        .data
        or []
    )
    existing_ids = {str(row["user_id"]) for row in existing_rows}
    added_ids = [user_id for user_id in new_ids if user_id not in existing_ids]
    if not added_ids:
        return get_meeting(meeting_id, user)
    new_emails = _meeting_attendee_emails(added_ids)
    all_emails = _meeting_attendee_emails(sorted(existing_ids)) + new_emails
    connection = _shared_calendar_connection()
    starts_at = datetime.fromisoformat(str(meeting["starts_at"]).replace("Z", "+00:00"))
    ends_at = datetime.fromisoformat(str(meeting["ends_at"]).replace("Z", "+00:00"))
    event_payload = _calendar_event_payload(
        meeting["title"], meeting.get("description", ""), starts_at, ends_at,
        meeting.get("timezone") or "Asia/Jakarta", meeting.get("location") or "", all_emails,
    )
    event_id = str(meeting["google_calendar_event_id"])
    _calendar_api(
        connection,
        "PATCH",
        f"/calendars/primary/events/{event_id}",
        params={"sendUpdates": "all"},
        payload=event_payload,
    )
    try:
        get_supabase().rpc(
            "add_meeting_participants_transaction",
            {"p_meeting_id": str(meeting_id), "p_participant_ids": added_ids},
        ).execute()
    except Exception as error:
        logger.exception("Could not add meeting participants after updating Google Calendar event %s", event_id)
        old_event_payload = _calendar_event_payload(
            meeting["title"], meeting.get("description", ""), starts_at, ends_at,
            meeting.get("timezone") or "Asia/Jakarta", meeting.get("location") or "",
            _meeting_attendee_emails(sorted(existing_ids)),
        )
        try:
            _calendar_api(
                connection,
                "PATCH",
                f"/calendars/primary/events/{event_id}",
                params={"sendUpdates": "none"},
                payload=old_event_payload,
            )
        except HTTPException:
            logger.exception("Could not roll back Google Calendar attendees for event %s", event_id)
            raise HTTPException(status_code=502, detail="Peserta gagal disimpan dan undangan Google Calendar tidak dapat dipulihkan.") from error
        raise HTTPException(status_code=502, detail="Peserta gagal disimpan; event Google Calendar sudah dipulihkan.") from error
    return get_meeting(meeting_id, user)


@router.post("/meetings/{meeting_id}/cancel")
def cancel_meeting(
    meeting_id: UUID,
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    profile = _profile_for_user(user)
    meeting = _get_meeting(meeting_id)
    if str(meeting["organizer_id"]) != str(profile["user_id"]) and not _is_meeting_admin(user):
        raise HTTPException(status_code=403, detail="Hanya organizer atau admin yang dapat membatalkan meeting.")
    if meeting["status"] not in {"scheduled", "ongoing"}:
        raise HTTPException(status_code=409, detail="Meeting ini sudah selesai atau dibatalkan.")
    connection = _shared_calendar_connection()
    event_id = str(meeting["google_calendar_event_id"])
    _calendar_api(
        connection,
        "DELETE",
        f"/calendars/primary/events/{event_id}",
        params={"sendUpdates": "all"},
    )
    try:
        get_supabase().rpc("cancel_meeting_transaction", {"p_meeting_id": str(meeting_id)}).execute()
    except Exception as error:
        logger.exception("Could not save cancellation after deleting Google Calendar event %s", event_id)
        raise HTTPException(
            status_code=502,
            detail="Google Calendar membatalkan event tetapi status meeting gagal disimpan. Hubungi admin workspace.",
        ) from error
    return get_meeting(meeting_id, user)


@router.post("/meetings/{meeting_id}/response")
def respond_to_meeting(
    meeting_id: UUID,
    payload: MeetingResponseInput,
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    profile = _profile_for_user(user)
    if payload.invitation_status not in {"accepted", "declined"}:
        raise HTTPException(status_code=422, detail="Respons undangan harus diterima atau ditolak.")
    meeting = _get_meeting(meeting_id)
    if meeting["status"] == "cancelled":
        raise HTTPException(status_code=409, detail="Meeting ini sudah dibatalkan.")
    get_supabase().rpc(
        "respond_to_meeting_transaction",
        {
            "p_meeting_id": str(meeting_id),
            "p_user_id": str(profile["user_id"]),
            "p_invitation_status": payload.invitation_status,
        },
    ).execute()
    return get_meeting(meeting_id, user)


@router.post("/meetings/{meeting_id}/participants/{participant_user_id}/attendance")
def update_attendance(
    meeting_id: UUID,
    participant_user_id: UUID,
    payload: AttendanceInput,
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, Any]:
    profile = _profile_for_user(user)
    meeting = _get_meeting(meeting_id)
    if str(meeting["organizer_id"]) != str(profile["user_id"]) and not _is_meeting_admin(user):
        raise HTTPException(status_code=403, detail="Hanya organizer atau admin yang dapat mencatat kehadiran.")
    if payload.attendance_status not in {"pending", "attended", "absent"}:
        raise HTTPException(status_code=422, detail="Status kehadiran tidak valid.")
    result = (
        get_supabase()
        .table("meeting_participants")
        .update({"attendance_status": payload.attendance_status, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("meeting_id", str(meeting_id))
        .eq("user_id", str(participant_user_id))
        .select("user_id")
        .execute()
        .data
    )
    if not result:
        raise HTTPException(status_code=404, detail="Peserta meeting tidak ditemukan.")
    return get_meeting(meeting_id, user)


@router.get("/notifications")
def list_notifications(user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, Any]:
    profile = _profile_for_user(user)
    unread_count = (
        get_supabase()
        .table("notifications")
        .select("id", count="exact", head=True)
        .eq("user_id", str(profile["user_id"]))
        .is_("read_at", "null")
        .execute()
        .count
        or 0
    )
    rows = (
        get_supabase()
        .table("notifications")
        .select("id, meeting_id, title, message, notification_type, read_at, created_at")
        .eq("user_id", str(profile["user_id"]))
        .order("created_at", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )
    return {
        "unread_count": unread_count,
        "notifications": [{**row, "is_read": bool(row.get("read_at"))} for row in rows],
    }


@router.post("/notifications/read-all")
def mark_all_notifications_read(user: dict[str, Any] = Depends(require_authenticated_user)) -> dict[str, int]:
    profile = _profile_for_user(user)
    result = (
        get_supabase()
        .table("notifications")
        .update({"read_at": datetime.now(timezone.utc).isoformat()})
        .eq("user_id", str(profile["user_id"]))
        .is_("read_at", "null")
        .select("id")
        .execute()
        .data
        or []
    )
    return {"updated": len(result)}


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: UUID,
    user: dict[str, Any] = Depends(require_authenticated_user),
) -> dict[str, bool]:
    profile = _profile_for_user(user)
    result = (
        get_supabase()
        .table("notifications")
        .update({"read_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", str(notification_id))
        .eq("user_id", str(profile["user_id"]))
        .select("id")
        .execute()
        .data
    )
    if not result:
        raise HTTPException(status_code=404, detail="Notifikasi tidak ditemukan.")
    return {"read": True}


def process_due_meeting_reminders() -> int:
    result = get_supabase().rpc("process_due_meeting_reminders").execute()
    return int(result.data or 0)
