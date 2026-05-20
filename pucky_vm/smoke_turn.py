from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Post one raw audio turn to Pucky.")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--url", default=os.environ.get("PUCKY_TURN_URL", "http://127.0.0.1:8080/api/turn"))
    parser.add_argument("--token", default=os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--out", type=Path, default=Path("pucky-reply.wav"))
    args = parser.parse_args(argv)
    if not args.token:
        raise SystemExit("PUCKY_API_TOKEN is required")
    content_type = mimetypes.guess_type(str(args.audio))[0] or "application/octet-stream"
    request = urllib.request.Request(
        args.url,
        data=args.audio.read_bytes(),
        method="POST",
        headers={"Authorization": f"Bearer {args.token}", "Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')}") from exc
    reply_audio = base64.b64decode(payload["audio_base64"])
    args.out.write_bytes(reply_audio)
    card = payload.get("card") or {}
    print(json.dumps({
        "session_id": payload.get("session_id"),
        "text": payload.get("text"),
        "audio_mime_type": payload.get("audio_mime_type"),
        "audio_bytes": len(reply_audio),
        "card_title": card.get("title"),
        "card_icon": card.get("icon"),
        "has_html": bool(card.get("html_base64")),
        "out": str(args.out),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
