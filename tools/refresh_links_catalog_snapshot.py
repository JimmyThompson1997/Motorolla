from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pucky_vm.ui_bundle import links_catalog_script

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API_BASE = os.environ.get("PUCKY_LINKS_API_BASE", "https://pucky.fly.dev").rstrip("/")
DEFAULT_JSON_PATH = ROOT / "pucky_vm" / "ui_src" / "fixtures" / "links_catalog.json"
DEFAULT_JS_PATH = ROOT / "pucky_vm" / "ui_src" / "pucky-links-catalog.js"


def fetch_json(url: str, *, bearer_token: str = "") -> dict[str, object]:
    headers = {"Accept": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    request = Request(url, headers=headers)
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


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


def normalized_catalog(items: list[dict[str, object]]) -> dict[str, object]:
    rows = []
    for item in items:
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or slug).strip()
        if not slug or not name:
            continue
        rows.append(
            {
                "slug": slug,
                "name": name,
                "logo": str(item.get("logo") or "").strip(),
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
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8", newline="\n")
    js_path.write_text(links_catalog_script(payload), encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the bundled Links catalog snapshot from the live API.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN") or os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON_PATH)
    parser.add_argument("--js-out", type=Path, default=DEFAULT_JS_PATH)
    parser.add_argument("--page-size", type=int, default=250)
    args = parser.parse_args()

    token = str(args.token or "").strip()
    if not token:
        raise SystemExit("PUCKY_OPERATOR_TOKEN or PUCKY_API_TOKEN is required")

    api_base = str(args.api_base or DEFAULT_API_BASE).rstrip("/")
    portal_token = issue_portal_token(api_base, token)
    if not portal_token:
        raise SystemExit("Could not mint a Links portal token")

    payload = normalized_catalog(fetch_all_apps(api_base, portal_token, page_size=max(1, int(args.page_size))))
    write_catalog_files(payload, json_path=args.json_out, js_path=args.js_out)
    print(json.dumps({
        "ok": True,
        "api_base": api_base,
        "json_out": str(args.json_out),
        "js_out": str(args.js_out),
        "total": payload["total"],
        "catalog_version": payload["catalog_version"],
        "generated_at": payload["generated_at"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
