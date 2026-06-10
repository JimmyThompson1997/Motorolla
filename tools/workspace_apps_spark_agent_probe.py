from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def _json_request(base_url: str, path: str, *, token: str, method: str = "GET", body: dict[str, Any] | None = None, timeout: float = 60) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base_url.rstrip("/") + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8") or "{}")
    if not isinstance(payload, dict):
        raise RuntimeError(f"{method} {path} returned non-object JSON")
    return payload


def agent_call(base_url: str, token: str, method: str, params: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    return _json_request(
        base_url,
        "/api/agent-runtime/call",
        token=token,
        method="POST",
        body={"method": method, "params": params},
        timeout=timeout,
    )


def workspace_get(base_url: str, token: str, collection: str, record_id: str, *, timeout: float) -> dict[str, Any] | None:
    try:
        return _json_request(base_url, f"/api/workspace/{collection}/{record_id}", token=token, timeout=timeout)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def start_thread(base_url: str, token: str, *, model: str, timeout: float, name: str) -> str:
    params: dict[str, Any] = {
        "approvalPolicy": "never",
        "sandbox": "danger-full-access",
    }
    if model:
        params["model"] = model
    started = agent_call(base_url, token, "thread/start", params, timeout=timeout)
    thread = ((started.get("result") or {}).get("thread") or {}) if isinstance(started.get("result"), dict) else {}
    thread_id = str(thread.get("id") or "").strip()
    if not thread_id:
        raise RuntimeError(f"thread/start did not return id: {started}")
    agent_call(base_url, token, "thread/name/set", {"threadId": thread_id, "name": name}, timeout=timeout)
    return thread_id


def run_prompt(base_url: str, token: str, *, thread_id: str, prompt: str, effort: str, timeout: float) -> dict[str, Any]:
    params: dict[str, Any] = {
        "threadId": thread_id,
        "input": [{"type": "text", "text": prompt, "text_elements": []}],
    }
    if effort:
        params["effort"] = effort
    return agent_call(base_url, token, "turn/start", params, timeout=timeout)


def wait_for_record(base_url: str, token: str, collection: str, record_id: str, *, timeout_s: float) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    last: dict[str, Any] | None = None
    while time.time() < deadline:
        last = workspace_get(base_url, token, collection, record_id, timeout=30)
        if last:
            return last
        time.sleep(2)
    raise RuntimeError(f"Spark probe did not create {collection}/{record_id}; last={last}")


def prompt_for(api_base: str, token: str, collection: str, record_id: str, description: str) -> str:
    return f"""Use the Pucky workspace API to create or update exactly one {collection} record.

API base: {api_base}
Authorization: Bearer {token}
Target endpoint: POST {api_base}/api/workspace/{collection}
Record id: {record_id}

Requirements:
- Use the endpoint above, not a local file.
- Include a generated HTML page in the `html` field.
- Make the title include the phrase `{record_id}` so the browser proof can find it.
- Scenario: {description}
- After the API write, reply with one sentence naming the record id you wrote.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Run optional Codex Spark workspace app API probes through /api/agent-runtime/call.")
    parser.add_argument("--base-url", default="https://pucky.fly.dev")
    parser.add_argument("--api-token", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--effort", default="high")
    parser.add_argument("--report-dir", default=str(Path("artifacts") / "workspace-apps-spark-agent"))
    parser.add_argument("--timeout-s", type=float, default=240)
    args = parser.parse_args()

    token = args.api_token.strip()
    if not token:
        raise SystemExit("--api-token is required for agent runtime and workspace writes")

    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    run_id = f"spark-{int(time.time())}"
    base = args.base_url.rstrip("/")
    thread_id = start_thread(base, token, model=args.model.strip(), timeout=args.timeout_s, name="Workspace apps Spark probe")
    scenarios = [
        ("notes", f"{run_id}-note", "Create a pinned note with three bullet points."),
        ("tasks", f"{run_id}-task", "Create an open task due now, then make the HTML explain the due date."),
        ("calendar-events", f"{run_id}-calendar", "Create a calendar event for tomorrow with a time and brief."),
        ("feed-items", f"{run_id}-feed", "Create a feed item describing a project decision."),
        ("projects", f"{run_id}-project", "Create a project with two named chat threads in metadata.threads."),
        ("contacts", f"{run_id}-contact", "Create a contact with email, phone, endpoints, activity, and profile HTML."),
    ]
    results: list[dict[str, Any]] = []
    for collection, record_id, description in scenarios:
        prompt = prompt_for(base, token, collection, record_id, description)
        turn = run_prompt(base, token, thread_id=thread_id, prompt=prompt, effort=args.effort.strip(), timeout=args.timeout_s)
        record = wait_for_record(base, token, collection, record_id, timeout_s=args.timeout_s)
        results.append(
            {
                "collection": collection,
                "record_id": record_id,
                "turn": turn,
                "verified_title": record.get("title", ""),
                "has_html": bool(str(record.get("html") or record.get("html_asset_id") or "").strip()),
                "metadata": record.get("metadata", {}),
            }
        )
    summary = {
        "schema": "pucky.workspace_apps_spark_agent_probe.v1",
        "ok": True,
        "base_url": base,
        "model": args.model,
        "thread_id": thread_id,
        "run_id": run_id,
        "results": results,
    }
    (report_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
