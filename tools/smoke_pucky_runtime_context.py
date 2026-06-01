from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.server import Config, PuckyVoiceService  # noqa: E402


def compile_runtime_report(service: Any) -> dict[str, Any]:
    context = service._base_runtime_context()
    composio = context.get("composio") if isinstance(context.get("composio"), dict) else {}
    reply_card = context.get("reply_card") if isinstance(context.get("reply_card"), dict) else {}
    action_log = context.get("action_log") if isinstance(context.get("action_log"), dict) else {}
    agent_runtime = context.get("agent_runtime") if isinstance(context.get("agent_runtime"), dict) else {}
    return {
        "schema": "pucky.runtime_context_smoke.v1",
        "ok": True,
        "agent_runtime_action_count": len(list(agent_runtime.get("actions") or [])),
        "agent_runtime_actions": [str(item.get("name") or "") for item in list(agent_runtime.get("actions") or []) if isinstance(item, dict)],
        "connected_app_count": len(list(composio.get("connected_apps") or [])),
        "app_universe_count": len(list(composio.get("app_universe") or [])),
        "available_app_count": len(list(composio.get("available_apps") or [])),
        "composio_configured": bool(composio.get("configured")),
        "reply_icon_count": len(list(reply_card.get("icons") or [])),
        "reply_icons": [
            {
                "name": str(item.get("name") or ""),
                "accent": str(item.get("accent") or ""),
            }
            for item in list(reply_card.get("icons") or [])
            if isinstance(item, dict)
        ],
        "action_log_count": len(list(action_log.get("rows") or [])),
    }


def validate_runtime_report(report: dict[str, Any], *, require_composio: bool = False) -> None:
    missing: list[str] = []
    if int(report.get("agent_runtime_action_count") or 0) < 18:
        missing.append("agent_runtime.catalog")
    if "thread/start" not in set(report.get("agent_runtime_actions") or []):
        missing.append("agent_runtime.thread_start")
    if int(report.get("reply_icon_count") or 0) <= 0:
        missing.append("reply_card.icons")
    if not any(item.get("accent") for item in list(report.get("reply_icons") or []) if isinstance(item, dict)):
        missing.append("reply_card.icon_accents")
    if require_composio and not bool(report.get("composio_configured")):
        missing.append("composio.configured")
    if require_composio and int(report.get("app_universe_count") or 0) <= 0:
        missing.append("composio.app_universe")
    if missing:
        raise RuntimeError("runtime smoke missing: " + ", ".join(missing))


def run_cross_thread_smoke(service: PuckyVoiceService, *, text: str) -> dict[str, Any]:
    service.start()
    start = service.agent_runtime_call(
        {
            "method": "thread/start",
            "params": {
                "approvalPolicy": service.config.codex_approval_policy,
                "sandbox": service.config.codex_sandbox,
                **({"model": service.config.codex_model} if service.config.codex_model else {}),
                **({"cwd": service.config.codex_cwd} if service.config.codex_cwd else {}),
                **({"baseInstructions": service.codex_base_instructions_for_thread()} if service.config.codex_base_instructions else {}),
                "developerInstructions": service.config.developer_instructions,
            },
        }
    )
    thread_id = str(((start.get("result") or {}).get("thread") or {}).get("id") or "").strip()
    if not thread_id:
        raise RuntimeError("thread/start did not return thread id")
    service.agent_runtime_call({"method": "thread/name/set", "params": {"threadId": thread_id, "name": "Pucky runtime smoke"}})
    service.agent_runtime_call({"method": "thread/resume", "params": {"threadId": thread_id}})
    turn = service.agent_runtime_call(
        {
            "method": "turn/start",
            "params": {
                "threadId": thread_id,
                "input": [{"type": "text", "text": text, "text_elements": []}],
                **({"effort": service.config.codex_reasoning_effort} if service.config.codex_reasoning_effort else {}),
            },
        }
    )
    read = service.agent_runtime_call({"method": "thread/read", "params": {"threadId": thread_id}})
    return {
        "schema": "pucky.runtime_cross_thread_smoke.v1",
        "thread_id": thread_id,
        "turn_started": bool(((turn.get("result") or {}).get("turn") or {}).get("id")),
        "read_ok": bool(read.get("ok")),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test Pucky runtime context compilation.")
    parser.add_argument("--require-composio", action="store_true")
    parser.add_argument("--cross-thread", action="store_true")
    parser.add_argument("--text", default="Pucky runtime smoke. Reply with a tiny JSON card.")
    args = parser.parse_args()

    service = PuckyVoiceService(Config.from_env())
    report = compile_runtime_report(service)
    validate_runtime_report(report, require_composio=args.require_composio)
    if args.cross_thread:
        report["cross_thread"] = run_cross_thread_smoke(service, text=args.text)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
