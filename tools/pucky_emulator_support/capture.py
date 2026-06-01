from __future__ import annotations

import hashlib
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


def screenshot_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def capture_screenshot(
    args: Any,
    runner: Any,
    config: Any,
    path: Path,
    *,
    adb_command_fn: Callable[[Any, str, Iterable[str]], list[str]],
    primary_display_id_fn: Callable[[Any, Any, Any], str | None],
    screencap_args_fn: Callable[[str | None], list[str]],
    subprocess_module: Any = subprocess,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    display_id = primary_display_id_fn(args, runner, config)
    screencap_args = screencap_args_fn(display_id)
    if runner.dry_run:
        runner.run(adb_command_fn(args, config.serial, screencap_args), timeout=30)
        return
    with path.open("wb") as out:
        subprocess_module.run(adb_command_fn(args, config.serial, screencap_args), stdout=out, check=True, timeout=30)


@dataclass
class AsyncScreenshotCapture:
    thread: threading.Thread
    result: dict[str, Any]
    runner: Any

    def wait(self) -> None:
        self.thread.join()
        if self.runner.planned:
            self.result.setdefault("commands", [])
            self.result["commands"].extend(self.runner.planned)
        error = self.result.get("error")
        if error:
            raise error


def start_async_screenshot_capture(
    args: Any,
    runner: Any,
    config: Any,
    path: Path,
    *,
    runner_cls: type[Any],
    capture_screenshot_fn: Callable[[Any, Any, Any, Path], None],
) -> AsyncScreenshotCapture:
    async_runner = runner_cls(dry_run=runner.dry_run)
    result: dict[str, Any] = {}

    def work() -> None:
        try:
            capture_screenshot_fn(args, async_runner, config, path)
        except Exception as exc:  # pragma: no cover - propagated by wait()
            result["error"] = exc

    thread = threading.Thread(target=work, name=f"capture-{path.name}", daemon=True)
    thread.start()
    return AsyncScreenshotCapture(thread=thread, result=result, runner=async_runner)
