from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from pucky_vm.ui_bundle import links_catalog_script

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API_BASE = os.environ.get("PUCKY_LINKS_API_BASE", "https://pucky.fly.dev").rstrip("/")
DEFAULT_JSON_PATH = ROOT / "pucky_vm" / "ui_src" / "fixtures" / "links_catalog.json"
DEFAULT_JS_PATH = ROOT / "pucky_vm" / "ui_src" / "pucky-links-catalog.js"
DEFAULT_LOGO_DIR = ROOT / "pucky_vm" / "ui_src" / "fixtures" / "links_logos"
DEFAULT_OVERRIDES_PATH = ROOT / "pucky_vm" / "ui_src" / "fixtures" / "links_logo_overrides.json"
CONTENT_TYPE_EXTENSIONS = {
    "image/svg+xml": ".svg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
}
KNOWN_IMAGE_EXTENSIONS = {".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".ico"}


def fetch_json(url: str, *, bearer_token: str = "") -> dict[str, object]:
    headers = {"Accept": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    request = Request(url, headers=headers)
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_binary(url: str) -> tuple[bytes, str, str]:
    request = Request(
        url,
        headers={
            "Accept": "image/*,application/octet-stream;q=0.8,*/*;q=0.5",
            "User-Agent": "pucky-links-catalog-refresh/1",
        },
    )
    with urlopen(request, timeout=30) as response:
        payload = response.read()
        content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        final_url = str(response.geturl() or url).strip()
    return payload, content_type, final_url


def issue_portal_token(api_base: str, operator_token: str) -> str:
    payload = fetch_json(f"{api_base}/api/links/composio/portal-url?auth_mode=browser", bearer_token=operator_token)
    return str(payload.get("token") or "").strip()


def fetch_all_apps(api_base: str, portal_token: str, *, page_size: int = 250) -> list[dict[str, object]]:
    offset = 0
    items: list[dict[str, object]] = []
    while True:
        query = urlencode({"token": portal_token, "offset": offset, "limit": page_size})
        payload = fetch_json(f"{api_base}/api/links/composio/all-apps?{query}")
        page = payload.get("apps") if isinstance(payload.get("apps"), list) else []
        for item in page:
            if isinstance(item, dict):
                items.append(item)
        if not payload.get("has_more"):
            break
        offset += int(payload.get("count") or len(page))
    return items


def load_logo_overrides(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    overrides: dict[str, dict[str, str]] = {}
    for raw_slug, raw_value in payload.items():
        slug = str(raw_slug or "").strip()
        if not slug:
            continue
        if isinstance(raw_value, str):
            value = {"source_url": raw_value}
        elif isinstance(raw_value, dict):
            value = raw_value
        else:
            raise ValueError(f"Logo override for {slug} must be a string or object")
        source_url = str(value.get("source_url") or "").strip()
        asset_path = str(value.get("asset_path") or "").strip()
        if not source_url and not asset_path:
            raise ValueError(f"Logo override for {slug} must define source_url or asset_path")
        entry: dict[str, str] = {}
        if source_url:
            entry["source_url"] = source_url
        if asset_path:
            entry["asset_path"] = asset_path
        overrides[slug] = entry
    return overrides


def infer_logo_extension(*, content_type: str, url: str) -> str:
    normalized = str(content_type or "").strip().lower()
    if normalized in CONTENT_TYPE_EXTENSIONS:
        return CONTENT_TYPE_EXTENSIONS[normalized]
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in KNOWN_IMAGE_EXTENSIONS:
        return ".jpg" if suffix == ".jpeg" else suffix
    raise ValueError(f"Unsupported logo content type {content_type!r} for {url}")


def composio_logo_candidates(slug: str) -> list[str]:
    normalized = str(slug or "").strip()
    if not normalized:
        return []
    candidates = [f"https://logos.composio.dev/api/{normalized}"]
    trimmed = normalized.lstrip("_")
    if trimmed and trimmed != normalized:
        candidates.append(f"https://logos.composio.dev/api/{trimmed}")
    return candidates


def logo_url_candidates(item: dict[str, object], overrides: dict[str, dict[str, str]]) -> list[str]:
    slug = str(item.get("slug") or "").strip()
    original = str(item.get("logo") or "").strip()
    urls: list[str] = []
    override = overrides.get(slug) or {}
    if override.get("source_url"):
        urls.append(str(override["source_url"]).strip())
    if original:
        urls.append(original)
    urls.extend(composio_logo_candidates(slug))
    deduped: list[str] = []
    for url in urls:
        if url and url not in deduped:
            deduped.append(url)
    return deduped


def cache_logo_assets(
    items: list[dict[str, object]],
    *,
    logo_dir: Path,
    overrides: dict[str, dict[str, str]],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    if logo_dir.exists():
        shutil.rmtree(logo_dir)
    logo_dir.mkdir(parents=True, exist_ok=True)
    resolved_items: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    total_bytes = 0
    for item in items:
        slug = str(item.get("slug") or "").strip()
        if not slug:
            continue
        override = overrides.get(slug) or {}
        if override.get("asset_path"):
            source_path = (ROOT / str(override["asset_path"]).strip()).resolve()
            if not source_path.exists():
                failures.append({"slug": slug, "errors": [f"missing local asset {source_path}"]})
                continue
            extension = source_path.suffix.lower()
            if extension == ".jpeg":
                extension = ".jpg"
            if extension not in KNOWN_IMAGE_EXTENSIONS:
                failures.append({"slug": slug, "errors": [f"unsupported local asset extension {source_path.suffix}"]})
                continue
            destination = logo_dir / f"{slug}{extension}"
            shutil.copyfile(source_path, destination)
            payload = destination.read_bytes()
            total_bytes += len(payload)
            resolved_items.append(
                {
                    **item,
                    "logo_path": f"fixtures/links_logos/{destination.name}",
                    "logo_source_url": f"local:{Path(override['asset_path']).as_posix()}",
                }
            )
            continue
        errors: list[str] = []
        written = False
        for source_url in logo_url_candidates(item, overrides):
            try:
                payload, content_type, final_url = fetch_binary(source_url)
                extension = infer_logo_extension(content_type=content_type, url=final_url or source_url)
                destination = logo_dir / f"{slug}{extension}"
                destination.write_bytes(payload)
                total_bytes += len(payload)
                resolved_items.append(
                    {
                        **item,
                        "logo_path": f"fixtures/links_logos/{destination.name}",
                        "logo_source_url": source_url,
                    }
                )
                written = True
                break
            except Exception as exc:
                errors.append(f"{source_url}: {exc}")
        if not written:
            failures.append({"slug": slug, "errors": errors})
    if failures:
        raise RuntimeError("Could not cache logos for: " + json.dumps(failures[:20], indent=2))
    return resolved_items, {"logo_count": len(resolved_items), "logo_bytes": total_bytes}


def normalized_catalog(items: list[dict[str, object]]) -> dict[str, object]:
    rows = []
    for item in items:
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or slug).strip()
        logo_path = str(item.get("logo_path") or "").strip()
        logo_source_url = str(item.get("logo_source_url") or item.get("logo") or "").strip()
        if not slug or not name:
            continue
        if not logo_path or not logo_source_url:
            raise ValueError(f"Missing cached logo metadata for {slug}")
        rows.append(
            {
                "slug": slug,
                "name": name,
                "logo_path": logo_path,
                "logo_source_url": logo_source_url,
                "auth_schemes": [str(value or "").strip().upper() for value in list(item.get("auth_schemes") or []) if str(value or "").strip()],
                "managed_auth_schemes": [str(value or "").strip().upper() for value in list(item.get("managed_auth_schemes") or []) if str(value or "").strip()],
                "auth_label": str(item.get("auth_label") or "").strip(),
            }
        )
    rows.sort(key=lambda row: (str(row["name"]).lower(), str(row["slug"]).lower()))
    digest = hashlib.sha256(json.dumps(rows, separators=(",", ":"), ensure_ascii=True).encode("utf-8")).hexdigest()[:16]
    return {
        "schema": "pucky.links_catalog_bundle.v1",
        "apps": rows,
        "total": len(rows),
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "catalog_version": digest,
    }


def write_catalog_files(payload: dict[str, object], *, json_path: Path, js_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    js_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    js_path.write_text(links_catalog_script(payload), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the bundled Links catalog snapshot from the live API.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN") or os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON_PATH)
    parser.add_argument("--js-out", type=Path, default=DEFAULT_JS_PATH)
    parser.add_argument("--logo-dir", type=Path, default=DEFAULT_LOGO_DIR)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES_PATH)
    parser.add_argument("--page-size", type=int, default=250)
    args = parser.parse_args()

    token = str(args.token or "").strip()
    if not token:
        raise SystemExit("PUCKY_OPERATOR_TOKEN or PUCKY_API_TOKEN is required")

    api_base = str(args.api_base or DEFAULT_API_BASE).rstrip("/")
    portal_token = issue_portal_token(api_base, token)
    if not portal_token:
        raise SystemExit("Could not mint a Links portal token")

    overrides = load_logo_overrides(args.overrides)
    items = fetch_all_apps(api_base, portal_token, page_size=max(1, int(args.page_size)))
    resolved_items, logo_summary = cache_logo_assets(items, logo_dir=args.logo_dir, overrides=overrides)
    payload = normalized_catalog(resolved_items)
    write_catalog_files(payload, json_path=args.json_out, js_path=args.js_out)
    print(
        json.dumps(
            {
                "ok": True,
                "api_base": api_base,
                "json_out": str(args.json_out),
                "js_out": str(args.js_out),
                "logo_dir": str(args.logo_dir),
                "overrides": str(args.overrides),
                "total": payload["total"],
                "catalog_version": payload["catalog_version"],
                "generated_at": payload["generated_at"],
                "logo_count": logo_summary["logo_count"],
                "logo_bytes": logo_summary["logo_bytes"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
