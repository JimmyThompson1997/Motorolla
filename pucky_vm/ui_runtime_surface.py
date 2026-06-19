from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from pucky_vm.cover_fixtures import runtime_fixture_text_from_deploy
from pucky_vm.ui_bundle import UI_SRC, build_ui_bundle


@lru_cache(maxsize=1)
def _latest_ui_bundle_result_cached() -> dict[str, object]:
    return build_ui_bundle()


def latest_ui_bundle_result() -> dict[str, object]:
    return dict(_latest_ui_bundle_result_cached())


def latest_ui_manifest() -> dict[str, Any]:
    return dict(latest_ui_bundle_result()["manifest"])


def latest_ui_bundle_path() -> Path:
    return Path(str(latest_ui_bundle_result()["bundle_path"]))


def runtime_reply_cards_fixture_text() -> str:
    return runtime_fixture_text_from_deploy(UI_SRC / "fixtures" / "reply_cards_deploy.json")
