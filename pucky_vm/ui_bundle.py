from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from pucky_vm.cover_fixtures import write_runtime_fixture

UI_SRC = Path(__file__).with_name("ui_src")
UI_DIST = Path(__file__).with_name("ui_dist")
DEFAULT_CREATED_AT = os.environ.get("PUCKY_UI_CREATED_AT")
LINKS_CATALOG_PATH = Path("fixtures") / "links_catalog.json"


def default_version() -> str:
    explicit = os.environ.get("PUCKY_UI_VERSION", "").strip()
    if explicit:
        return explicit
    revision_file = UI_SRC.parent / ".pucky_ui_version"
    if revision_file.exists():
        revision = revision_file.read_text(encoding="utf-8").strip()
        if revision:
            return revision
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=UI_SRC.parent.parent,
            text=True,
            capture_output=True,
            check=True,
        )
        sha = result.stdout.strip()
        if sha:
            return "git-" + sha
    except Exception:
        pass
    return "dev"


def source_provenance(repo_root: Path | None = None) -> dict[str, object]:
    root = repo_root or UI_SRC.parent.parent
    fallback: dict[str, object] = {
        "source_commit_full": "",
        "source_commit_short": "",
        "source_branch": "",
        "source_dirty": True,
    }
    try:
        full = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()
        short = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()
        # Runtime artifacts such as feed DB files should not invalidate source provenance.
        dirty = bool(
            subprocess.run(
                ["git", "status", "--short", "--untracked-files=no"],
                cwd=root,
                text=True,
                capture_output=True,
                check=True,
            ).stdout.strip()
        )
        return {
            "source_commit_full": full,
            "source_commit_short": short,
            "source_branch": branch,
            "source_dirty": dirty,
        }
    except Exception:
        return fallback


def build_ui_bundle(
    output_dir: Path | None = None,
    *,
    ui_version: str | None = None,
    created_at: str | None = DEFAULT_CREATED_AT,
) -> dict[str, object]:
    output_dir = output_dir or UI_DIST
    output_dir.mkdir(parents=True, exist_ok=True)
    created_at = created_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    ui_version = ui_version or default_version()

    with TemporaryDirectory() as temp_name:
        staging = Path(temp_name) / "bundle"
        shutil.copytree(UI_SRC, staging)
        write_runtime_fixture(
            staging / "fixtures" / "reply_cards_deploy.json",
            staging / "fixtures" / "reply_cards.json",
        )
        write_bundle_config(staging)
        write_links_catalog_script(staging)
        manifest = manifest_for(
            staging,
            ui_version=ui_version,
            created_at=created_at,
            source=source_provenance(),
        )
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        zip_path = output_dir / "pucky-ui-latest.zip"
        write_deterministic_zip(staging, zip_path)
        manifest_path = output_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return {
            "manifest": manifest,
            "manifest_path": str(manifest_path),
            "bundle_path": str(zip_path),
            "bundle_sha256": sha256_file(zip_path),
            "bundle_bytes": zip_path.stat().st_size,
        }


def bundle_config_payload() -> dict[str, str]:
    return {}


def bundle_config_script() -> str:
    return "window.PUCKY_BUNDLE_CONFIG = " + json.dumps(bundle_config_payload(), separators=(",", ":")) + ";\n"


def write_bundle_config(root: Path) -> None:
    text = bundle_config_script()
    (root / "pucky-config.js").write_text(text, encoding="utf-8", newline="\n")


def read_links_catalog(root: Path) -> dict[str, object]:
    path = root / LINKS_CATALOG_PATH
    if not path.exists():
        return {
            "schema": "pucky.links_catalog_bundle.v1",
            "apps": [],
            "total": 0,
            "generated_at": "",
            "catalog_version": "",
        }
    return json.loads(path.read_text(encoding="utf-8"))


def links_catalog_script(payload: dict[str, object]) -> str:
    return "window.PUCKY_LINKS_CATALOG=" + json.dumps(payload, separators=(",", ":")) + ";\n"


def write_links_catalog_script(root: Path) -> None:
    payload = read_links_catalog(root)
    (root / "pucky-links-catalog.js").write_text(links_catalog_script(payload), encoding="utf-8", newline="\n")


def manifest_for(
    root: Path,
    *,
    ui_version: str,
    created_at: str,
    source: dict[str, object] | None = None,
) -> dict[str, object]:
    source = source or source_provenance()
    files: dict[str, dict[str, object]] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "manifest.json":
            continue
        relative = path.relative_to(root).as_posix()
        data = path.read_bytes()
        files[relative] = {
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    return {
        "schema": "pucky.ui_bundle.v1",
        "ui_version": ui_version,
        "created_at": created_at,
        "entrypoint": "index.html",
        "min_native_bridge_version": 1,
        "source_commit_full": str(source.get("source_commit_full", "")),
        "source_commit_short": str(source.get("source_commit_short", "")),
        "source_branch": str(source.get("source_branch", "")),
        "source_dirty": bool(source.get("source_dirty", True)),
        "files": files,
    }


def write_deterministic_zip(root: Path, output: Path) -> None:
    if output.exists():
        deleted = False
        last_error: Exception | None = None
        for _ in range(40):
            try:
                output.unlink()
                deleted = True
                break
            except PermissionError as exc:
                last_error = exc
                time.sleep(0.1)
        if not deleted and output.exists():
            if last_error is not None:
                raise last_error
            output.unlink()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            info = zipfile.ZipInfo(relative)
            info.date_time = (2024, 1, 1, 0, 0, 0)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Pucky cached HTML UI bundle.")
    parser.add_argument("--out", type=Path, default=UI_DIST)
    parser.add_argument("--version", default=default_version())
    parser.add_argument("--created-at", default=DEFAULT_CREATED_AT)
    args = parser.parse_args()
    result = build_ui_bundle(args.out, ui_version=args.version, created_at=args.created_at)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
