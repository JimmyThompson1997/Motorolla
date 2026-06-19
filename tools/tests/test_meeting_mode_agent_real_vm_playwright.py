from __future__ import annotations

import re
import shutil
import struct
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "tools" / "proofs" / "meeting" / "meeting_mode_agent_real_vm_playwright.mjs"


def test_long_form_real_vm_runner_covers_four_scenarios_and_meetings_route() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

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


def test_wav_duration_parser_handles_non_data_chunks(tmp_path: Path) -> None:
    if shutil.which("node") is None:
        pytest.skip("node not installed")

    source = SCRIPT_PATH.read_text(encoding="utf-8")
    match = re.search(r"function wavDurationMs\(audioPath\) \{.*?\n\}", source, re.S)
    assert match, "wavDurationMs function not found"

    sample_rate = 16000
    channels = 1
    bits_per_sample = 16
    bytes_per_second = sample_rate * channels * (bits_per_sample // 8)
    duration_ms = 2000
    data_size = (bytes_per_second * duration_ms) // 1000
    data_chunk = b"\x00" * data_size
    fmt_chunk = struct.pack(
        "<4sIHHIIHH",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        bytes_per_second,
        channels * (bits_per_sample // 8),
        bits_per_sample,
    )
    list_payload = b"INFO"
    list_chunk = struct.pack("<4sI", b"LIST", len(list_payload)) + list_payload
    data_header = struct.pack("<4sI", b"data", data_size)
    riff_size = 4 + len(fmt_chunk) + len(list_chunk) + len(data_header) + len(data_chunk)
    wav_bytes = struct.pack("<4sI4s", b"RIFF", riff_size, b"WAVE") + fmt_chunk + list_chunk + data_header + data_chunk
    wav_path = tmp_path / "with-list-chunk.wav"
    wav_path.write_bytes(wav_bytes)

    node_code = "\n".join(
        [
            "const fs = require('fs');",
            match.group(0),
            "console.log(wavDurationMs(process.argv[1]));",
        ]
    )
    output = subprocess.check_output(["node", "-e", node_code, str(wav_path)], text=True).strip()
    assert output == "2000"
