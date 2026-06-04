from __future__ import annotations

from pathlib import Path
from typing import Any

from pucky_vm.cover_fixtures import runtime_fixture_text_from_deploy
from pucky_vm.ui_bundle import UI_SRC, build_ui_bundle

_LATEST_UI_BUNDLE_RESULT = build_ui_bundle()


def latest_ui_bundle_result() -> dict[str, object]:
    return _LATEST_UI_BUNDLE_RESULT


def latest_ui_manifest() -> dict[str, Any]:
    return dict(latest_ui_bundle_result()["manifest"])


def latest_ui_bundle_path() -> Path:
    return Path(str(latest_ui_bundle_result()["bundle_path"]))


def runtime_reply_cards_fixture_text() -> str:
    return runtime_fixture_text_from_deploy(UI_SRC / "fixtures" / "reply_cards_deploy.json")
