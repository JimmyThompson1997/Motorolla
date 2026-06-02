from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

from pucky_vm.codex_app_server import CodexAppServerClient, command_from_env

DEFAULT_MATRIX_PATH = Path(__file__).with_name("model_battery.json")
DEFAULT_OUTPUT_ROOT = Path(".tmp") / "codex_model_battery"
DEEPINFRA_OPENAI_BASE_URL = "https://api.deepinfra.com/v1/openai"
OPENAI_PROVIDER_ID = "openai"
ENV_KEYS = (
    "CODEX_APP_SERVER_COMMAND",
    "PUCKY_CODEX_APP_SERVER_ARGS",
    "PUCKY_CODEX_PROFILE",
    "PUCKY_CODEX_MODEL",
    "PUCKY_CODEX_PROVIDER",
    "PUCKY_CODEX_PROVIDER_BASE_URL",
    "PUCKY_CODEX_PROVIDER_API_KEY",
    "PUCKY_CODEX_PROVIDER_SETTINGS",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sanitize_label(value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    return clean.strip("-") or "model"


@dataclass(frozen=True)
class PromptCase:
    id: str
    description: str
    text: str
    developer_instructions: str | None = None
    output_schema: dict[str, Any] | None = None
    expected_prefix: str | None = None
    expected_json_keys: tuple[str, ...] = ()


PROMPT_CASES: tuple[PromptCase, ...] = (
    PromptCase(
        id="coding-edit",
        description="Small coding review prompt",
        text=(
            "Review this Python function and reply with exactly two concise bullet points: "
            "one bug risk and one improvement.\n\n"
            "def total(items):\n"
            "    total = 0\n"
            "    for item in items:\n"
            "        if item:\n"
            "            total += item\n"
            "    return item\n"
        ),
    ),
    PromptCase(
        id="repo-reasoning",
        description="Repo-aware reasoning prompt",
        text=(
            "In this repo, name the module that builds the codex app-server command from environment "
            "variables and name one environment variable used to select the model. Keep the answer to two bullets."
        ),
    ),
    PromptCase(
        id="developer-instructions",
        description="Developer instructions persistence prompt",
        developer_instructions="Begin your reply with the exact token BATTERY-PERSIST and keep the reply to one sentence.",
        expected_prefix="BATTERY-PERSIST",
        text="Confirm that you can follow the requested output prefix.",
    ),
    PromptCase(
        id="structured-output",
        description="Structured output prompt",
        text="Assess whether a missing API key should be treated as a configuration error.",
        output_schema={
            "type": "object",
            "properties": {
                "risk_level": {"type": "string"},
                "summary": {"type": "string"},
            },
            "required": ["risk_level", "summary"],
            "additionalProperties": False,
        },
        expected_json_keys=("risk_level", "summary"),
    ),
)


@dataclass(frozen=True)
class ModelEntry:
    label: str
    provider_mode: str
    model: str
    base_url: str = ""
    api_key_env: str = ""
    provider_settings: dict[str, Any] = field(default_factory=dict)
    enabled: bool = True

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ModelEntry":
        label = str(payload.get("label") or "").strip()
        provider_mode = str(payload.get("provider_mode") or "").strip()
        model = str(payload.get("model") or "").strip()
        if not label or not provider_mode or not model:
            raise ValueError("matrix entry requires label, provider_mode, and model")
        settings = payload.get("provider_settings") or {}
        if not isinstance(settings, dict):
            raise ValueError(f"provider_settings must be an object for {label}")
        return cls(
            label=label,
            provider_mode=provider_mode,
            model=model,
            base_url=str(payload.get("base_url") or "").strip(),
            api_key_env=str(payload.get("api_key_env") or "").strip(),
            provider_settings=dict(settings),
            enabled=bool(payload.get("enabled", True)),
        )


def load_matrix(path: Path) -> list[ModelEntry]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise ValueError("matrix file must contain an entries array")
    return [ModelEntry.from_dict(entry) for entry in entries if isinstance(entry, dict)]


def select_entries(entries: list[ModelEntry], *, include_disabled: bool, labels: set[str] | None) -> list[ModelEntry]:
    selected: list[ModelEntry] = []
    for entry in entries:
        if labels and entry.label not in labels:
            continue
        if not include_disabled and not entry.enabled:
            continue
        selected.append(entry)
    return selected


def required_api_key(entry: ModelEntry) -> str:
    if not entry.api_key_env:
        return ""
    return str(os.environ.get(entry.api_key_env, "")).strip()


def build_entry_env(entry: ModelEntry) -> dict[str, str]:
    updates = {
        "PUCKY_CODEX_MODEL": entry.model,
    }
    if entry.provider_mode == "openai-compatible":
        api_key = required_api_key(entry)
        if not api_key:
            raise RuntimeError(f"{entry.label} requires environment variable {entry.api_key_env}")
        base_url = entry.base_url or DEEPINFRA_OPENAI_BASE_URL
        updates.update(
            {
                "PUCKY_CODEX_PROVIDER": OPENAI_PROVIDER_ID,
                "PUCKY_CODEX_PROVIDER_BASE_URL": base_url,
                "PUCKY_CODEX_PROVIDER_API_KEY": api_key,
            }
        )
        if entry.provider_settings:
            updates["PUCKY_CODEX_PROVIDER_SETTINGS"] = json.dumps(entry.provider_settings, sort_keys=True)
    elif entry.provider_mode == "openai-direct":
        if entry.api_key_env and not required_api_key(entry):
            raise RuntimeError(f"{entry.label} requires environment variable {entry.api_key_env}")
    else:
        raise RuntimeError(f"{entry.label} uses unsupported provider_mode {entry.provider_mode!r}")
    return updates


@contextlib.contextmanager
def temporary_model_env(entry: ModelEntry) -> Iterator[dict[str, str]]:
    previous = {key: os.environ.get(key) for key in ENV_KEYS}
    try:
        for key in ENV_KEYS:
            os.environ.pop(key, None)
        updates = build_entry_env(entry)
        os.environ.update(updates)
        yield updates
    finally:
        for key in ENV_KEYS:
            os.environ.pop(key, None)
        for key, value in previous.items():
            if value is not None:
                os.environ[key] = value


def resolve_command() -> list[str]:
    return command_from_env(None)


def run_prompt_case(
    entry: ModelEntry,
    prompt_case: PromptCase,
    *,
    repo_root: Path,
    startup_timeout: float,
    turn_timeout: float,
    command_builder: Callable[[], list[str]],
) -> dict[str, Any]:
    started = time.perf_counter()
    client = CodexAppServerClient(
        command=command_builder(),
        cwd=str(repo_root),
        startup_timeout=startup_timeout,
        turn_timeout=turn_timeout,
        developer_instructions=prompt_case.developer_instructions,
        approval_policy="never",
        sandbox="read-only",
        model=entry.model,
    )
    try:
        client.start()
        result = client.send_turn(prompt_case.text, output_schema=prompt_case.output_schema)
        reply_text = result.reply_text
        checks: dict[str, Any] = {}
        if prompt_case.expected_prefix:
            checks["expected_prefix"] = prompt_case.expected_prefix
            checks["prefix_ok"] = reply_text.startswith(prompt_case.expected_prefix)
        if prompt_case.expected_json_keys:
            try:
                parsed = json.loads(reply_text)
            except json.JSONDecodeError:
                checks["json_keys_ok"] = False
            else:
                checks["json_keys_ok"] = all(key in parsed for key in prompt_case.expected_json_keys)
        return {
            "id": prompt_case.id,
            "description": prompt_case.description,
            "status": "completed",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "reply_text": reply_text,
            "output_length": len(reply_text),
            "stderr_tail": client.stderr_tail,
            "checks": checks,
            "thread_routing": result.routing(),
        }
    finally:
        client.close()


def run_entry(
    entry: ModelEntry,
    *,
    repo_root: Path,
    output_dir: Path,
    startup_timeout: float,
    turn_timeout: float,
    command_builder: Callable[[], list[str]] = resolve_command,
) -> dict[str, Any]:
    entry_started_at = utc_now()
    wall_start = time.perf_counter()
    prompt_results: list[dict[str, Any]] = []
    error = ""
    status = "completed"
    command: list[str] = []
    env_updates: dict[str, str] = {}
    with contextlib.ExitStack() as stack:
        try:
            env_updates = stack.enter_context(temporary_model_env(entry))
            command = command_builder()
            for prompt_case in PROMPT_CASES:
                prompt_results.append(
                    run_prompt_case(
                        entry,
                        prompt_case,
                        repo_root=repo_root,
                        startup_timeout=startup_timeout,
                        turn_timeout=turn_timeout,
                        command_builder=lambda command=command: list(command),
                    )
                )
        except Exception as exc:
            status = "failed"
            error = str(exc)
    result = {
        "label": entry.label,
        "enabled": entry.enabled,
        "provider_mode": entry.provider_mode,
        "provider": OPENAI_PROVIDER_ID if entry.provider_mode == "openai-compatible" else "",
        "model": entry.model,
        "base_url": entry.base_url,
        "api_key_env": entry.api_key_env,
        "provider_settings": entry.provider_settings,
        "status": status,
        "error": error,
        "started_at": entry_started_at,
        "duration_ms": round((time.perf_counter() - wall_start) * 1000, 2),
        "command": command,
        "env_keys": sorted(env_updates.keys()),
        "prompt_results": prompt_results,
    }
    entry_path = output_dir / f"{sanitize_label(entry.label)}.json"
    entry_path.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    return result


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a local Codex model battery against env-routed providers.")
    parser.add_argument("--matrix", default=str(DEFAULT_MATRIX_PATH), help="Path to the model matrix JSON.")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT), help="Directory root for battery artifacts.")
    parser.add_argument("--labels", default="", help="Comma-separated labels to run.")
    parser.add_argument("--include-disabled", action="store_true", help="Include matrix entries marked enabled=false.")
    parser.add_argument("--startup-timeout", type=float, default=30.0, help="Codex app-server startup timeout in seconds.")
    parser.add_argument("--turn-timeout", type=float, default=180.0, help="Per-turn timeout in seconds.")
    parser.add_argument("--fail-fast", action="store_true", help="Stop after the first failed model.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parents[1]
    matrix_path = Path(args.matrix).resolve()
    entries = load_matrix(matrix_path)
    labels = {label.strip() for label in args.labels.split(",") if label.strip()} or None
    selected = select_entries(entries, include_disabled=args.include_disabled, labels=labels)
    if not selected:
        raise SystemExit("No model entries selected.")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = Path(args.output_root).resolve() / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for entry in selected:
        result = run_entry(
            entry,
            repo_root=repo_root,
            output_dir=output_dir,
            startup_timeout=args.startup_timeout,
            turn_timeout=args.turn_timeout,
        )
        results.append(result)
        if args.fail_fast and result["status"] != "completed":
            break

    summary = {
        "schema": "pucky.codex_model_battery.v1",
        "generated_at": utc_now(),
        "repo_root": str(repo_root),
        "matrix_path": str(matrix_path),
        "output_dir": str(output_dir),
        "selected_labels": [entry.label for entry in selected],
        "results": results,
    }
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    print(str(summary_path))
    return 0 if all(result["status"] == "completed" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
