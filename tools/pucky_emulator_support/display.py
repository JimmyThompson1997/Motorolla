from __future__ import annotations


def screencap_args(display_id: str | None) -> list[str]:
    args = ["exec-out", "screencap"]
    if display_id:
        args.extend(["-d", display_id])
    args.append("-p")
    return args
