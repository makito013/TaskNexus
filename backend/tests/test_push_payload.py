"""Canonical case table for build_push_payload (Phase 3, Task 4).

Deliberately MIRRORS the `buildSessionNotification` block in
frontend/src/utils/sessionNotifications.test.js, case for case — the two
implementations are twins and this pair of tables is the only thing stopping
them from silently drifting apart (Risk R-9).
"""
from app.push_payload import MAX_BODY_LENGTH, build_push_payload


def test_tag_is_the_session_key_so_one_session_never_stacks_two_notifications():
    assert build_push_payload("meu-projeto::claude")["tag"] == "meu-projeto::claude"


def test_identifies_agent_and_project_when_there_is_no_custom_name():
    payload = build_push_payload("meu-projeto::claude", {"display_name": None})
    assert payload["title"] == "claude terminou"
    assert payload["body"] == "Projeto meu-projeto"


def test_prefers_the_custom_name_and_still_says_which_agent_project_finished():
    payload = build_push_payload("meu-projeto::claude-work", {"display_name": "Bugfix urgente"})
    assert payload["title"] == "Bugfix urgente terminou"
    assert payload["body"] == "Projeto meu-projeto · claude-work"


def test_ignores_the_random_suffix_of_a_second_chat_of_the_same_agent():
    payload = build_push_payload("meu-projeto::claude::x7f2ab")
    assert payload["title"] == "claude terminou"
    assert payload["body"] == "Projeto meu-projeto"


def test_keeps_sub_project_paths_intact_in_the_body():
    assert build_push_payload("cliente/site::claude")["body"] == "Projeto cliente/site"


def test_a_key_without_a_separator_falls_back_to_the_whole_key():
    # Matches the JS twin's behaviour exactly: destructuring there leaves
    # agentId undefined, so the label IS the whole key and the location is
    # also the whole key.
    payload = build_push_payload("sem-separador")
    assert payload["title"] == "sem-separador terminou"
    assert payload["body"] == "Projeto sem-separador"


def test_a_blank_custom_name_is_treated_as_no_custom_name():
    payload = build_push_payload("meu-projeto::claude", {"display_name": "   "})
    assert payload["title"] == "claude terminou"
    assert payload["body"] == "Projeto meu-projeto"


def test_missing_meta_is_tolerated():
    assert build_push_payload("meu-projeto::claude")["title"] == "claude terminou"


# ─── Push-specific fields (no JS counterpart) ──────────────────────────────


def test_data_carries_the_session_key_for_the_deep_link():
    payload = build_push_payload("meu-projeto::claude")
    assert payload["data"] == {"session_key": "meu-projeto::claude"}


def test_an_absurdly_long_custom_name_is_truncated_instead_of_blowing_the_payload():
    payload = build_push_payload("p::a", {"display_name": "x" * 5000})
    assert len(payload["title"]) == MAX_BODY_LENGTH
    assert payload["title"].endswith("…")
