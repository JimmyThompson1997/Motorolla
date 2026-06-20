from __future__ import annotations

import json
import subprocess
from pathlib import Path

from tools import dev as tools_dev


ROOT = Path(__file__).resolve().parents[2]
SCORING_MODULE = ROOT / "tools" / "proofs" / "cover" / "notes_detail_flash_scoring.mjs"


def run_node_module(script: str) -> dict[str, object]:
    completed = subprocess.run(
        [
            tools_dev.require_binary("node"),
            "--input-type=module",
            "--eval",
            script,
        ],
        cwd=ROOT,
        env=tools_dev.proof_env(),
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_notes_detail_flash_scoring_and_classification_thresholds() -> None:
    module_uri = SCORING_MODULE.as_uri()
    script = f"""
const scoring = await import({module_uri!r});
const width = 430;
const height = 932;
const bright = new Uint8ClampedArray(width * height * 4);
const dark = new Uint8ClampedArray(width * height * 4);
for (let index = 0; index < bright.length; index += 4) {{
  bright[index] = 255;
  bright[index + 1] = 255;
  bright[index + 2] = 255;
  bright[index + 3] = 255;
  dark[index] = 8;
  dark[index + 1] = 17;
  dark[index + 2] = 28;
  dark[index + 3] = 255;
}}
const brightMetrics = scoring.scoreRgbaImage({{ rgba: bright, width, height }});
const darkMetrics = scoring.scoreRgbaImage({{ rgba: dark, width, height }});
const darkClass = scoring.classifyLaneMetrics({{ theme: "dark", lane: "natural_click", metrics: brightMetrics }});
const lightClass = scoring.classifyLaneMetrics({{ theme: "light", lane: "route_delay", metrics: darkMetrics }});
console.log(JSON.stringify({{
  crop: scoring.buildScoreCrop(),
  brightMetrics,
  darkMetrics,
  darkClass,
  lightClass,
}}));
"""
    payload = run_node_module(script)

    assert payload["crop"] == {"x": 24, "y": 120, "width": 382, "height": 692}
    bright_metrics = payload["brightMetrics"]
    dark_metrics = payload["darkMetrics"]
    assert bright_metrics["mean_luma"] == 1
    assert bright_metrics["bright_pixel_ratio"] == 1
    assert bright_metrics["dark_pixel_ratio"] == 0
    assert dark_metrics["mean_luma"] < 0.01
    assert dark_metrics["dark_pixel_ratio"] == 1
    assert dark_metrics["bright_pixel_ratio"] == 0
    assert payload["darkClass"]["ok"] is False
    assert "theme_cross_flash" in payload["darkClass"]["categories"]
    assert "route_transition_flash" in payload["darkClass"]["categories"]
    assert payload["lightClass"]["ok"] is False
    assert "theme_cross_flash" in payload["lightClass"]["categories"]
    assert "route_transition_flash" in payload["lightClass"]["categories"]


def test_notes_detail_flash_scoring_picks_theme_specific_worst_frame() -> None:
    module_uri = SCORING_MODULE.as_uri()
    script = f"""
const scoring = await import({module_uri!r});
const darkWorst = scoring.chooseWorstFrame("dark", [
  {{ offset_ms: 12, screenshot: "dark-a.png", score: {{ mean_luma: 0.42 }} }},
  {{ offset_ms: 48, screenshot: "dark-b.png", score: {{ mean_luma: 0.73 }} }},
  {{ offset_ms: 96, screenshot: "dark-c.png", score: {{ mean_luma: 0.58 }} }},
]);
const lightWorst = scoring.chooseWorstFrame("light", [
  {{ offset_ms: 12, screenshot: "light-a.png", score: {{ mean_luma: 0.62 }} }},
  {{ offset_ms: 48, screenshot: "light-b.png", score: {{ mean_luma: 0.21 }} }},
  {{ offset_ms: 96, screenshot: "light-c.png", score: {{ mean_luma: 0.37 }} }},
]);
console.log(JSON.stringify({{ darkWorst, lightWorst }}));
"""
    payload = run_node_module(script)

    assert payload["darkWorst"]["offset_ms"] == 48
    assert payload["darkWorst"]["screenshot"] == "dark-b.png"
    assert payload["lightWorst"]["offset_ms"] == 48
    assert payload["lightWorst"]["screenshot"] == "light-b.png"
