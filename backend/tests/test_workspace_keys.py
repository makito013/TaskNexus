"""Unit tests for the pure key helpers of the workspace registry."""
from __future__ import annotations

import pytest

from app.workspace_keys import (
    first_segment,
    has_reserved_segment,
    is_synthetic_key,
    make_project_key,
    make_workspace_key,
    same_workspace,
    scope_workspace_key,
    validate_key,
    workspace_key_of,
    workspace_scope_of,
)
from app.workspace_store import ProjectRow, WorkspaceRow, build_snapshot


def _ws(id_, key, archived=False):
    return WorkspaceRow(id_, key, key, "manual", 0.0, 0.0, 1.0 if archived else None)


def _pr(id_, key, workspace_id, archived=False):
    return ProjectRow(id_, key, workspace_id, key, "manual", 0.0, 0.0, 1.0 if archived else None)


@pytest.fixture
def snapshot():
    workspaces = [_ws(1, "Pessoal"), _ws(2, ".w2"), _ws(3, "Old", archived=True)]
    projects = [
        _pr(1, "Pessoal/tn", 1),
        _pr(2, ".w2/.p2", 2),
        _pr(3, "Old/x", 3, archived=True),
        _pr(4, "Pessoal/.p4", 1),
    ]
    return build_snapshot(workspaces, projects, [])


@pytest.mark.parametrize("key", [".w1", "Pessoal/.p3", ".w1/.p2"])
def test_is_synthetic_key_true(key):
    assert is_synthetic_key(key)


@pytest.mark.parametrize("key", ["Pessoal", "Pessoal/x", "a.b/c", "meu.projeto"])
def test_is_synthetic_key_false(key):
    assert not is_synthetic_key(key)


def test_make_keys():
    assert make_workspace_key(12) == ".w12"
    assert make_project_key("Pessoal", 37) == "Pessoal/.p37"
    assert make_project_key(".w12", 38) == ".w12/.p38"


def test_workspace_key_of_and_first_segment():
    assert workspace_key_of("Pessoal/tn/frontend") == "Pessoal"
    assert workspace_key_of("podesubir") == "podesubir"
    assert first_segment(".w12/.p38") == ".w12"


@pytest.mark.parametrize("key", [
    "", "a::b", "a\\b", "a\x00b", "a/../b", "a/./b", "a//b", "/a", "a/",
    ".x9", "Pessoal/.x9", ".w", ".p1x", "x" * 513,
])
def test_validate_key_rejects(key):
    with pytest.raises(ValueError):
        validate_key(key)


@pytest.mark.parametrize("key", [
    "Pessoal", "Pessoal/tn", "meu.projeto", ".w12", "Pessoal/.p37", ".w12/.p38", "x" * 512,
])
def test_validate_key_accepts(key):
    validate_key(key)


def test_scope_project_row_wins(snapshot):
    assert workspace_scope_of("Pessoal/tn", snapshot) == "ws:1"
    assert workspace_scope_of(".w2/.p2", snapshot) == "ws:2"


def test_scope_workspace_row(snapshot):
    assert workspace_scope_of("Pessoal", snapshot) == "ws:1"
    assert workspace_scope_of(".w2", snapshot) == "ws:2"


def test_scope_unknown_synthetic_only_equals_itself(snapshot):
    assert workspace_scope_of(".w99/.p1", snapshot) == "unknown:.w99/.p1"
    assert not same_workspace(".w99/.p1", ".w99/.p2", snapshot)
    assert same_workspace(".w99/.p1", ".w99/.p1", snapshot)


def test_scope_legacy_key_under_registered_workspace(snapshot):
    assert workspace_scope_of("Pessoal/discovered-later", snapshot) == "ws:1"


def test_scope_legacy_key_without_workspace(snapshot):
    assert workspace_scope_of("NewCo/x", snapshot) == "legacy:NewCo"
    assert same_workspace("NewCo/x", "NewCo/y", snapshot)
    assert not same_workspace("NewCo/x", "Other/y", snapshot)


def test_scope_archived_rows_still_count(snapshot):
    assert workspace_scope_of("Old/x", snapshot) == "ws:3"
    assert workspace_scope_of("Old/never-registered", snapshot) == "ws:3"
    assert same_workspace("Old/x", "Old", snapshot)


def test_same_workspace_across_workspaces_is_false(snapshot):
    assert not same_workspace("Pessoal/tn", ".w2/.p2", snapshot)
    assert same_workspace("Pessoal/tn", "Pessoal/.p4", snapshot)


def test_legacy_rule_equivalence_with_old_cliente_rule(snapshot):
    keys = ["Pessoal", "Pessoal/tn", "Pessoal/zzz", "Old/x", "NewCo/a", "NewCo", "solo"]
    for a in keys:
        for b in keys:
            assert same_workspace(a, b, snapshot) == (
                workspace_key_of(a) == workspace_key_of(b)
            ), (a, b)


def test_scope_workspace_key(snapshot):
    assert scope_workspace_key(".w2/.p2", snapshot) == ".w2"
    assert scope_workspace_key("Pessoal", snapshot) == "Pessoal"
    assert scope_workspace_key("Pessoal/unknown", snapshot) == "Pessoal"
    assert scope_workspace_key("NewCo/a", snapshot) == "NewCo"


@pytest.mark.parametrize("key", [".p5", "a/.b", ".w1/x", ".w1/.p2/x", "Pessoal/.hidden", "Pessoal/.p3", ".w1"])
def test_has_reserved_segment_is_true_for_any_dot_segment(key):
    assert has_reserved_segment(key) is True


@pytest.mark.parametrize("key", ["meu.projeto", "Pessoal", "Pessoal/tn-sandbox", "a.b/c.d", "podesubir/site"])
def test_has_reserved_segment_is_false_for_legacy_shaped_keys(key):
    assert has_reserved_segment(key) is False
