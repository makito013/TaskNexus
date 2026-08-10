"""Integration tests for POST/GET/DELETE /api/projects/{project_id}/attachments
(new feature — filesystem is the source of truth, no sessions.db table).

Same fixture pattern as test_cards_endpoints.py: reload of app.main with
PROJECTS_ROOT pointed at a tmp_path holding a fake project.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.fixture
def client(tmp_path):
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True)
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "BOARD_UPLOADS_ROOT": str(tmp_path / "board_uploads"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
    }):
        import importlib
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


def test_upload_single_file_returns_201_and_writes_it_to_disk(client, tmp_path):
    r = client.post(
        "/api/projects/meu-projeto/attachments",
        files={"files": ("report.pdf", b"pdf-bytes-here", "application/pdf")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["errors"] == []
    assert len(body["attachments"]) == 1

    attachment = body["attachments"][0]
    assert attachment["original_name"] == "report.pdf"
    assert attachment["size_bytes"] == len(b"pdf-bytes-here")

    import os
    assert os.path.isfile(attachment["path"])
    with open(attachment["path"], "rb") as f:
        assert f.read() == b"pdf-bytes-here"


def test_upload_multiple_files_returns_all_of_them(client):
    r = client.post(
        "/api/projects/meu-projeto/attachments",
        files=[
            ("files", ("a.txt", b"aaa", "text/plain")),
            ("files", ("b.txt", b"bbbb", "text/plain")),
        ],
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["errors"] == []
    names = {a["original_name"] for a in body["attachments"]}
    assert names == {"a.txt", "b.txt"}


def test_upload_to_nonexistent_project_returns_404(client):
    r = client.post(
        "/api/projects/nao-existe/attachments",
        files={"files": ("a.txt", b"x", "text/plain")},
    )
    assert r.status_code == 404


def test_get_attachments_reflects_the_filesystem(client):
    client.post(
        "/api/projects/meu-projeto/attachments",
        files={"files": ("notes.txt", b"note contents", "text/plain")},
    )

    r = client.get("/api/projects/meu-projeto/attachments")
    assert r.status_code == 200
    body = r.json()
    assert len(body["attachments"]) == 1
    assert body["attachments"][0]["original_name"] == "notes.txt"


def test_get_attachments_for_nonexistent_project_returns_404(client):
    r = client.get("/api/projects/nao-existe/attachments")
    assert r.status_code == 404


def test_delete_attachment_removes_its_folder(client, tmp_path):
    uploaded = client.post(
        "/api/projects/meu-projeto/attachments",
        files={"files": ("to-delete.txt", b"x", "text/plain")},
    ).json()["attachments"][0]

    r = client.delete(f"/api/projects/meu-projeto/attachments/{uploaded['id']}")
    assert r.status_code == 200

    remaining = client.get("/api/projects/meu-projeto/attachments").json()["attachments"]
    assert remaining == []

    import os
    assert not os.path.isdir(
        tmp_path / "meu-projeto" / ".escritorio" / "attachments" / uploaded["id"]
    )


def test_delete_unknown_attachment_returns_404(client):
    r = client.delete("/api/projects/meu-projeto/attachments/does-not-exist")
    assert r.status_code == 404


def test_delete_attachment_for_nonexistent_project_returns_404(client):
    r = client.delete("/api/projects/nao-existe/attachments/whatever")
    assert r.status_code == 404


def test_path_traversal_in_uploaded_filename_is_rejected_and_reported_not_fatal(client):
    r = client.post(
        "/api/projects/meu-projeto/attachments",
        files={"files": ("../etc/passwd", b"malicious", "text/plain")},
    )
    # The request itself never errors — a rejected file is reported in
    # `errors`, not a 4xx/5xx for the whole batch.
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["attachments"] == []
    assert len(body["errors"]) == 1
    assert body["errors"][0]["error"]

    listed = client.get("/api/projects/meu-projeto/attachments").json()
    assert listed["attachments"] == []


def test_path_traversal_filename_alongside_a_valid_file_is_partial_success(client):
    r = client.post(
        "/api/projects/meu-projeto/attachments",
        files=[
            ("files", ("good.txt", b"ok", "text/plain")),
            ("files", ("../bad.txt", b"bad", "text/plain")),
        ],
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["attachments"]) == 1
    assert body["attachments"][0]["original_name"] == "good.txt"
    assert len(body["errors"]) == 1
