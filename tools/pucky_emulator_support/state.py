from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable


def load_state(root: Path, slot: int) -> dict[str, Any]:
    path = root / ".tmp" / "pucky-emulator" / "state" / f"slot{slot:02d}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(config: Any, extra: dict[str, Any], *, now_iso: Callable[[], str]) -> dict[str, Any]:
    payload = {
        "schema": "pucky.emulator_slot_state.v1",
        "saved_at": now_iso(),
        "slot": config.slot,
        "run_id": config.run_id,
        **extra,
    }
    path = Path(config.state_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return payload


def state_pid(value: Any) -> int | None:
    try:
        pid = int(value)
    except (TypeError, ValueError):
        return None
    return pid if pid > 0 else None


def slot_state_has_live_processes(
    state: dict[str, Any] | None,
    *,
    process_alive: Callable[[int | None], bool],
) -> bool:
    if not isinstance(state, dict):
        return False
    pids = state.get("pids")
    if not isinstance(pids, dict):
        return False
    return any(process_alive(state_pid(value)) for value in pids.values())
