from __future__ import annotations

from pathlib import Path

import tools.proofs.phone.phone_contacts_search_emulator_proof as proof


def test_parse_focus_component_accepts_multiple_dumpsys_shapes() -> None:
    assert proof.parse_focus_component("mCurrentFocus=Window{123 u0 com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity}") == (
        "com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity"
    )
    assert proof.parse_focus_component("mFocusedApp=ActivityRecord{456 u0 com.pucky.device.debug/com.pucky.device.MainActivity t18}") == (
        "com.pucky.device.debug/com.pucky.device.MainActivity"
    )


def test_ime_visibility_parser_accepts_input_method_and_insets_signals() -> None:
    assert proof.ime_visible_from_dumpsys("mInputShown=true\n") is True
    assert proof.ime_visible_from_dumpsys("InsetsSource id=3 type=ime frame=[0,0][100,200] visible=true\n") is True
    assert proof.ime_visible_from_dumpsys("mInputShown=false\nInsetsSource id=3 type=ime frame=[0,0][0,0] visible=false\n") is False


def test_find_keyboard_key_center_prefers_exact_text_nodes() -> None:
    xml_text = """
    <hierarchy>
      <node text="d" bounds="[10,20][50,60]" />
      <node text="a" bounds="[60,20][100,60]" />
      <node text="v" bounds="[110,20][150,60]" />
    </hierarchy>
    """

    assert proof.find_key_center_from_uiautomator(xml_text, "d") == (30, 40)
    assert proof.find_key_center_from_uiautomator(xml_text, "a") == (80, 40)
    assert proof.find_key_center_from_uiautomator(xml_text, "v") == (130, 40)


def test_contacts_browser_helper_contract_is_present() -> None:
    source = Path("tools/proofs/phone/phone_contacts_search_browser.js").read_text(encoding="utf-8")

    assert "installContactsTrace" in source
    assert "readContactsState" in source
    assert "searchInputCenter" in source
    assert "readContactsTrace" in source
