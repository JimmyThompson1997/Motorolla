from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any


RUNTIME_SCHEMA = "pucky.reply_cards.v1"
DEPLOY_SCHEMA = "pucky.reply_cards_deploy.v1"
DEFAULT_MOCK_ARTIFACT_PREFIX = "/mock"
DEPLOY_ONLY_CARD_FIELDS = (
    "audio_artifact",
    "html_artifact",
    "device_audio_path",
    "public_audio_path",
    "public_audio_playlist_path",
)


def load_deploy_fixture(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != DEPLOY_SCHEMA:
        raise ValueError(f"{path} is not a {DEPLOY_SCHEMA} fixture manifest")
    return payload


def runtime_fixture_from_deploy(
    payload: dict[str, Any],
    *,
    mock_artifact_prefix: str = DEFAULT_MOCK_ARTIFACT_PREFIX,
) -> dict[str, Any]:
    cards = [
        runtime_card_from_deploy(card, mock_artifact_prefix=mock_artifact_prefix)
        for card in list(payload.get("cards") or [])
    ]
    return {
        "schema": RUNTIME_SCHEMA,
        "count": len(cards),
        "cards": cards,
    }


def runtime_fixture_text_from_deploy(
    path: Path,
    *,
    mock_artifact_prefix: str = DEFAULT_MOCK_ARTIFACT_PREFIX,
) -> str:
    payload = load_deploy_fixture(path)
    runtime = runtime_fixture_from_deploy(payload, mock_artifact_prefix=mock_artifact_prefix)
    return json.dumps(runtime, indent=2, sort_keys=False) + "\n"


def write_runtime_fixture(
    deploy_manifest_path: Path,
    runtime_manifest_path: Path,
    *,
    mock_artifact_prefix: str = DEFAULT_MOCK_ARTIFACT_PREFIX,
) -> None:
    runtime_manifest_path.write_text(
        runtime_fixture_text_from_deploy(
            deploy_manifest_path,
            mock_artifact_prefix=mock_artifact_prefix,
        ),
        encoding="utf-8",
    )


def runtime_card_from_deploy(
    raw_card: dict[str, Any],
    *,
    mock_artifact_prefix: str = DEFAULT_MOCK_ARTIFACT_PREFIX,
) -> dict[str, Any]:
    card = deepcopy(raw_card)
    audio_artifact = str(card.pop("audio_artifact", "") or "").strip()
    html_artifact = str(card.pop("html_artifact", "") or "").strip()
    device_audio_path = str(card.pop("device_audio_path", "") or "").strip()
    public_audio_path = str(card.pop("public_audio_path", "") or "").strip()
    public_audio_playlist_path = str(card.pop("public_audio_playlist_path", "") or "").strip()
    implied_audio_artifact = inferred_audio_artifact_name(
        card,
        html_artifact=html_artifact,
        device_audio_path=device_audio_path,
        public_audio_path=public_audio_path,
    )

    for field in DEPLOY_ONLY_CARD_FIELDS:
        card.pop(field, None)

    if audio_artifact:
        card["audio_path"] = artifact_mock_path(audio_artifact, mock_artifact_prefix)
    elif implied_audio_artifact:
        card["audio_path"] = artifact_mock_path(implied_audio_artifact, mock_artifact_prefix)
    elif device_audio_path:
        card["audio_path"] = device_audio_path
    elif public_audio_path:
        card["audio_path"] = public_audio_path

    if public_audio_playlist_path:
        card["audio_playlist_path"] = public_audio_playlist_path
    if html_artifact:
        card["html_path"] = artifact_mock_path(html_artifact, mock_artifact_prefix)

    if "attachments" in card:
        card["attachments"] = runtime_attachment_list(card.get("attachments"), mock_artifact_prefix=mock_artifact_prefix)
    if "images" in card:
        card["images"] = runtime_attachment_list(card.get("images"), mock_artifact_prefix=mock_artifact_prefix)

    messages = []
    for message in list(card.get("transcript_messages") or []):
        message_copy = deepcopy(message)
        if "attachments" in message_copy:
            message_copy["attachments"] = runtime_attachment_list(
                message_copy.get("attachments"),
                mock_artifact_prefix=mock_artifact_prefix,
            )
        if "images" in message_copy:
            message_copy["images"] = runtime_attachment_list(
                message_copy.get("images"),
                mock_artifact_prefix=mock_artifact_prefix,
            )
        messages.append(message_copy)
    if messages:
        card["transcript_messages"] = messages
    return card


def runtime_attachment_list(
    attachments: Any,
    *,
    mock_artifact_prefix: str = DEFAULT_MOCK_ARTIFACT_PREFIX,
) -> list[dict[str, Any]]:
    if not isinstance(attachments, list):
        return []
    return [
        runtime_attachment_from_deploy(item, mock_artifact_prefix=mock_artifact_prefix)
        for item in attachments
        if isinstance(item, dict)
    ]


def runtime_attachment_from_deploy(
    attachment: dict[str, Any],
    *,
    mock_artifact_prefix: str = DEFAULT_MOCK_ARTIFACT_PREFIX,
) -> dict[str, Any]:
    item = deepcopy(attachment)
    artifact = str(item.get("artifact") or "").strip()
    if artifact and not str(item.get("path") or "").strip():
        item["path"] = artifact_mock_path(artifact, mock_artifact_prefix)
    return item


def artifact_mock_path(artifact_name: str, mock_artifact_prefix: str = DEFAULT_MOCK_ARTIFACT_PREFIX) -> str:
    prefix = "/" + str(mock_artifact_prefix or DEFAULT_MOCK_ARTIFACT_PREFIX).strip("/")
    return f"{prefix}/{str(artifact_name).lstrip('/')}"


def inferred_audio_artifact_name(
    card: dict[str, Any],
    *,
    html_artifact: str,
    device_audio_path: str,
    public_audio_path: str,
) -> str:
    if not html_artifact:
        return ""
    if not (device_audio_path or public_audio_path):
        return ""
    artifact_stem = Path(html_artifact).stem
    if not artifact_stem:
        return ""
    if not list(card.get("audio_timestamps") or []):
        return ""
    return f"{artifact_stem}.wav"
