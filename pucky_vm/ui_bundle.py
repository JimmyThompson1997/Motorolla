from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory


UI_SRC = Path(__file__).with_name("ui_src")
UI_DIST = Path(__file__).with_name("ui_dist")
DEFAULT_CREATED_AT = os.environ.get("PUCKY_UI_CREATED_AT")


def default_version() -> str:
    explicit = os.environ.get("PUCKY_UI_VERSION", "").strip()
    if explicit:
        return explicit
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


DEFAULT_VERSION = default_version()


def build_ui_bundle(
    output_dir: Path | None = None,
    *,
    ui_version: str = DEFAULT_VERSION,
    created_at: str | None = DEFAULT_CREATED_AT,
) -> dict[str, object]:
    output_dir = output_dir or UI_DIST
    output_dir.mkdir(parents=True, exist_ok=True)
    created_at = created_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    with TemporaryDirectory() as temp_name:
        staging = Path(temp_name) / "bundle"
        shutil.copytree(UI_SRC, staging)
        manifest = manifest_for(staging, ui_version=ui_version, created_at=created_at)
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


def manifest_for(root: Path, *, ui_version: str, created_at: str) -> dict[str, object]:
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
        "files": files,
    }


def write_deterministic_zip(root: Path, output: Path) -> None:
    if output.exists():
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
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--created-at", default=DEFAULT_CREATED_AT)
    args = parser.parse_args()
    result = build_ui_bundle(args.out, ui_version=args.version, created_at=args.created_at)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
