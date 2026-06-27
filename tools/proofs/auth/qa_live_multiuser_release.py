from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
PYTHON = sys.executable
RESULT_SCHEMA = "pucky.live_multiuser_release_gauntlet.v1"


class ReleaseGauntletError(RuntimeError):
    pass


def env_value(*names: str) -> str:
    for name in names:
        value = str(os.environ.get(name, "")).strip()
        if value:
            return value
    return ""


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def timestamp_slug() -> str:
    return time.strftime("%Y-%m-%dT%H-%M-%S", time.gmtime())


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def normalize_slug_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", str(value or "").strip().upper()).strip("_")


def default_gmail_action_json() -> str:
    return json.dumps(
        {
            "action_slug": "GMAIL_FETCH_EMAILS",
            "parameters": {
                "max_results": 1,
                "include_payload": False,
                "verbose": False,
            },
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def default_googlecalendar_action_json() -> str:
    start_epoch = int(time.time()) + 2 * 60 * 60
    start_text = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(start_epoch))
    return json.dumps(
        {
            "action_slug": "GOOGLECALENDAR_CREATE_EVENT",
            "parameters": {
                "summary": f"Pucky auth proof {time.strftime('%Y%m%dT%H%M%SZ', time.gmtime(start_epoch))}",
                "start_datetime": start_text,
                "timezone": "UTC",
                "event_duration_minutes": 30,
            },
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def default_verify_command(app_slug: str) -> str:
    clean = str(app_slug or "").strip().lower()
    if clean == "gmail":
        return (
            f'{shlex_quote(PYTHON)} tools/proofs/auth/verify_gmail_action.py '
            '--result-json-path "{{result_json_path}}" '
            '--connection-id "{{connection_id}}" '
            '--user-email "{{user_email}}"'
        )
    if clean == "googlecalendar":
        return (
            f'{shlex_quote(PYTHON)} tools/proofs/auth/verify_googlecalendar_action.py '
            '--result-json-path "{{result_json_path}}" '
            '--connection-id "{{connection_id}}" '
            '--user-email "{{user_email}}"'
        )
    return ""


def shlex_quote(value: str) -> str:
    escaped = str(value or "").replace("'", "'\"'\"'")
    return f"'{escaped}'"


def composio_required_apps() -> list[str]:
    configured = split_csv(env_value("PUCKY_AUTH_COMPOSIO_REQUIRED_APPS", "PUCKY_COMPOSIO_REQUIRED_APPS"))
    return configured or ["gmail", "googlecalendar"]


def composio_app_setting(app_slug: str, suffix: str) -> str:
    key = normalize_slug_key(app_slug)
    return env_value(
        f"PUCKY_AUTH_COMPOSIO_{key}_{suffix}",
        f"PUCKY_COMPOSIO_{key}_{suffix}",
    )


def composio_app_env_overrides(app_slug: str) -> dict[str, str]:
    env: dict[str, str] = {
        "PUCKY_AUTH_COMPOSIO_APP_SLUG": app_slug,
        "PUCKY_COMPOSIO_APP_SLUG": app_slug,
    }
    mappings = {
        "USER_A_ACTION_JSON": "PUCKY_COMPOSIO_USER_A_ACTION_JSON",
        "USER_B_ACTION_JSON": "PUCKY_COMPOSIO_USER_B_ACTION_JSON",
        "USER_A_VERIFY_COMMAND": "PUCKY_COMPOSIO_USER_A_VERIFY_COMMAND",
        "USER_B_VERIFY_COMMAND": "PUCKY_COMPOSIO_USER_B_VERIFY_COMMAND",
        "REQUIRE_USER_B_OWN_CONNECTION": "PUCKY_COMPOSIO_REQUIRE_USER_B_OWN_CONNECTION",
        "REQUIRE_VERIFICATION_COMMAND": "PUCKY_COMPOSIO_REQUIRE_VERIFICATION_COMMAND",
        "CONNECT_WAIT_MS": "PUCKY_COMPOSIO_CONNECT_WAIT_MS",
        "TIMEOUT_MS": "PUCKY_COMPOSIO_TIMEOUT_MS",
        "CONNECT_VIA_UI": "PUCKY_COMPOSIO_CONNECT_VIA_UI",
    }
    for suffix, target_name in mappings.items():
        value = composio_app_setting(app_slug, suffix)
        if value:
            env[target_name] = value
    if app_slug == "gmail" and "PUCKY_COMPOSIO_USER_A_ACTION_JSON" not in env:
        env["PUCKY_COMPOSIO_USER_A_ACTION_JSON"] = default_gmail_action_json()
    if app_slug == "googlecalendar" and "PUCKY_COMPOSIO_USER_A_ACTION_JSON" not in env:
        env["PUCKY_COMPOSIO_USER_A_ACTION_JSON"] = default_googlecalendar_action_json()
    default_command = default_verify_command(app_slug)
    if default_command and "PUCKY_COMPOSIO_USER_A_VERIFY_COMMAND" not in env:
        env["PUCKY_COMPOSIO_USER_A_VERIFY_COMMAND"] = default_command
    if app_slug in {"gmail", "googlecalendar"} and "PUCKY_COMPOSIO_REQUIRE_VERIFICATION_COMMAND" not in env:
        env["PUCKY_COMPOSIO_REQUIRE_VERIFICATION_COMMAND"] = "1"
    return env


def ensure_composio_app_inputs(app_slug: str) -> None:
    if composio_app_setting(app_slug, "USER_A_ACTION_JSON"):
        return
    if app_slug in {"gmail", "googlecalendar"}:
        return
    if not composio_app_setting(app_slug, "USER_A_ACTION_JSON"):
        raise ReleaseGauntletError(
            f"Missing Composio action config for {app_slug}. Set PUCKY_AUTH_COMPOSIO_{normalize_slug_key(app_slug)}_USER_A_ACTION_JSON."
        )
    if app_slug == "googlecalendar" and not composio_app_setting(app_slug, "USER_A_VERIFY_COMMAND") and not default_verify_command(app_slug):
        raise ReleaseGauntletError(
            "Missing Google Calendar verification command. Set PUCKY_AUTH_COMPOSIO_GOOGLECALENDAR_USER_A_VERIFY_COMMAND."
        )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the full multi-user auth/composio/android release gauntlet and emit one machine-readable verdict.")
    parser.add_argument("--bundle-dir", type=Path, default=ROOT / ".tmp" / "qa-live-multiuser-release" / timestamp_slug())
    parser.add_argument("--staging-base-url", default=env_value("PUCKY_AUTH_STAGING_BASE_URL"))
    parser.add_argument("--production-base-url", default=env_value("PUCKY_AUTH_PRODUCTION_BASE_URL", "PUCKY_AUTH_BASE_URL"))
    parser.add_argument("--staging-deploy-command", default=env_value("PUCKY_AUTH_STAGING_DEPLOY_COMMAND"))
    parser.add_argument("--production-deploy-command", default=env_value("PUCKY_AUTH_PRODUCTION_DEPLOY_COMMAND", "PUCKY_AUTH_DEPLOY_COMMAND"))
    parser.add_argument("--local-base-url", default=env_value("PUCKY_AUTH_LOCAL_BASE_URL", "PUCKY_AUTH_BASE_URL"))
    args = parser.parse_args(argv)
    args.bundle_dir = args.bundle_dir.resolve()
    return args


def ensure_inputs(args: argparse.Namespace) -> None:
    if not args.local_base_url:
        raise ReleaseGauntletError("Missing --local-base-url or PUCKY_AUTH_LOCAL_BASE_URL/PUCKY_AUTH_BASE_URL.")
    if not args.staging_base_url:
        raise ReleaseGauntletError("Missing --staging-base-url or PUCKY_AUTH_STAGING_BASE_URL.")
    if not args.production_base_url:
        raise ReleaseGauntletError("Missing --production-base-url or PUCKY_AUTH_PRODUCTION_BASE_URL/PUCKY_AUTH_BASE_URL.")
    if not args.staging_deploy_command:
        raise ReleaseGauntletError("Missing --staging-deploy-command or PUCKY_AUTH_STAGING_DEPLOY_COMMAND.")
    if not args.production_deploy_command:
        raise ReleaseGauntletError("Missing --production-deploy-command or PUCKY_AUTH_PRODUCTION_DEPLOY_COMMAND/PUCKY_AUTH_DEPLOY_COMMAND.")
    for app_slug in composio_required_apps():
        ensure_composio_app_inputs(app_slug)


def run_command(
    command: list[str] | str,
    *,
    cwd: Path,
    env: dict[str, str],
    log_path: Path,
    shell: bool = False,
) -> dict[str, Any]:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    started_at = utc_now()
    if shell:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    else:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    finished_at = utc_now()
    payload = {
        "started_at": started_at,
        "finished_at": finished_at,
        "returncode": int(completed.returncode),
        "stdout": str(completed.stdout or ""),
        "stderr": str(completed.stderr or ""),
    }
    log_path.write_text(
        json.dumps(
            {
                "command": command if isinstance(command, str) else list(command),
                **payload,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return payload


def stage_env(base_url: str, bundle_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["PUCKY_AUTH_BASE_URL"] = base_url
    env["PUCKY_AUTH_LOGIN_URL"] = env.get("PUCKY_AUTH_LOGIN_URL", "").strip() or f"{base_url.rstrip('/')}/sign-in"
    env["PUCKY_AUTH_BUNDLE_DIR"] = str(bundle_dir)
    return env


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run_task(
    task: str,
    report_dir: Path,
    *,
    env: dict[str, str],
    bundle_dir: Path,
    task_label: str | None = None,
    argv_extra: list[str] | None = None,
) -> dict[str, Any]:
    label = str(task_label or task)
    argv = [PYTHON, "-m", "tools.dev", task, "--report-dir", str(report_dir), *(argv_extra or [])]
    result = run_command(argv, cwd=ROOT, env=env, log_path=bundle_dir / "logs" / f"{label}.json")
    return {
        "task": label,
        "base_task": task,
        "report_dir": str(report_dir),
        **result,
    }


def run_deploy(label: str, command: str, *, env: dict[str, str], bundle_dir: Path) -> dict[str, Any]:
    result = run_command(command, cwd=ROOT, env=env, log_path=bundle_dir / "logs" / f"{label}.json", shell=True)
    return {
        "task": label,
        "command": command,
        **result,
    }


def run_composio_app_suite(stage_name: str, stage_root: Path, *, env: dict[str, str], bundle_dir: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for app_slug in composio_required_apps():
        app_env = dict(env)
        app_env.update(composio_app_env_overrides(app_slug))
        results.append(
            run_task(
                "proof-live-auth-composio",
                stage_root / f"auth-composio-{app_slug}",
                env=app_env,
                bundle_dir=bundle_dir,
                task_label=f"proof-live-auth-composio-{stage_name}-{app_slug}",
                argv_extra=["--app-slug", app_slug],
            )
        )
    return results


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ensure_inputs(args)
    args.bundle_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "ok": False,
        "bundle_dir": str(args.bundle_dir),
        "required_composio_apps": composio_required_apps(),
        "started_at": utc_now(),
        "stages": [],
    }
    try:
        local_env = stage_env(args.local_base_url, args.bundle_dir / "local")
        summary["stages"].append(run_task("test-fast", args.bundle_dir / "local" / "test-fast", env=local_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("test-full", args.bundle_dir / "local" / "test-full", env=local_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("proof-live-auth-browser", args.bundle_dir / "local" / "auth-browser", env=local_env, bundle_dir=args.bundle_dir))
        summary["stages"].extend(run_composio_app_suite("local", args.bundle_dir / "local", env=local_env, bundle_dir=args.bundle_dir))

        staging_env = stage_env(args.staging_base_url, args.bundle_dir / "staging")
        summary["stages"].append(run_deploy("staging-deploy", args.staging_deploy_command, env=staging_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("proof-live-web", args.bundle_dir / "staging" / "proof-live-web", env=staging_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("qa-hosted-web", args.bundle_dir / "staging" / "qa-hosted-web", env=staging_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("proof-live-auth-browser", args.bundle_dir / "staging" / "auth-browser", env=staging_env, bundle_dir=args.bundle_dir))
        summary["stages"].extend(run_composio_app_suite("staging", args.bundle_dir / "staging", env=staging_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("proof-live-auth-android-ubc", args.bundle_dir / "staging" / "android-ubc", env=staging_env, bundle_dir=args.bundle_dir))

        production_env = stage_env(args.production_base_url, args.bundle_dir / "production")
        summary["stages"].append(run_deploy("production-deploy", args.production_deploy_command, env=production_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("proof-live-web", args.bundle_dir / "production" / "proof-live-web", env=production_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("qa-hosted-web", args.bundle_dir / "production" / "qa-hosted-web", env=production_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("proof-live-auth-browser", args.bundle_dir / "production" / "auth-browser", env=production_env, bundle_dir=args.bundle_dir))
        summary["stages"].extend(run_composio_app_suite("production", args.bundle_dir / "production", env=production_env, bundle_dir=args.bundle_dir))
        summary["stages"].append(run_task("proof-live-auth-android-ubc", args.bundle_dir / "production" / "android-ubc", env=production_env, bundle_dir=args.bundle_dir))

        failures = [stage for stage in summary["stages"] if int(stage.get("returncode", 1)) != 0]
        if failures:
            raise ReleaseGauntletError(
                "Release gauntlet failed in stages: " + ", ".join(str(stage.get("task") or "") for stage in failures)
            )
        summary["ok"] = True
        summary["verdict"] = {
            "status": "pass",
            "reason": "all_required_lanes_passed",
        }
        return_code = 0
    except Exception as exc:
        summary["error"] = str(exc)
        summary["verdict"] = {
            "status": "fail",
            "reason": str(exc),
        }
        return_code = 1
    summary["finished_at"] = utc_now()
    write_json(args.bundle_dir / "summary.json", summary)
    write_json(args.bundle_dir / "verdict.json", summary["verdict"])
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
