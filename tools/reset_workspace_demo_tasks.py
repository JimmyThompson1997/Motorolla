from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_BASE_URL = "https://pucky.fly.dev"
OLD_DEMO_TASK_IDS = {
    "budget",
    "roadmap-v2",
    "nda-revisions",
    "maya-call",
    "audit",
    "cleanup",
}


def run_process(executable: str, args: list[str]) -> str:
    result = subprocess.run(
        [executable, *args],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or f"{executable} failed")
    return str(result.stdout or "").strip()


def resolve_flyctl() -> str:
    candidates = [
        r"C:\Users\jimmy\.fly\bin\flyctl.exe",
        "flyctl",
    ]
    for candidate in candidates:
        try:
            run_process(candidate, ["version"])
            return candidate
        except Exception:
            continue
    raise RuntimeError("Could not find flyctl for live token discovery")


def resolve_api_token(explicit: str) -> str:
    direct = str(explicit or os.environ.get("PUCKY_API_TOKEN", "")).strip()
    if direct:
        return direct
    flyctl = resolve_flyctl()
    env_text = run_process(flyctl, ["ssh", "console", "-a", "pucky", "--command", "env"])
    for line in env_text.splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "PUCKY_API_TOKEN" and value.strip():
            return value.strip()
    raise RuntimeError("Could not resolve PUCKY_API_TOKEN from env or live Fly app")


def api_request(base_url: str, token: str, method: str, path: str, body: dict[str, object] | None = None) -> dict[str, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed ({error.code}): {payload}") from error


def list_all_tasks(base_url: str, token: str) -> list[dict[str, object]]:
    query = urllib.parse.urlencode({"include_archived": 1, "include_deleted": 1, "limit": 500})
    payload = api_request(base_url, token, "GET", f"/api/workspace/tasks?{query}")
    return list(payload.get("items") or [])


def task_html(title: str, intro: str, bullets: list[str], footer: str) -> str:
    bullet_html = "".join(f"<li>{item}</li>" for item in bullets)
    return (
        "<!doctype html><html><body>"
        f"<h1>{title}</h1>"
        f"<p>{intro}</p>"
        f"<ul>{bullet_html}</ul>"
        f"<p>{footer}</p>"
        "</body></html>"
    )


def build_demo_tasks(now_ms: int) -> list[dict[str, object]]:
    return [
        {
            "id": "demo-task-do-budget",
            "title": "Approve partner launch budget",
            "summary": "Final sign-off for this week's launch spend.",
            "status": "open",
            "due_at_ms": now_ms + 2 * 60 * 60 * 1000,
            "html": task_html(
                "Approve partner launch budget",
                "Confirm the final launch spend before tomorrow morning's review.",
                ["Review the revised cost table", "Confirm finance sign-off", "Post the approved total in the rollout thread"],
                "Budget is expected to close today so this card should stay in the active DO bucket.",
            ),
            "metadata": {"owner": "Maya Chen", "project": "Project Aurora"},
        },
        {
            "id": "demo-task-do-connect-brief",
            "title": "Review Connect onboarding brief",
            "summary": "Tighten the opening flow copy before review.",
            "status": "open",
            "due_at_ms": now_ms + 7 * 60 * 60 * 1000,
            "html": task_html(
                "Review Connect onboarding brief",
                "Trim the opening copy and verify the first-run screen order.",
                ["Check the new app labels", "Confirm the back-header behavior", "Flag any screens that still feel too busy"],
                "This one is intentionally close enough to feel urgent without falling into overdue.",
            ),
            "metadata": {"owner": "Pucky", "project": "Project Aurora"},
        },
        {
            "id": "demo-task-do-vendor-followup",
            "title": "Send vendor follow-up notes",
            "summary": "Close the loop on today's migration call.",
            "status": "open",
            "due_at_ms": now_ms + 20 * 60 * 60 * 1000,
            "html": task_html(
                "Send vendor follow-up notes",
                "Package the migration call decisions into a concise next-steps note.",
                ["List the blockers still open", "Assign owners for the two missing inputs", "Send the summary to the shared thread"],
                "If it slips past tonight it should still read cleanly on the task page.",
            ),
            "metadata": {"owner": "Tom Reyes", "project": "Migration"},
        },
        {
            "id": "demo-task-soon-roadmap",
            "title": "Prep roadmap review deck",
            "summary": "Align the next pass with design and leadership.",
            "status": "open",
            "due_at_ms": now_ms + 2 * 24 * 60 * 60 * 1000,
            "html": task_html(
                "Prep roadmap review deck",
                "Build the next revision of the roadmap deck for the standing review.",
                ["Update the milestones slide", "Trim the risks section", "Add the launch-readiness note from Maya"],
                "This sits in DUE SOON so the date treatment should stay compact.",
            ),
            "metadata": {"owner": "Pucky", "project": "Project Aurora"},
        },
        {
            "id": "demo-task-soon-nda",
            "title": "Reply to legal NDA edits",
            "summary": "Second redline still needs a response.",
            "status": "open",
            "due_at_ms": now_ms + 4 * 24 * 60 * 60 * 1000,
            "html": task_html(
                "Reply to legal NDA edits",
                "Collect the current redline, legal notes, and final signer before replying.",
                ["Confirm the indemnity language", "Note the requested signature path", "Send the next response back to legal"],
                "The body is intentionally richer so the detail page feels like a real generated brief.",
            ),
            "metadata": {"owner": "Tom Reyes", "project": "Migration"},
        },
        {
            "id": "demo-task-soon-customer-recap",
            "title": "Draft customer migration recap",
            "summary": "Pull the key decisions into one page for the sponsor.",
            "status": "open",
            "due_at_ms": now_ms + 6 * 24 * 60 * 60 * 1000,
            "html": task_html(
                "Draft customer migration recap",
                "Turn the latest migration thread into a clean sponsor-facing recap.",
                ["Summarize the main decisions", "Call out the unresolved blocker", "Propose the next check-in date"],
                "This is farther out, so the list should show a short date instead of a time.",
            ),
            "metadata": {"owner": "Priya Shah", "project": "Migration"},
        },
        {
            "id": "demo-task-overdue-invoice",
            "title": "Resolve overdue invoice approval",
            "summary": "Finance still needs the missing approval chain.",
            "status": "open",
            "due_at_ms": now_ms - 3 * 60 * 60 * 1000,
            "html": task_html(
                "Resolve overdue invoice approval",
                "This invoice missed its window and now needs an immediate follow-up.",
                ["Confirm the final approver", "Ping finance for the blocked step", "Update the migration tracker once cleared"],
                "Overdue tasks should still feel crisp in the list and on detail.",
            ),
            "metadata": {"owner": "Finance", "project": "Migration"},
        },
        {
            "id": "demo-task-overdue-security",
            "title": "Close security questionnaire gaps",
            "summary": "Two answers are still missing from the vendor packet.",
            "status": "open",
            "due_at_ms": now_ms - 28 * 60 * 60 * 1000,
            "html": task_html(
                "Close security questionnaire gaps",
                "Fill the final questionnaire gaps before the next review loop.",
                ["Answer the data retention question", "Attach the vendor policy PDF", "Send the completed packet back to procurement"],
                "This is a good overdue example because the body has enough structure to scroll.",
            ),
            "metadata": {"owner": "Security", "project": "Migration"},
        },
        {
            "id": "demo-task-overdue-launch-copy",
            "title": "Finalize launch copy edits",
            "summary": "The last copy pass slipped past deadline.",
            "status": "open",
            "due_at_ms": now_ms - 72 * 60 * 60 * 1000,
            "html": task_html(
                "Finalize launch copy edits",
                "The remaining copy nits need a final decision so the page can ship.",
                ["Resolve the headline choice", "Confirm the CTA wording", "Hand the approved copy back to design"],
                "This one is intentionally stale so the overdue bucket has variety.",
            ),
            "metadata": {"owner": "Maya Chen", "project": "Project Aurora"},
        },
        {
            "id": "demo-task-done-archive",
            "title": "Archive migration notes",
            "summary": "Moved into Project Migration.",
            "status": "done",
            "due_at_ms": now_ms - 2 * 24 * 60 * 60 * 1000,
            "html": task_html(
                "Archive migration notes",
                "The migration notes were reviewed, moved, and closed out cleanly.",
                ["Confirm the archive location", "Link the final note in the project", "Mark the cleanup complete"],
                "Done tasks keep their native state handling but still show a full page.",
            ),
            "metadata": {"owner": "Pucky", "project": "Migration"},
        },
        {
            "id": "demo-task-done-handbook",
            "title": "Publish onboarding checklist",
            "summary": "The revised first-run checklist is already live.",
            "status": "done",
            "due_at_ms": now_ms - 24 * 60 * 60 * 1000,
            "html": task_html(
                "Publish onboarding checklist",
                "The checklist shipped and the owner just needs the historical page for context.",
                ["Confirm the launch note", "Link the checklist in Connect", "Record the release timestamp"],
                "This is a clean completed example for the DONE section.",
            ),
            "metadata": {"owner": "Pucky", "project": "Project Aurora"},
        },
        {
            "id": "demo-task-done-retro",
            "title": "Log roadmap retro decisions",
            "summary": "The retro decisions were captured and distributed.",
            "status": "done",
            "due_at_ms": now_ms - 5 * 24 * 60 * 60 * 1000,
            "html": task_html(
                "Log roadmap retro decisions",
                "Capture the final retro decisions so the next planning cycle has a stable reference.",
                ["Record the tradeoffs", "Link the approved follow-ups", "Share the final retro summary"],
                "This one helps the done group feel less repetitive.",
            ),
            "metadata": {"owner": "Priya Shah", "project": "Project Aurora"},
        },
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset live workspace Tasks demo data to the intended 12-task baseline.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Workspace API base URL")
    parser.add_argument("--api-token", default="", help="Bearer token. Falls back to PUCKY_API_TOKEN or live Fly env")
    args = parser.parse_args()

    token = resolve_api_token(args.api_token)
    base_url = str(args.base_url or DEFAULT_BASE_URL).rstrip("/")
    tasks = list_all_tasks(base_url, token)
    target_ids = {
        str(task.get("id") or "")
        for task in tasks
        if str(task.get("id") or "").startswith("proof-")
        or str(task.get("id") or "").startswith("demo-task-")
        or str(task.get("id") or "") in OLD_DEMO_TASK_IDS
    }

    deleted_ids = []
    for task_id in sorted(target_ids):
        api_request(base_url, token, "DELETE", f"/api/workspace/tasks/{task_id}")
        deleted_ids.append(task_id)

    now_ms = int(time.time() * 1000)
    baseline = build_demo_tasks(now_ms)
    created_ids = []
    for task in baseline:
        api_request(base_url, token, "POST", "/api/workspace/tasks", task)
        created_ids.append(task["id"])

    final_tasks = list_all_tasks(base_url, token)
    visible_demo = [
        task for task in final_tasks
        if not task.get("archived") and not task.get("deleted") and str(task.get("id") or "").startswith("demo-task-")
    ]
    counts = {"do": 0, "soon": 0, "overdue": 0, "done": 0}
    for task in visible_demo:
        counts[str(task.get("derived_group") or "")] += 1

    payload = {
        "base_url": base_url,
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
        "created_count": len(created_ids),
        "created_ids": created_ids,
        "visible_demo_count": len(visible_demo),
        "group_counts": counts,
    }
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
