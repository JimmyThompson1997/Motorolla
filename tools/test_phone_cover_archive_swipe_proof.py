from pathlib import Path

import tools.phone_cover_archive_swipe_proof as proof


def test_cover_archive_swipe_motion_uses_realistic_cover_ratios() -> None:
    motion = proof.cover_archive_swipe_motion(1056, 1066)

    assert motion["start_x"] == 211
    assert motion["move_35_x"] == 370
    assert motion["move_50_x"] == 528
    assert motion["armed_x"] == 686
    assert motion["end_x"] == 845
    assert motion["y"] == 298
    assert 100 <= motion["step_delay_ms"] <= 150
    assert 150 <= motion["armed_pause_ms"] <= 220
    assert motion["swipe_duration_ms"] == 560


def test_build_cover_motionevent_steps_stages_armed_pause_motion() -> None:
    motion = proof.cover_archive_swipe_motion(1000, 1000)
    steps = proof.build_cover_motionevent_steps("3", motion)

    assert [step["label"] for step in steps] == [
        "down",
        "move_35",
        "move_50",
        "move_armed",
        "move_end",
        "up",
    ]
    assert steps[0]["adb_args"] == [
        "shell",
        "input",
        "touchscreen",
        "-d",
        "3",
        "motionevent",
        "DOWN",
        "200",
        "280",
    ]
    assert steps[3]["adb_args"][6:9] == ["MOVE", "650", "280"]
    assert steps[-1]["adb_args"][6:9] == ["UP", "800", "280"]


def test_first_visible_unarchived_card_prefers_visible_order() -> None:
    surface_snapshot = {
        "final_surface": {
            "visible_cards": [
                {"session_id": "visible-archived"},
                {"session_id": "visible-active"},
                {"session_id": "offscreen-active"},
            ]
        }
    }
    card_snapshot = {
        "cards": [
            {"session_id": "visible-archived", "archived": True, "title": "Archived"},
            {"session_id": "visible-active", "archived": False, "title": "Active"},
            {"session_id": "offscreen-active", "archived": False, "title": "Other"},
        ]
    }

    selected = proof.first_visible_unarchived_card(surface_snapshot, card_snapshot)

    assert selected["session_id"] == "visible-active"
    assert selected["title"] == "Active"


def test_png_dimensions_reads_real_png_header(tmp_path: Path) -> None:
    png_path = tmp_path / "cover.png"
    png_path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR"
        b"\x00\x00\x04\x20"
        b"\x00\x00\x04\x2a"
        b"\x08\x02\x00\x00\x00"
        b"\x00\x00\x00\x00"
    )

    width, height = proof.png_dimensions(png_path)

    assert width == 1056
    assert height == 1066
