from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

from pucky_vm.tools import deploy_cover_fixture
from pucky_vm.ui_bundle import build_ui_bundle


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "pucky_vm" / "ui_src" / "fixtures"
ARTIFACTS = FIXTURES / "artifacts"


def test_deploy_manifest_uses_repo_artifacts_not_device_paths() -> None:
    spec = json.loads((FIXTURES / "reply_cards_deploy.json").read_text(encoding="utf-8"))
    encoded = json.dumps(spec)

    assert spec["schema"] == "pucky.reply_cards_deploy.v1"
    assert "/mock/" not in encoded
    assert ".tmp" not in encoded
    assert "Trace UI fixture" not in encoded
    assert '"/data/user/0/' not in encoded
    assert '"audio_path"' not in encoded
    assert "html_path" not in encoded
    assert encoded.count("device_audio_path") == 1
    assert "public_audio_path" not in encoded
    assert "public_audio_playlist_path" not in encoded

    artifacts = set()
    for card in spec["cards"]:
        if card["session_id"] == "fixture_book":
            assert "audio_artifact" not in card
            assert card["device_audio_path"].endswith("_Kokoro_George.m4a")
            assert "/Android/data/com.pucky.device.debug/files/audiobooks/" in card["device_audio_path"]
            assert "public_audio_path" not in card
            assert "public_audio_playlist_path" not in card
            assert len(card["audio_timestamps"]) == 31
            assert card["audio_timestamps"][0]["title"].startswith("Prologue")
            assert card["audio_timestamps"][-1]["kind"] == "postscript"
        else:
            artifacts.add(card["audio_artifact"])
        artifacts.add(card["html_artifact"])
        assert "images" not in card
        for message in card.get("transcript_messages", []):
            for image in message.get("images", []):
                artifacts.add(image["artifact"])
        assert card.get("trace", {}).get("schema") == "pucky.turn_trace.v1"

    for name in artifacts:
        path = ARTIFACTS / name
        assert path.exists(), name
        assert path.stat().st_size > 100
    assert (ARTIFACTS / "morning.wav").read_bytes().startswith(b"RIFF")
    assert deploy_cover_fixture.artifact_names(spec) == sorted(artifacts)


def test_bundle_contains_deploy_manifest_and_artifacts(tmp_path: Path) -> None:
    result = build_ui_bundle(tmp_path, ui_version="fixture-proof", created_at="2026-05-20T00:00:00+00:00")
    files = result["manifest"]["files"]

    assert "fixtures/reply_cards_deploy.json" in files
    assert "fixtures/artifacts/morning.wav" in files
    assert "fixtures/artifacts/morning.html" in files
    assert "fixtures/artifacts/morning-map.svg" in files


def test_deploy_helper_uses_command_path_and_no_adb_shortcuts() -> None:
    source = (ROOT / "pucky_vm" / "tools" / "deploy_cover_fixture.py").read_text(encoding="utf-8")

    assert "ui.bundle.refresh" in source
    assert "ui.shell.mode.set" in source
    assert "file.download" in source
    assert "ui.reply_cards.set" in source
    assert "artifact.list" in source
    assert "artifact.delete" in source
    assert '"git", "status", "--short"' in source
    assert "adb" not in source.lower()
    assert "run-as" not in source
    assert "shared_prefs" not in source


def test_build_cards_converts_artifacts_to_app_owned_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    def fake_command(args: argparse.Namespace, command_type: str, payload: dict) -> dict:
        calls.append((command_type, payload))
        assert command_type == "file.download"
        filename = payload["filename"]
        return {
            "schema": "pucky.file_download.v1",
            "path": f"/data/user/0/com.pucky.device.debug/files/downloads/{filename}",
            "device_path": f"/data/user/0/com.pucky.device.debug/files/downloads/{filename}",
            "mime_type": "application/octet-stream",
        }

    monkeypatch.setattr(deploy_cover_fixture, "run_pucky_command", fake_command)
    args = argparse.Namespace(
        vm_base_url="https://pucky.fly.dev",
        artifact_base_path="/ui/pucky/latest/",
        max_artifact_bytes=1024 * 1024,
    )
    spec = {
        "artifact_base_path": "fixtures/artifacts",
        "cards": [
            {
                "session_id": "fixture_morning",
                "title": "Morning launch",
                "audio_artifact": "morning.wav",
                "html_artifact": "morning.html",
                "transcript_messages": [
                    {
                        "role": "assistant",
                        "text": "Here is the route sketch.",
                        "images": [{"artifact": "morning-map.svg", "title": "Map"}],
                    }
                ],
                "trace": {"schema": "pucky.turn_trace.v1", "sections": []},
            }
        ],
    }

    cards, downloads = deploy_cover_fixture.build_cards(args, spec)

    assert len(calls) == 3
    assert len(downloads) == 3
    assert cards[0]["audio_path"].startswith("/data/user/0/")
    assert cards[0]["html_path"].startswith("/data/user/0/")
    assert "images" not in cards[0]
    assert cards[0]["transcript_messages"][0]["images"][0]["path"].startswith("/data/user/0/")
    assert not deploy_cover_fixture.nested_contains(cards, deploy_cover_fixture.BAD_DEVICE_STRINGS)


def test_build_cards_accepts_validated_device_audiobook_path() -> None:
    args = argparse.Namespace(
        vm_base_url="https://pucky.fly.dev",
        artifact_base_path="/ui/pucky/latest/",
        max_artifact_bytes=1024 * 1024,
    )

    cards, downloads = deploy_cover_fixture.build_cards(
        args,
        {
            "artifact_base_path": "fixtures/artifacts",
            "cards": [
                {
                    "session_id": "fixture_book",
                    "title": "Pocket Computers",
                    "device_audio_path": "/storage/emulated/0/Android/data/com.pucky.device.debug/files/audiobooks/From_Pocket_Computers_to_Planetary_Platforms_Kokoro_George.m4a",
                    "audio_timestamps": [{"id": "chapter-01", "title": "Prologue", "start_ms": 0}],
                }
            ],
        },
    )

    assert downloads == []
    assert cards[0]["audio_path"].startswith("/storage/emulated/0/Android/data/com.pucky.device.debug/files/audiobooks/")
    assert cards[0]["audio_path"].endswith(".m4a")
    assert "audio_playlist_path" not in cards[0]
    assert cards[0]["audio_timestamps"][0]["id"] == "chapter-01"

    with pytest.raises(deploy_cover_fixture.DeployError):
        deploy_cover_fixture.build_cards(
            args,
            {
                "artifact_base_path": "fixtures/artifacts",
                "cards": [
                    {
                        "session_id": "fixture_book",
                        "title": "Pocket Computers",
                        "device_audio_path": "/storage/emulated/0/Android/data/com.pucky.device.debug/files/audiobooks/book.tmp.wav",
                    }
                ],
            },
        )

    with pytest.raises(deploy_cover_fixture.DeployError):
        deploy_cover_fixture.build_cards(
            args,
            {
                "artifact_base_path": "fixtures/artifacts",
                "cards": [
                    {
                        "session_id": "fixture_book",
                        "title": "Pocket Computers",
                        "device_audio_path": "/mock/book.m4a",
                    }
                ],
            },
        )


def test_public_audiobook_playlist_support_stays_available() -> None:
    args = argparse.Namespace(
        vm_base_url="https://pucky.fly.dev",
        artifact_base_path="/ui/pucky/latest/",
        max_artifact_bytes=1024 * 1024,
    )

    cards, downloads = deploy_cover_fixture.build_cards(
        args,
        {
            "artifact_base_path": "fixtures/artifacts",
            "cards": [
                {
                    "session_id": "another_book",
                    "title": "Another Book",
                    "public_audio_path": "/sdcard/Podcasts/From_Pocket_Computers_to_Planetary_Platforms/001_01_Prologue_The_Phone_Before_the_Phone_full.wav",
                    "public_audio_playlist_path": "/sdcard/Podcasts/From_Pocket_Computers_to_Planetary_Platforms/From_Pocket_Computers_to_Planetary_Platforms.m3u",
                }
            ],
        },
    )

    assert downloads == []
    assert cards[0]["audio_path"].startswith("/sdcard/Podcasts/From_Pocket_Computers")
    assert cards[0]["audio_playlist_path"].endswith(".m3u")


def test_fixture_book_cannot_regress_to_tiny_audio_artifact() -> None:
    args = argparse.Namespace(
        vm_base_url="https://pucky.fly.dev",
        artifact_base_path="/ui/pucky/latest/",
        max_artifact_bytes=1024 * 1024,
    )

    with pytest.raises(deploy_cover_fixture.DeployError):
        deploy_cover_fixture.build_cards(
            args,
            {
                "artifact_base_path": "fixtures/artifacts",
                "cards": [
                    {
                        "session_id": "fixture_book",
                        "title": "Pocket Computers",
                        "audio_artifact": "pocket-computers.wav",
                    }
                ],
            },
        )


def test_build_cards_rejects_mock_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_command(args: argparse.Namespace, command_type: str, payload: dict) -> dict:
        return {"path": f"/mock/{payload['filename']}"}

    monkeypatch.setattr(deploy_cover_fixture, "run_pucky_command", fake_command)
    args = argparse.Namespace(
        vm_base_url="https://pucky.fly.dev",
        artifact_base_path="/ui/pucky/latest/",
        max_artifact_bytes=1024 * 1024,
    )

    with pytest.raises(deploy_cover_fixture.DeployError):
        deploy_cover_fixture.build_cards(
            args,
            {"artifact_base_path": "fixtures/artifacts", "cards": [{"session_id": "bad", "audio_artifact": "morning.wav"}]},
        )
