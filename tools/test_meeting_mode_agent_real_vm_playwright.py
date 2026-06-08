from __future__ import annotations

from pathlib import Path


def test_long_form_real_vm_runner_covers_four_scenarios_and_meetings_route() -> None:
    source = (Path(__file__).with_name("meeting_mode_agent_real_vm_playwright.mjs")).read_text(encoding="utf-8")

    assert 'name: "named_duo_3to5m"' in source
    assert 'name: "anonymous_duo_3to5m"' in source
    assert 'name: "named_trio_3to5m"' in source
    assert 'name: "anonymous_trio_3to5m"' in source
    assert 'named-duo-3to5m-generated.wav' in source
    assert 'anonymous-duo-3to5m-generated.wav' in source
    assert 'meetings_before.json' in source
    assert 'meetings_after.json' in source
    assert 'waitForMeetingRouteCard' in source
    assert 'openMeetingRowSummary' in source
    assert 'openMeetingRowAudio' in source
    assert 'home_pending_tile' in source
    assert 'meetings_pending_row' in source
    assert 'audio_playback_from_summary' in source
    assert 'audio_playback_from_meetings_row' in source
