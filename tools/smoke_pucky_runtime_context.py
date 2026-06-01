from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.server import Config, PuckyVoiceService, compose_pucky_base_instructions  # noqa: E402


def _compiled_markdown_report(compiled: str | None) -> dict[str, Any]:
    text = str(compiled or "")
    return {
        "has_injected_runtime_json": "## Injected Runtime Context" in text,
        "has_json_fence": "```json" in text,
        "unresolved_placeholders": sorted(set(re.findall(r"\{\{PUCKY_[A-Z0-9_]+\}\}", text))),
        "has_agent_runtime_catalog": "Exact runtime actions:" in text and "- thread/start" in text,
        "has_action_log": "## Action Log" in text and "Last 150 meaningful system-wide actions for this user:" in text,
        "has_connected_apps": "Connected apps:" in text and "Connected now:" in text,
        "has_available_apps": "Available apps:" in text and "Available to connect:" in text,
        "has_reply_icons": "Current icon/color choices:" in text and "| #" in text,
    }


def compile_runtime_report(service: Any, *, context: dict[str, Any] | None = None, compiled: str | None = None) -> dict[str, Any]:
    context = context or service._base_runtime_context()
    composio = context.get("composio") if isinstance(context.get("composio"), dict) else {}
    reply_card = context.get("reply_card") if isinstance(context.get("reply_card"), dict) else {}
    action_log = context.get("action_log") if isinstance(context.get("action_log"), dict) else {}
    agent_runtime = context.get("agent_runtime") if isinstance(context.get("agent_runtime"), dict) else {}
    config = getattr(service, "config", None)
    base_config_loaded = bool(getattr(config, "codex_base_instructions", None))
    if compiled is None and base_config_loaded:
        compiled = compose_pucky_base_instructions(str(getattr(config, "codex_base_instructions") or ""), context)
    markdown_report = _compiled_markdown_report(compiled)
    connected_diagnostics = composio.get("connected_app_diagnostics") if isinstance(composio.get("connected_app_diagnostics"), dict) else {}
    return {
        "schema": "pucky.runtime_context_smoke.v1",
        "ok": True,
        "base_config_loaded": base_config_loaded,
        "compiled_present": bool(compiled),
        "compiled_length": len(compiled or ""),
        "compiled_sha256": hashlib.sha256((compiled or "").encode("utf-8")).hexdigest() if compiled else "",
        "compiled_readable_sections_ok": all(
            bool(markdown_report[key])
            for key in (
                "has_agent_runtime_catalog",
                "has_action_log",
                "has_connected_apps",
                "has_available_apps",
                "has_reply_icons",
            )
        ),
        "compiled_raw_runtime_json_present": bool(markdown_report["has_injected_runtime_json"] or markdown_report["has_json_fence"]),
        "compiled_unresolved_placeholders": markdown_report["unresolved_placeholders"],
        "thread_start_includes_base": bool(base_config_loaded and compiled),
        "agent_runtime_action_count": len(list(agent_runtime.get("actions") or [])),
        "agent_runtime_actions": [str(item.get("name") or "") for item in list(agent_runtime.get("actions") or []) if isinstance(item, dict)],
        "connected_app_count": len(list(composio.get("connected_apps") or [])),
        "connected_active_account_row_count": int(connected_diagnostics.get("active_account_rows") or 0),
        "connected_unique_active_app_count": int(connected_diagnostics.get("unique_active_app_count") or 0),
        "connected_status_counts": connected_diagnostics.get("status_counts") if isinstance(connected_diagnostics.get("status_counts"), dict) else {},
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
        "action_log_row_count": len(list(action_log.get("rows") or [])),
        "action_log_limit": int(action_log.get("limit") or 150),
    }


def validate_runtime_report(
    report: dict[str, Any],
    *,
    require_composio: bool = False,
    require_base: bool = False,
    min_app_universe_count: int = 0,
) -> None:
    missing: list[str] = []
    if require_base and not bool(report.get("base_config_loaded")):
        missing.append("base_config_loaded")
    if require_base and not bool(report.get("compiled_present")):
        missing.append("compiled_present")
    if require_base and not bool(report.get("compiled_readable_sections_ok")):
        missing.append("compiled_readable_sections_ok")
    if require_base and bool(report.get("compiled_raw_runtime_json_present")):
        missing.append("compiled_raw_runtime_json_absent")
    if require_base and list(report.get("compiled_unresolved_placeholders") or []):
        missing.append("compiled_unresolved_placeholders")
    if require_base and not bool(report.get("thread_start_includes_base")):
        missing.append("thread_start_includes_base")
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
    if min_app_universe_count and int(report.get("app_universe_count") or 0) < min_app_universe_count:
        missing.append(f"composio.app_universe_count>={min_app_universe_count}")
    if int(report.get("action_log_row_count") or 0) > int(report.get("action_log_limit") or 150):
        missing.append("action_log.recent")
    if missing:
        raise RuntimeError("runtime smoke missing: " + ", ".join(missing))


def run_cross_thread_smoke(service: PuckyVoiceService, *, text: str, base_instructions: str | None = None) -> dict[str, Any]:
    service.start()
    compiled = base_instructions if base_instructions is not None else service.codex_base_instructions_for_thread()
    start = service.agent_runtime_call(
        {
            "method": "thread/start",
            "params": {
                "approvalPolicy": service.config.codex_approval_policy,
                "sandbox": service.config.codex_sandbox,
                **({"model": service.config.codex_model} if service.config.codex_model else {}),
                **({"cwd": service.config.codex_cwd} if service.config.codex_cwd else {}),
                **({"baseInstructions": compiled} if service.config.codex_base_instructions and compiled else {}),
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
        "thread_start_includes_base": bool(service.config.codex_base_instructions and compiled),
        "turn_started": bool(((turn.get("result") or {}).get("turn") or {}).get("id")),
        "read_ok": bool(read.get("ok")),
    }


def run_tool_action_smoke(service: PuckyVoiceService, *, text: str, compiled_output: str = "") -> dict[str, Any]:
    service.start()
    send = getattr(service.codex, "send_turn", None) or getattr(service.codex, "send_text", None)
    if not callable(send):
        raise RuntimeError("Codex client does not expose send_turn")
    result = send(text)
    context = service._base_runtime_context()
    compiled = compose_pucky_base_instructions(service.config.codex_base_instructions, context)
    if compiled_output:
        output = Path(compiled_output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(compiled or "", encoding="utf-8")
    rows = list((context.get("action_log") or {}).get("rows") or []) if isinstance(context.get("action_log"), dict) else []
    matching = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("surface") or "") == "codex_tool"
        and str(row.get("tool") or "") in {"shell_command", "exec_command"}
        and "rg" in str(row.get("target") or "").lower()
    ]
    if not matching:
        raise RuntimeError("runtime tool smoke missing codex_tool shell/exec command rg row in next compiled prompt")
    return {
        "schema": "pucky.runtime_tool_action_smoke.v1",
        "thread_id": result.used_thread_id,
        "thread_mode": result.thread_mode,
        "reply_chars": len(result.reply_text or ""),
        "matched_action": matching[0],
        "compiled_sha256": hashlib.sha256((compiled or "").encode("utf-8")).hexdigest() if compiled else "",
    }


def default_weather_location_text() -> str:
    return (
        "Answer a local-context weather request. Use the repo's puckyctl CLI instead of guessing. "
        "First run `python pucky-apk/puckyctl/puckyctl.py --json devices` to find an online device_id. "
        "Then run `python pucky-apk/puckyctl/puckyctl.py --json --device-id <device_id> capabilities --refresh`. "
        "If location capability and permission are available, run "
        "`python pucky-apk/puckyctl/puckyctl.py --json --device-id <device_id> location get --timeout-ms 10000`. "
        "Then return strict JSON with a short answer. Do not say you lack device location unless those commands fail."
    )


def run_weather_location_smoke(service: PuckyVoiceService, *, text: str, compiled_output: str = "") -> dict[str, Any]:
    service.start()
    send = getattr(service.codex, "send_turn", None) or getattr(service.codex, "send_text", None)
    if not callable(send):
        raise RuntimeError("Codex client does not expose send_turn")
    result = send(text)
    context = service._base_runtime_context()
    compiled = compose_pucky_base_instructions(service.config.codex_base_instructions, context)
    if compiled_output:
        output = Path(compiled_output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(compiled or "", encoding="utf-8")
    rows = list((context.get("action_log") or {}).get("rows") or []) if isinstance(context.get("action_log"), dict) else []
    capability_rows = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("surface") or "") == "apk_broker"
        and str(row.get("tool") or row.get("action") or "") == "capabilities.get"
    ]
    location_rows = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("surface") or "") == "apk_broker"
        and str(row.get("tool") or row.get("action") or "") == "location.get"
    ]
    if not capability_rows or not location_rows:
        raise RuntimeError("weather/location smoke missing apk_broker capabilities.get and location.get rows")
    reply_text = str(getattr(result, "reply_text", "") or "")
    lowered_reply = reply_text.lower()
    if any(
        phrase in lowered_reply
        for phrase in (
            "don't have access to your location",
            "do not have access to your location",
            "need your location",
        )
    ):
        raise RuntimeError("weather/location smoke reply still claimed device location was unavailable")
    return {
        "schema": "pucky.runtime_weather_location_smoke.v1",
        "thread_id": result.used_thread_id,
        "thread_mode": result.thread_mode,
        "reply_chars": len(reply_text),
        "matched_capabilities": capability_rows[0],
        "matched_location": location_rows[0],
        "compiled_sha256": hashlib.sha256((compiled or "").encode("utf-8")).hexdigest() if compiled else "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test Pucky runtime context compilation.")
    parser.add_argument("--require-composio", action="store_true")
    parser.add_argument("--require-base", action="store_true")
    parser.add_argument("--min-app-universe-count", type=int, default=0)
    parser.add_argument("--cross-thread", action="store_true")
    parser.add_argument("--tool-action-smoke", action="store_true")
    parser.add_argument("--weather-location-smoke", action="store_true")
    parser.add_argument("--compiled-output", default="")
    parser.add_argument("--weather-text", default="")
    parser.add_argument(
        "--text",
        default=(
            "Run exactly one shell_command tool call: rg --version. "
            "Then reply as strict JSON with a short success summary."
        ),
    )
    args = parser.parse_args()

    service = PuckyVoiceService(Config.from_env())
    context = service._base_runtime_context()
    compiled = compose_pucky_base_instructions(service.config.codex_base_instructions, context)
    report = compile_runtime_report(service, context=context, compiled=compiled)
    require_base = bool(args.require_base or args.cross_thread)
    validate_runtime_report(
        report,
        require_composio=args.require_composio,
        require_base=require_base,
        min_app_universe_count=args.min_app_universe_count,
    )
    if args.compiled_output:
        output = Path(args.compiled_output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(compiled or "", encoding="utf-8")
    if args.cross_thread:
        report["cross_thread"] = run_cross_thread_smoke(service, text=args.text, base_instructions=compiled)
    if args.tool_action_smoke:
        report["tool_action_smoke"] = run_tool_action_smoke(
            service,
            text=args.text,
            compiled_output=args.compiled_output,
        )
    if args.weather_location_smoke:
        report["weather_location_smoke"] = run_weather_location_smoke(
            service,
            text=args.weather_text or default_weather_location_text(),
            compiled_output=args.compiled_output,
        )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
