from __future__ import annotations

from http.server import ThreadingHTTPServer
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.server import PuckyVoiceService, make_handler
from pucky_vm.tests.test_workspace_api import FakeCodex, FakeComposio, FakeSTT, FakeTTS, config


def main() -> None:
    root = ROOT / "artifacts" / "reminders-proof-server"
    root.mkdir(parents=True, exist_ok=True)
    service = PuckyVoiceService(
        config(root),
        stt=FakeSTT(),
        tts=FakeTTS(),
        codex=FakeCodex(),
        meeting_codex=FakeCodex(),
        composio=FakeComposio(),
    )
    service.start()
    server = ThreadingHTTPServer(("127.0.0.1", 8767), make_handler(service))
    print("reminders proof server listening on http://127.0.0.1:8767", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
