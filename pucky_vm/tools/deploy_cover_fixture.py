from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin
from urllib.request import urlopen


DEFAULT_VM_BASE_URL = "https://pucky.fly.dev"
DEFAULT_BUNDLE_PATH = "/ui/pucky/latest/bundle.zip"
DEFAULT_MANIFEST_PATH = "/ui/pucky/latest/manifest.json"
DEFAULT_ARTIFACT_BASE_PATH = "/ui/pucky/latest/"
BAD_DEVICE_STRINGS = ("/mock/", "\\mock\\", ".tmp", "Trace UI fixture")
FORBIDDEN_MANIFEST_FIELDS = ("audio_path", "html_path")
PUBLIC_AUDIOBOOK_PREFIXES = (
    "/sdcard/Podcasts/From_Pocket_Computers_to_Planetary_Platforms/",
    "/mnt/sdcard/Podcasts/From_Pocket_Computers_to_Planetary_Platforms/",
    "/storage/emulated/0/Podcasts/From_Pocket_Computers_to_Planetary_Platforms/",
)
DEVICE_AUDIOBOOK_PREFIXES = (
    "/sdcard/Android/data/com.pucky.device.debug/files/audiobooks/",
    "/mnt/sdcard/Android/data/com.pucky.device.debug/files/audiobooks/",
    "/storage/emulated/0/Android/data/com.pucky.device.debug/files/audiobooks/",
)
DEVICE_AUDIO_EXTENSIONS = (".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav")


class DeployError(RuntimeError):
    pass


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def utc_stamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_clean_git(root: Path) -> None:
    result = subprocess.run(
        ["git", "status", "--short"],
        cwd=root,
        text=True,
        capture_output=True,
        check=True,
    )
    if result.stdout.strip():
        raise DeployError("Refusing to deploy cover fixtures from a dirty git workspace.")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def nested_contains(value: Any, needles: tuple[str, ...]) -> bool:
    if isinstance(value, str):
        return any(needle in value for needle in needles)
    if isinstance(value, dict):
        return any(nested_contains(item, needles) for item in value.values())
    if isinstance(value, list):
        return any(nested_contains(item, needles) for item in value)
    return False


def artifact_url(vm_base_url: str, artifact_base_path: str, artifact_base: str, name: str) -> str:
    relative = "/".join(part.strip("/") for part in (artifact_base_path, artifact_base, name) if part)
    return urljoin(vm_base_url.rstrip("/") + "/", quote(relative, safe="/"))


def puckyctl_args(args: argparse.Namespace, command_type: str, payload: dict[str, Any]) -> list[str]:
    argv = [sys.executable, str(args.puckyctl), "--json"]
    if args.broker:
        argv += ["--broker", args.broker]
    if args.token:
        argv += ["--token", args.token]
    if args.device_id:
        argv += ["--device-id", args.device_id]
    argv += ["command", "send", command_type, "--args-json", json.dumps(payload, separators=(",", ":")), "--wait"]
    return argv


def run_pucky_command(args: argparse.Namespace, command_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    completed = subprocess.run(
        puckyctl_args(args, command_type, payload),
        cwd=args.repo_root,
        text=True,
        capture_output=True,
        timeout=args.command_timeout_seconds,
    )
    combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise DeployError(f"Unable to parse puckyctl JSON for {command_type}: {combined}") from exc
    if completed.returncode != 0 or not parsed.get("ok"):
        raise DeployError(f"Command {command_type} failed: {combined}")
    result = parsed.get("result")
    return result if isinstance(result, dict) else {}


def download_artifact(
    args: argparse.Namespace,
    *,
    artifact_name: str,
    artifact_base: str,
    filename_prefix: str,
) -> dict[str, Any]:
    url = artifact_url(args.vm_base_url, args.artifact_base_path, artifact_base, artifact_name)
    filename = f"{filename_prefix}_{Path(artifact_name).name}"
    return run_pucky_command(
        args,
        "file.download",
        {"url": url, "filename": filename, "max_bytes": args.max_artifact_bytes},
    )


def app_owned_path(download: dict[str, Any], artifact_name: str) -> str:
    path = str(download.get("path") or download.get("device_path") or "")
    if not path:
        raise DeployError(f"file.download did not return a path for {artifact_name}")
    return path


def download_images(
    args: argparse.Namespace,
    *,
    images: list[dict[str, Any]],
    artifact_base: str,
    filename_prefix: str,
    downloads: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    downloaded_images: list[dict[str, Any]] = []
    for index, image in enumerate(images or []):
        image_copy = dict(image)
        image_artifact = image_copy.pop("artifact", "")
        if not image_artifact:
            continue
        downloaded = download_artifact(
            args,
            artifact_name=image_artifact,
            artifact_base=artifact_base,
            filename_prefix=f"{filename_prefix}_image_{index + 1}",
        )
        downloads.append({"field": "images", "artifact": image_artifact, "download": downloaded})
        image_copy["path"] = app_owned_path(downloaded, image_artifact)
        viewer_artifact = str(
            image_copy.get("viewer_artifact")
            or image_copy.get("html_artifact")
            or image_copy.get("document_html_artifact")
            or ""
        ).strip()
        if viewer_artifact:
            viewer_download = download_artifact(
                args,
                artifact_name=viewer_artifact,
                artifact_base=artifact_base,
                filename_prefix=f"{filename_prefix}_image_{index + 1}_viewer",
            )
            downloads.append({"field": "viewer_path", "artifact": viewer_artifact, "download": viewer_download})
            image_copy["viewer_path"] = app_owned_path(viewer_download, viewer_artifact)
        downloaded_images.append(image_copy)
    return downloaded_images


def validate_public_audiobook_path(path: str, *, field: str) -> str:
    value = str(path or "").strip().replace("\\", "/")
    if not value:
        return ""
    if not any(value.startswith(prefix) for prefix in PUBLIC_AUDIOBOOK_PREFIXES):
        raise DeployError(f"{field} must stay inside the approved public audiobook directory.")
    if field == "public_audio_playlist_path" and not value.lower().endswith(".m3u"):
        raise DeployError("public_audio_playlist_path must point at an .m3u playlist.")
    if field == "public_audio_path" and not value.lower().endswith(".wav"):
        raise DeployError("public_audio_path must point at a .wav audiobook track.")
    return value


def validate_device_audio_path(path: str, *, field: str = "device_audio_path") -> str:
    value = str(path or "").strip().replace("\\", "/")
    if not value:
        return ""
    if any(needle in value for needle in BAD_DEVICE_STRINGS):
        raise DeployError(f"{field} must not use mock, temp, or fixture-only paths.")
    if not any(value.startswith(prefix) for prefix in DEVICE_AUDIOBOOK_PREFIXES):
        raise DeployError(f"{field} must stay inside the approved app audiobook directory.")
    if not value.lower().endswith(DEVICE_AUDIO_EXTENSIONS):
        raise DeployError(f"{field} must point at an audio file.")
    return value


def build_cards(args: argparse.Namespace, spec: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    artifact_base = str(spec.get("artifact_base_path") or "fixtures/artifacts").strip("/")
    cards: list[dict[str, Any]] = []
    downloads: list[dict[str, Any]] = []
    for raw_card in spec.get("cards", []):
        card = dict(raw_card)
        for field in FORBIDDEN_MANIFEST_FIELDS:
            if field in card:
                raise DeployError(f"Fixture deploy manifest must not contain {field}; use repo artifacts instead.")
        session_id = str(card.get("session_id") or card.get("title") or "fixture")
        prefix = "pucky_fixture_" + "".join(ch if ch.isalnum() else "_" for ch in session_id)
        audio_artifact = card.pop("audio_artifact", "")
        html_artifact = card.pop("html_artifact", "")
        device_audio_path = card.pop("device_audio_path", "")
        public_audio_path = card.pop("public_audio_path", "")
        public_audio_playlist_path = card.pop("public_audio_playlist_path", "")
        if session_id == "fixture_book" and audio_artifact:
            raise DeployError("fixture_book must use the real audiobook path, not an audio artifact.")
        if device_audio_path and (audio_artifact or public_audio_path or public_audio_playlist_path):
            raise DeployError("device_audio_path cannot be combined with another audio source.")
        if device_audio_path:
            card["audio_path"] = validate_device_audio_path(device_audio_path)
        if public_audio_path:
            card["audio_path"] = validate_public_audiobook_path(public_audio_path, field="public_audio_path")
        if public_audio_playlist_path:
            card["audio_playlist_path"] = validate_public_audiobook_path(
                public_audio_playlist_path,
                field="public_audio_playlist_path",
            )
        if audio_artifact:
            downloaded = download_artifact(args, artifact_name=audio_artifact, artifact_base=artifact_base, filename_prefix=prefix)
            downloads.append({"field": "audio_path", "artifact": audio_artifact, "download": downloaded})
            card["audio_path"] = app_owned_path(downloaded, audio_artifact)
        if html_artifact:
            downloaded = download_artifact(args, artifact_name=html_artifact, artifact_base=artifact_base, filename_prefix=prefix)
            downloads.append({"field": "html_path", "artifact": html_artifact, "download": downloaded})
            card["html_path"] = app_owned_path(downloaded, html_artifact)
        images = download_images(
            args,
            images=card.get("images") or [],
            artifact_base=artifact_base,
            filename_prefix=prefix,
            downloads=downloads,
        )
        if images:
            card["images"] = images
        else:
            card.pop("images", None)
        messages = []
        for message_index, message in enumerate(card.get("transcript_messages") or []):
            message_copy = dict(message)
            message_images = download_images(
                args,
                images=message_copy.get("images") or [],
                artifact_base=artifact_base,
                filename_prefix=f"{prefix}_message_{message_index + 1}",
                downloads=downloads,
            )
            if message_images:
                message_copy["images"] = message_images
            else:
                message_copy.pop("images", None)
            messages.append(message_copy)
        if messages:
            card["transcript_messages"] = messages
        cards.append(card)
    if nested_contains(cards, BAD_DEVICE_STRINGS):
        raise DeployError("Final card payload contains mock, temp, or fixture-only strings.")
    return cards, downloads


def artifact_names(spec: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for card in spec.get("cards", []):
        for field in ("audio_artifact", "html_artifact"):
            value = str(card.get(field) or "").strip()
            if value:
                names.append(value)
        for image in card.get("images") or []:
            for field in ("artifact", "preview_artifact", "viewer_artifact", "html_artifact", "document_html_artifact"):
                value = str(image.get(field) or "").strip()
                if value:
                    names.append(value)
        for message in card.get("transcript_messages") or []:
            for image in message.get("images") or []:
                for field in ("artifact", "preview_artifact", "viewer_artifact", "html_artifact", "document_html_artifact"):
                    value = str(image.get(field) or "").strip()
                    if value:
                        names.append(value)
    return sorted(set(names))


def delete_stale_mock_artifacts(args: argparse.Namespace) -> list[dict[str, Any]]:
    before = run_pucky_command(args, "artifact.list", {})
    deleted: list[dict[str, Any]] = []
    for artifact in before.get("artifacts") or []:
        path = str(artifact.get("path") or artifact.get("device_path") or "")
        normalized = path.replace("\\", "/")
        if "/files/mock/" not in normalized:
            continue
        result = run_pucky_command(args, "artifact.delete", {"path": path})
        deleted.append({"path": path, "result": result})
    return deleted


def deploy(args: argparse.Namespace) -> dict[str, Any]:
    ensure_clean_git(args.repo_root)
    spec = load_json(args.cards_manifest)
    if spec.get("schema") != "pucky.reply_cards_deploy.v1":
        raise DeployError("Fixture deploy manifest must use schema pucky.reply_cards_deploy.v1")

    remote_manifest = fetch_json(args.manifest_url)
    expected_files = remote_manifest.get("files") or {}
    required_files = ["fixtures/reply_cards_deploy.json"]
    artifact_base = str(spec.get("artifact_base_path") or "fixtures/artifacts").strip("/")
    required_files.extend(f"{artifact_base}/{name}" for name in artifact_names(spec))
    for required in required_files:
        if required not in expected_files:
            raise DeployError(f"Remote UI manifest is missing {required}")

    stale_deleted = delete_stale_mock_artifacts(args)
    bundle_install = run_pucky_command(args, "ui.bundle.refresh", {"url": args.bundle_url, "max_bytes": args.max_bundle_bytes})
    shell_mode = run_pucky_command(args, "ui.shell.mode.set", {"mode": "web_cached"})
    cards, downloads = build_cards(args, spec)
    cards_result = run_pucky_command(args, "ui.reply_cards.set", {"cards": cards})
    bundle_status = run_pucky_command(args, "ui.bundle.status", {})
    cards_snapshot = run_pucky_command(args, "ui.reply_cards.get", {})
    artifacts_after = run_pucky_command(args, "artifact.list", {})

    evidence = {
        "schema": "pucky.cover_fixture_deploy.v1",
        "created_at": utc_stamp(),
        "vm_base_url": args.vm_base_url,
        "bundle_url": args.bundle_url,
        "manifest_url": args.manifest_url,
        "remote_manifest": remote_manifest,
        "stale_deleted": stale_deleted,
        "bundle_install": bundle_install,
        "shell_mode": shell_mode,
        "downloads": downloads,
        "reply_cards_set": cards_result,
        "bundle_status": bundle_status,
        "reply_cards_get": cards_snapshot,
        "artifact_list_after": artifacts_after,
    }
    if nested_contains(cards_snapshot, BAD_DEVICE_STRINGS):
        raise DeployError("Device reply card snapshot still contains mock, temp, or fixture-only strings.")
    return evidence


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = repo_root()
    parser = argparse.ArgumentParser(description="Deploy repo-owned Pucky cover UI fixtures through normal commands.")
    parser.add_argument("--repo-root", type=Path, default=root)
    parser.add_argument("--cards-manifest", type=Path, default=root / "pucky_vm" / "ui_src" / "fixtures" / "reply_cards_deploy.json")
    parser.add_argument("--puckyctl", type=Path, default=root / "pucky-apk" / "puckyctl" / "puckyctl.py")
    parser.add_argument("--vm-base-url", default=DEFAULT_VM_BASE_URL)
    parser.add_argument("--bundle-url", default="")
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--artifact-base-path", default=DEFAULT_ARTIFACT_BASE_PATH)
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_URL", "https://pucky-bridge-dev-jt323.fly.dev"))
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
    parser.add_argument("--device-id", default=os.environ.get("PUCKY_DEVICE_ID", ""))
    parser.add_argument("--max-bundle-bytes", type=int, default=10 * 1024 * 1024)
    parser.add_argument("--max-artifact-bytes", type=int, default=2 * 1024 * 1024)
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--evidence-dir", type=Path, default=root / ".tmp" / "pucky-cover-fixture-deploy")
    args = parser.parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.cards_manifest = args.cards_manifest.resolve()
    args.puckyctl = args.puckyctl.resolve()
    args.vm_base_url = args.vm_base_url.rstrip("/")
    args.bundle_url = args.bundle_url or urljoin(args.vm_base_url + "/", DEFAULT_BUNDLE_PATH.lstrip("/"))
    args.manifest_url = args.manifest_url or urljoin(args.vm_base_url + "/", DEFAULT_MANIFEST_PATH.lstrip("/"))
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        evidence = deploy(args)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    path = args.evidence_dir / f"cover-fixture-deploy-{int(time.time())}.json"
    path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "evidence_path": str(path), "ui_version": evidence.get("bundle_status", {}).get("ui_version", "")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
