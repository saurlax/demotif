"""Durable audio provider contracts. Only this boundary handles remote URLs."""

import asyncio
import ipaddress
import json
import shutil
import socket
import ssl
from http.client import HTTPSConnection
from typing import Literal
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.config import get_settings
from app.core.errors import ApiError


class AudioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mode: Literal["music", "speech", "sound", "separate", "transcribe"]
    name: str = Field(default="New audio", min_length=1, max_length=80)
    prompt: str = Field(default="", max_length=1000)
    duration_seconds: float = Field(default=30, ge=0, le=60)
    lyrics: str = Field(default="", max_length=2000)
    instrumental: bool = True
    vocal_only: bool = False
    exclude: str = Field(default="", max_length=1000)
    voice: str = Field(default="", max_length=80)
    speech_model: Literal["", "eleven_v3"] = ""
    source_id: str | None = None
    take: int = Field(default=1, ge=1, le=1000)
    analysis_mode: Literal["pitched", "percussion"] = "pitched"
    min_pitch: int = Field(default=28, ge=21, le=107)
    max_pitch: int = Field(default=84, ge=22, le=108)
    drum_pitch: int = Field(default=42, ge=0, le=127)

    @model_validator(mode="after")
    def validate_request(self):
        if self.mode in ("separate", "transcribe"):
            if not self.source_id:
                raise ValueError("Select a source first")
            if self.min_pitch >= self.max_pitch:
                raise ValueError("Invalid pitch range")
        else:
            if not self.prompt.strip():
                raise ValueError("A prompt is required")
            if self.mode == "music" and (
                not 10 <= self.duration_seconds <= 60 or not self.duration_seconds.is_integer()
            ):
                raise ValueError("Music duration must be 10–60 whole seconds")
            if self.mode == "sound" and not 0.5 <= self.duration_seconds <= 15:
                raise ValueError("Sound effects must be 0.5–15 seconds")
            if self.mode == "music" and not self.instrumental and not self.lyrics.strip():
                raise ValueError("Provide lyrics for vocals")
            if self.vocal_only and (self.mode != "music" or self.instrumental):
                raise ValueError("Vocal-only generation requires vocal music")
        return self

    def payload(self) -> tuple[str, dict]:
        if self.mode == "speech":
            return (
                "cloudsway-elevenlabs-tts" if self.speech_model else "302ai-elevenlabs-tts",
                {
                    "prompt": self.prompt,
                    "gen_type": "audio",
                    "audio_option": {
                        "type": "txt_2_speech",
                        "format": "mp3",
                        "voice": self.voice or "21m00Tcm4TlvDq8ikWAM",
                    },
                },
            )
        if self.mode == "sound":
            return "302ai-elevenlabs-sound-effects-v2", {
                "prompt": self.prompt,
                "gen_type": "audio",
                "audio_option": {
                    "type": "txt_2_sound_effect",
                    "format": "mp3",
                    "duration": round(self.duration_seconds * 1000),
                },
            }
        tags = self.prompt
        exclude = self.exclude
        if self.vocal_only:
            tags = "solo unaccompanied vocal, a cappella, voice only; " + tags
            exclude = "drums, percussion, piano, guitar, bass, synthesizer, pads, strings; " + exclude
        options = {
            "custom_mode": True,
            "make_instrumental": self.instrumental,
            "tags": tags,
            "title": self.name,
            "duration": round(self.duration_seconds * 1000),
        }
        if self.lyrics:
            options["lyrics"] = self.lyrics
        if exclude:
            options["negative_tags"] = exclude
        return "ttapi-suno-v6", {"prompt": self.prompt, "gen_type": "music", "music_option": options}


def available() -> bool:
    s = get_settings()
    return bool(
        s.audio_base_url and s.audio_api_key and s.audio_biz_id and shutil.which("ffmpeg") and shutil.which("ffprobe")
    )


def validate_url(url: str) -> str:
    u = urlsplit(url)
    if u.scheme != "https" or not u.hostname or u.username or u.password or u.port not in (None, 443):
        raise ValueError("Invalid media URL")
    addresses = socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("Media must use a public address")
    return addresses[0][4][0]


class PinnedHTTPS(HTTPSConnection):
    def connect(self):
        ip = validate_url(f"https://{self.host}")
        raw = socket.create_connection((ip, 443), timeout=self.timeout)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host)


class SafeHTTPS(HTTPSHandler):
    def https_open(self, req):
        return self.do_open(PinnedHTTPS, req)


class Redirects(HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str, path) -> None:
    validate_url(url)
    opener = build_opener(ProxyHandler({}), SafeHTTPS(), Redirects())
    with opener.open(Request(url), timeout=90) as response, path.open("wb") as target:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > 60 * 1024 * 1024:
                raise ValueError("Audio exceeds 60 MB")
            target.write(chunk)


async def gateway(path: str, body: dict | None = None) -> dict:
    s = get_settings()

    def request():
        from urllib.request import urlopen

        req = Request(
            s.audio_base_url.rstrip("/").removesuffix("/v1") + path,
            data=json.dumps(body).encode() if body else None,
            headers={"Content-Type": "application/json", **({"X-Token": s.audio_api_key} if body is None else {})},
            method="POST" if body else "GET",
        )
        with urlopen(req, timeout=65) as response:
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError("Provider response too large")
            result = json.loads(data)
        if result.get("base", {}).get("code", 0) or result.get("err_code", 0):
            raise ApiError(502, "audio_provider_failed", "Audio provider reported a failure")
        return result

    return await asyncio.to_thread(request)


async def submit(ability: str, payload: dict) -> dict:
    s = get_settings()
    return await gateway(
        "/v1/submit_async_atomic_process",
        {
            "ability_key": ability,
            "req_payload": json.dumps(payload),
            "token": s.audio_api_key,
            "biz_info": {"biz_id": s.audio_biz_id, "enter_from": "demotif"},
            "user_info": {"uid": 1},
        },
    )


async def poll(task_id: str) -> dict:
    result = await gateway("/v1/get_submit_result/" + quote(task_id, safe=""))
    if result.get("task_id") not in (None, "", task_id):
        raise ValueError("Provider task mismatch")
    return result
