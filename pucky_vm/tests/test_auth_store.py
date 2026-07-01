from __future__ import annotations

from pathlib import Path

import pytest

from pucky_vm.auth_store import AuthStore


LEGACY_EMAIL = "jimmythompson323@gmail.com"
LEGACY_MARKER = "legacy_jimmy_root_workspace_v1"
LEGACY_APP_USER_ID = "jimmythompson323"
LEGACY_WORKSPACE_ID = "ws_jimmythompson323"
LEGACY_WORKSPACE_SLUG = "jimmythompson323"


def make_store(tmp_path: Path) -> AuthStore:
    return AuthStore(tmp_path / "auth.sqlite3")


def ensure_binding(store: AuthStore, *, clerk_user_id: str, primary_email: str) -> dict[str, str]:
    return store.ensure_binding(
        clerk_user_id=clerk_user_id,
        primary_email=primary_email,
        legacy_claim_email=LEGACY_EMAIL,
        legacy_claim_marker=LEGACY_MARKER,
        legacy_app_user_id=LEGACY_APP_USER_ID,
        legacy_workspace_id=LEGACY_WORKSPACE_ID,
        legacy_workspace_slug=LEGACY_WORKSPACE_SLUG,
    )


def test_auth_store_claims_legacy_workspace_once_for_exact_jimmy_email(tmp_path: Path) -> None:
    store = make_store(tmp_path)

    binding = ensure_binding(
        store,
        clerk_user_id="user_legacy_jimmy",
        primary_email=LEGACY_EMAIL,
    )

    assert binding["clerk_user_id"] == "user_legacy_jimmy"
    assert binding["app_user_id"] == LEGACY_APP_USER_ID
    assert binding["workspace_id"] == LEGACY_WORKSPACE_ID
    assert binding["workspace_slug"] == LEGACY_WORKSPACE_SLUG
    assert binding["legacy_claim_marker"] == LEGACY_MARKER
    assert binding["legacy_workspace_migrated_at"] == ""

    store.mark_legacy_workspace_migrated(LEGACY_WORKSPACE_ID)
    migrated = store.get_binding("user_legacy_jimmy")
    assert migrated is not None
    assert migrated["legacy_workspace_migrated_at"].endswith("Z")

    with pytest.raises(ValueError, match="legacy_workspace_already_claimed"):
        ensure_binding(
            store,
            clerk_user_id="user_someone_else",
            primary_email=LEGACY_EMAIL,
        )


def test_auth_store_treats_plus_aliases_as_distinct_non_legacy_users(tmp_path: Path) -> None:
    store = make_store(tmp_path)

    legacy = ensure_binding(
        store,
        clerk_user_id="user_legacy_jimmy",
        primary_email=LEGACY_EMAIL,
    )
    qa_a = ensure_binding(
        store,
        clerk_user_id="user_qa_a",
        primary_email="jimmythompson323+qa-a@gmail.com",
    )
    qa_b = ensure_binding(
        store,
        clerk_user_id="user_qa_b",
        primary_email="jimmythompson323+qa-b@gmail.com",
    )

    assert qa_a["workspace_id"] != legacy["workspace_id"]
    assert qa_b["workspace_id"] != legacy["workspace_id"]
    assert qa_a["workspace_id"] != qa_b["workspace_id"]
    assert qa_a["app_user_id"] != qa_b["app_user_id"]
    assert qa_a["legacy_claim_marker"] == ""
    assert qa_b["legacy_claim_marker"] == ""
    assert qa_a["workspace_slug"].startswith("jimmythompson323-qa-a-")
    assert qa_b["workspace_slug"].startswith("jimmythompson323-qa-b-")

    repeated = ensure_binding(
        store,
        clerk_user_id="user_qa_a",
        primary_email="JimmyThompson323+QA-A@gmail.com",
    )
    assert repeated["workspace_id"] == qa_a["workspace_id"]
    assert repeated["app_user_id"] == qa_a["app_user_id"]
    assert repeated["primary_email"] == "jimmythompson323+qa-a@gmail.com"
