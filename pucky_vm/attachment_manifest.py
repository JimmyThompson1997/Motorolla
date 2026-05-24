from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any


KIND_BY_MIME = {
    "application/pdf": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "table",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
    "text/csv": "table",
    "text/tab-separated-values": "table",
    "text/html": "html",
    "application/xhtml+xml": "html",
    "text/plain": "text",
}


def normalize_attachments(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [normalize_attachment(item, index=index) for index, item in enumerate(items or []) if item]


def normalize_attachment(item: dict[str, Any], *, index: int = 0) -> dict[str, Any]:
    raw = dict(item)
    mime_type = media_mime(raw)
    kind = normalized_kind(raw, mime_type)
    title = str(raw.get("title") or original_name(raw) or kind.title() or "Attachment")
    attachment_id = str(raw.get("id") or raw.get("sha256") or raw.get("path") or raw.get("artifact") or f"attachment-{index}")

    normalized = dict(raw)
    normalized.update(
        {
            "id": attachment_id,
            "kind": kind,
            "title": title,
            "mime_type": mime_type,
            "status": str(raw.get("status") or "ready"),
            "original": original_descriptor(raw, mime_type),
            "preview": preview_descriptor(raw, kind, mime_type),
            "viewer": viewer_descriptor(raw, kind, mime_type),
        }
    )
    if raw.get("size_bytes") is not None:
        normalized["size_bytes"] = int(raw.get("size_bytes") or 0)
    if raw.get("created_at"):
        normalized["created_at"] = raw["created_at"]
    if raw.get("error_message"):
        normalized["error_message"] = raw["error_message"]
    return normalized


def media_mime(item: dict[str, Any]) -> str:
    declared = str(item.get("mime_type") or "").strip()
    if declared and declared != "application/octet-stream":
        return declared
    name = original_name(item)
    guessed, _ = mimetypes.guess_type(name)
    return guessed or declared or "application/octet-stream"


def normalized_kind(item: dict[str, Any], mime_type: str) -> str:
    explicit = str(item.get("kind") or "").strip().lower()
    if explicit in {"image", "video", "audio", "document", "table", "html", "text", "archive", "unknown"}:
        return explicit
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type in KIND_BY_MIME:
        return KIND_BY_MIME[mime_type]
    suffix = Path(original_name(item)).suffix.lower()
    if suffix in {".zip", ".rar", ".7z", ".tar", ".gz"}:
        return "archive"
    return "unknown"


def original_descriptor(item: dict[str, Any], mime_type: str) -> dict[str, Any]:
    original = dict(item.get("original") or {})
    original.setdefault("name", original_name(item))
    original.setdefault("mime_type", mime_type)
    for field in ("path", "artifact", "sha256", "url"):
        if item.get(field) and not original.get(field):
            original[field] = item[field]
    if item.get("size_bytes") is not None and "size_bytes" not in original:
        original["size_bytes"] = int(item.get("size_bytes") or 0)
    return {key: value for key, value in original.items() if value not in ("", None)}


def preview_descriptor(item: dict[str, Any], kind: str, mime_type: str) -> dict[str, Any]:
    if isinstance(item.get("preview"), dict):
        return dict(item["preview"])
    if item.get("preview_artifact") or item.get("preview_path") or item.get("preview_src"):
        return {
            "type": "image",
            "artifact": item.get("preview_artifact", ""),
            "path": item.get("preview_path", ""),
            "src": item.get("preview_src", ""),
        }
    if kind == "image":
        return media_source(item, type_="image")
    if kind == "video":
        return media_source(item, type_="video")
    if kind == "audio":
        return {"type": "icon", "icon": "mic", "label": "Audio"}
    if kind == "table":
        return {"type": "icon", "icon": "table", "label": table_label(mime_type)}
    if kind == "text":
        return {"type": "text", "text": str(item.get("text") or item.get("summary") or item.get("alt") or "")}
    if kind == "html":
        return {"type": "icon", "icon": "html", "label": "HTML"}
    if kind == "document":
        return {"type": "icon", "icon": "description", "label": document_label(mime_type)}
    return {"type": "icon", "icon": "attachment", "label": "File"}


def viewer_descriptor(item: dict[str, Any], kind: str, mime_type: str) -> dict[str, Any]:
    if isinstance(item.get("viewer"), dict):
        return dict(item["viewer"])
    if kind == "image":
        return {"type": "image_gallery", "images": [media_source(item, type_="image")]}
    if kind == "video":
        return {"type": "video_player", "sources": [media_source(item, type_=mime_type or "video/mp4")]}
    if kind == "audio":
        return {"type": "audio_player", "sources": [media_source(item, type_=mime_type)]}
    if kind == "html":
        return {**viewer_source(item), "type": "html_iframe"}
    if kind == "table":
        return {**viewer_source(item), "type": "table"}
    if kind == "text":
        return {**viewer_source(item), "type": "text"}
    if item.get("viewer_artifact") or item.get("viewer_path") or item.get("html_viewer_path") or item.get("document_html_path"):
        return {**viewer_source(item), "type": "document_html"}
    if kind == "document" and (item.get("preview_artifact") or item.get("preview_path")):
        return {"type": "document_pages", "page_count": item.get("page_count", 1), "first_page_image": preview_descriptor(item, kind, mime_type)}
    return {"type": "download_only", "reason": "No browser-safe preview derivative is available."}


def viewer_source(item: dict[str, Any]) -> dict[str, Any]:
    source: dict[str, Any] = {}
    for key in ("viewer_path", "html_viewer_path", "document_html_path", "viewer_src", "viewer_url", "viewer_artifact", "html_artifact", "document_html_artifact"):
        if item.get(key):
            source[key] = item[key]
    if not source:
        source.update(media_source(item, type_=str(item.get("mime_type") or "application/octet-stream")))
    return source


def media_source(item: dict[str, Any], *, type_: str) -> dict[str, Any]:
    source: dict[str, Any] = {"type": type_}
    for key in ("path", "artifact", "src", "data_url", "url"):
        if item.get(key):
            source[key] = item[key]
    return source


def original_name(item: dict[str, Any]) -> str:
    for key in ("name", "filename", "artifact", "path", "local_path", "image_path", "artifact_path", "src", "url"):
        value = str(item.get(key) or "").strip()
        if value:
            return value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
    return ""


def document_label(mime_type: str) -> str:
    if mime_type == "application/pdf":
        return "PDF"
    if mime_type.endswith("wordprocessingml.document"):
        return "DOCX"
    if mime_type.endswith("presentationml.presentation"):
        return "PPTX"
    return "DOC"


def table_label(mime_type: str) -> str:
    if mime_type.endswith("spreadsheetml.sheet"):
        return "XLSX"
    return "CSV"
