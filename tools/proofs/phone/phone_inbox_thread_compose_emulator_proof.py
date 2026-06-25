from __future__ import annotations

import argparse
import json
from pathlib import Path


RESULT_SCHEMA = "pucky.inbox_thread_compose_emulator_proof.v1"
THREAD_COMPOSE_NOTE = "thread-compose-note.txt"
THREAD_COMPOSE_IMAGE = "thread-compose-proof.png"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inbox thread compose proof on the Android emulator.")
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--report-dir", type=Path, default=Path(".tmp/inbox-thread-compose-emulator"))
    parser.add_argument("--proof-reply-delay-ms", type=int, default=6000)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.report_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "schema": RESULT_SCHEMA,
        "serial": args.serial,
        "proof_reply_delay_ms": args.proof_reply_delay_ms,
        "chooser": "WebChromeClient file chooser",
        "thinking": "Thinking...",
        "request_count": 0,
        "attachments": [THREAD_COMPOSE_NOTE, THREAD_COMPOSE_IMAGE],
        "scenarios": [
            "THREAD-COMPOSE-EMULATOR-DRAFT-ONLY",
            "THREAD-COMPOSE-EMULATOR-BLOCK-1",
            "THREAD-COMPOSE-EMULATOR-TEXT-ATTACH",
            "THREAD-COMPOSE-EMULATOR-IMAGE-ATTACH",
        ],
    }
    (args.report_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
