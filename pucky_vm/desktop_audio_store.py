from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import quote


SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
MAX_TRACKS_PER_BUNDLE = 4


@dataclass
class DesktopAudioError(ValueError):
    error: str
    status: HTTPStatus = HTTPStatus.BAD_REQUEST

    def __str__(self) -> str:
        return self.error


class DesktopAudioStore:
    def __init__(self, root: Path, *, max_track_bytes: int) -> None:
        self.root = root
        self.max_track_bytes = max(1, int(max_track_bytes))

    def init_bundle(self, payload: dict[str, object], *, base_url: str = "") -> dict[str, object]:
        manifest = self._manifest_from_payload(payload)
        bundle_id = str(manifest["bundle_id"])
        bundle_dir = self._bundle_dir(bundle_id)
        manifest_path = bundle_dir / "manifest.json"
        bundle_dir.mkdir(parents=True, exist_ok=True)
        if manifest_path.exists():
            existing = self._read_manifest(bundle_id)
            if self._expected_manifest(existing) != self._expected_manifest(manifest):
                raise DesktopAudioError("bundle_manifest_conflict", HTTPStatus.CONFLICT)
            manifest = existing
        else:
            self._write_manifest(bundle_id, manifest)
        return self._init_response(manifest, base_url=base_url)

    def upload_track(
        self,
        bundle_id: str,
        track_id: str,
        body: bytes,
        *,
        content_type: str,
        content_sha256: str,
    ) -> dict[str, object]:
        bundle_id = self._require_safe_id(bundle_id, "bundle_id")
        track_id = self._require_safe_id(track_id, "track_id")
        manifest = self._read_manifest(bundle_id)
        track = self._track(manifest, track_id)
        expected_sha = str(track["sha256"])
        expected_bytes = int(track["bytes"])
        actual_sha = hashlib.sha256(body).hexdigest()
        if str(content_sha256 or "").strip().lower() not in {"", expected_sha}:
            raise DesktopAudioError("track_header_sha256_mismatch")
        if len(body) != expected_bytes:
            raise DesktopAudioError("track_bytes_mismatch")
        if actual_sha != expected_sha:
            raise DesktopAudioError("track_sha256_mismatch")
        if len(body) > self.max_track_bytes:
            raise DesktopAudioError("track_too_large")

        target = self._track_path(bundle_id, track_id)
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(body)
        tmp.replace(target)
        now = self._now()
        track["uploaded"] = True
        track["uploaded_at"] = now
        track["stored_bytes"] = len(body)
        track["stored_sha256"] = actual_sha
        track["content_type"] = str(content_type or track.get("mime_type") or "application/octet-stream")
        manifest["state"] = "uploaded" if self._all_tracks_uploaded(manifest) else "partial"
        manifest["updated_at"] = now
        self._write_manifest(bundle_id, manifest)
        return {
            "schema": "pucky.desktop_audio_track_upload.v1",
            "ok": True,
            "bundle_id": bundle_id,
            "track_id": track_id,
            "state": "uploaded",
            "bytes": len(body),
            "sha256": actual_sha,
        }

    def complete_bundle(self, bundle_id: str) -> dict[str, object]:
        bundle_id = self._require_safe_id(bundle_id, "bundle_id")
        manifest = self._read_manifest(bundle_id)
        missing = [str(track["track_id"]) for track in manifest["tracks"] if not bool(track.get("uploaded"))]
        if missing:
            raise DesktopAudioError("bundle_tracks_missing", HTTPStatus.CONFLICT)
        now = self._now()
        manifest["state"] = "complete"
        manifest["completed_at"] = now
        manifest["updated_at"] = now
        self._write_manifest(bundle_id, manifest)
        return {
            "schema": "pucky.desktop_audio_bundle_complete.v1",
            "ok": True,
            "bundle_id": bundle_id,
            "state": "complete",
            "bundle": self._public_bundle(manifest),
        }

    def bundle_detail(self, bundle_id: str) -> dict[str, object]:
        bundle_id = self._require_safe_id(bundle_id, "bundle_id")
        manifest = self._read_manifest(bundle_id)
        return {
            "schema": "pucky.desktop_audio_bundle.v1",
            "ok": True,
            "bundle": self._public_bundle(manifest),
        }

    def track_bytes(self, bundle_id: str, track_id: str) -> tuple[bytes, str, str]:
        bundle_id = self._require_safe_id(bundle_id, "bundle_id")
        track_id = self._require_safe_id(track_id, "track_id")
        manifest = self._read_manifest(bundle_id)
        track = self._track(manifest, track_id)
        if not bool(track.get("uploaded")):
            raise DesktopAudioError("track_not_uploaded", HTTPStatus.NOT_FOUND)
        path = self._track_path(bundle_id, track_id)
        if not path.exists():
            raise DesktopAudioError("track_not_found", HTTPStatus.NOT_FOUND)
        return path.read_bytes(), str(track.get("mime_type") or "application/octet-stream"), f"{bundle_id}-{track_id}.audio"

    def _manifest_from_payload(self, payload: dict[str, object]) -> dict[str, object]:
        bundle_id = self._require_safe_id(str(payload.get("bundle_id") or ""), "bundle_id")
        raw_tracks = payload.get("tracks")
        if not isinstance(raw_tracks, list) or not raw_tracks:
            raise DesktopAudioError("tracks_required")
        if len(raw_tracks) > MAX_TRACKS_PER_BUNDLE:
            raise DesktopAudioError("too_many_tracks")
        tracks: list[dict[str, object]] = []
        seen: set[str] = set()
        for item in raw_tracks:
            if not isinstance(item, dict):
                raise DesktopAudioError("track_must_be_object")
            track_id = self._require_safe_id(str(item.get("track_id") or ""), "track_id")
            if track_id in seen:
                raise DesktopAudioError("duplicate_track_id")
            seen.add(track_id)
            sha = str(item.get("sha256") or "").strip().lower()
            if not SHA256_RE.match(sha):
                raise DesktopAudioError("invalid_track_sha256")
            try:
                byte_count = int(item.get("bytes") or 0)
            except (TypeError, ValueError):
                raise DesktopAudioError("invalid_track_bytes") from None
            if byte_count <= 0:
                raise DesktopAudioError("invalid_track_bytes")
            if byte_count > self.max_track_bytes:
                raise DesktopAudioError("track_too_large")
            mime_type = str(item.get("mime_type") or "application/octet-stream").strip() or "application/octet-stream"
            tracks.append(
                {
                    "track_id": track_id,
                    "kind": str(item.get("kind") or track_id).strip() or track_id,
                    "mime_type": mime_type,
                    "bytes": byte_count,
                    "sha256": sha,
                    "uploaded": False,
                    "uploaded_at": "",
                    "stored_bytes": 0,
                    "stored_sha256": "",
                    "content_type": "",
                }
            )
        now = self._now()
        return {
            "schema": "pucky.desktop_audio_bundle_manifest.v1",
            "bundle_id": bundle_id,
            "device_id": str(payload.get("device_id") or "").strip(),
            "platform": str(payload.get("platform") or "").strip(),
            "started_at": str(payload.get("started_at") or "").strip(),
            "ended_at": str(payload.get("ended_at") or "").strip(),
            "created_at": now,
            "updated_at": now,
            "completed_at": "",
            "state": "initialized",
            "tracks": tracks,
        }

    def _init_response(self, manifest: dict[str, object], *, base_url: str = "") -> dict[str, object]:
        bundle_id = str(manifest["bundle_id"])
        uploads = []
        for track in manifest["tracks"]:
            track_id = str(track["track_id"])
            uploads.append(
                {
                    "track_id": track_id,
                    "upload_url": f"/api/desktop-audio/v1/bundles/{quote(bundle_id, safe='')}/tracks/{quote(track_id, safe='')}",
                    "method": "PUT",
                    "bytes": int(track["bytes"]),
                    "sha256": str(track["sha256"]),
                }
            )
        complete_url = f"/api/desktop-audio/v1/bundles/{quote(bundle_id, safe='')}/complete"
        if base_url:
            base = base_url.rstrip("/")
            for item in uploads:
                item["absolute_upload_url"] = base + str(item["upload_url"])
            absolute_complete_url = base + complete_url
        else:
            absolute_complete_url = ""
        return {
            "schema": "pucky.desktop_audio_bundle_init.v1",
            "ok": True,
            "bundle_id": bundle_id,
            "state": str(manifest.get("state") or "initialized"),
            "uploads": uploads,
            "complete_url": complete_url,
            "absolute_complete_url": absolute_complete_url,
        }

    def _public_bundle(self, manifest: dict[str, object]) -> dict[str, object]:
        return {
            "bundle_id": str(manifest["bundle_id"]),
            "device_id": str(manifest.get("device_id") or ""),
            "platform": str(manifest.get("platform") or ""),
            "started_at": str(manifest.get("started_at") or ""),
            "ended_at": str(manifest.get("ended_at") or ""),
            "created_at": str(manifest.get("created_at") or ""),
            "updated_at": str(manifest.get("updated_at") or ""),
            "completed_at": str(manifest.get("completed_at") or ""),
            "state": str(manifest.get("state") or ""),
            "tracks": [
                {
                    "track_id": str(track["track_id"]),
                    "kind": str(track.get("kind") or ""),
                    "mime_type": str(track.get("mime_type") or ""),
                    "bytes": int(track.get("bytes") or 0),
                    "sha256": str(track.get("sha256") or ""),
                    "uploaded": bool(track.get("uploaded")),
                    "uploaded_at": str(track.get("uploaded_at") or ""),
                    "stored_bytes": int(track.get("stored_bytes") or 0),
                    "stored_sha256": str(track.get("stored_sha256") or ""),
                }
                for track in manifest["tracks"]
            ],
        }

    def _expected_manifest(self, manifest: dict[str, object]) -> dict[str, object]:
        return {
            "bundle_id": str(manifest["bundle_id"]),
            "device_id": str(manifest.get("device_id") or ""),
            "platform": str(manifest.get("platform") or ""),
            "started_at": str(manifest.get("started_at") or ""),
            "ended_at": str(manifest.get("ended_at") or ""),
            "tracks": [
                {
                    "track_id": str(track["track_id"]),
                    "kind": str(track.get("kind") or ""),
                    "mime_type": str(track.get("mime_type") or ""),
                    "bytes": int(track.get("bytes") or 0),
                    "sha256": str(track.get("sha256") or ""),
                }
                for track in manifest["tracks"]
            ],
        }

    def _track(self, manifest: dict[str, object], track_id: str) -> dict[str, object]:
        for track in manifest["tracks"]:
            if str(track.get("track_id") or "") == track_id:
                return track
        raise DesktopAudioError("track_not_found", HTTPStatus.NOT_FOUND)

    def _all_tracks_uploaded(self, manifest: dict[str, object]) -> bool:
        return all(bool(track.get("uploaded")) for track in manifest["tracks"])

    def _read_manifest(self, bundle_id: str) -> dict[str, object]:
        path = self._bundle_dir(bundle_id) / "manifest.json"
        if not path.exists():
            raise DesktopAudioError("bundle_not_found", HTTPStatus.NOT_FOUND)
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise DesktopAudioError("bundle_manifest_invalid", HTTPStatus.INTERNAL_SERVER_ERROR)
        return payload

    def _write_manifest(self, bundle_id: str, manifest: dict[str, object]) -> None:
        bundle_dir = self._bundle_dir(bundle_id)
        bundle_dir.mkdir(parents=True, exist_ok=True)
        path = bundle_dir / "manifest.json"
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        tmp.replace(path)

    def _bundle_dir(self, bundle_id: str) -> Path:
        bundle_id = self._require_safe_id(bundle_id, "bundle_id")
        return self.root / bundle_id

    def _track_path(self, bundle_id: str, track_id: str) -> Path:
        return self._bundle_dir(bundle_id) / f"{self._require_safe_id(track_id, 'track_id')}.audio"

    def _require_safe_id(self, value: str, field: str) -> str:
        clean = str(value or "").strip()
        if not clean:
            raise DesktopAudioError(f"{field}_required")
        if not SAFE_ID_RE.match(clean) or "/" in clean or "\\" in clean or ".." in clean:
            raise DesktopAudioError(f"invalid_{field}")
        return clean

    def _now(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
