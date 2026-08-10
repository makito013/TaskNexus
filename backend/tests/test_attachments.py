"""Unit tests for backend/app/attachments.py — pure filesystem functions,
no FastAPI/TestClient involved (see test_attachments_endpoints.py for the
HTTP-level contract)."""
from __future__ import annotations

import os
import sys

import pytest

from app.attachments import (
    _is_within_directory,
    _sanitize_filename,
    _stream_to_disk,
    delete_attachment,
    list_attachments,
    save_attachments,
)


class _FakeUploadFile:
    """Mimics a FastAPI UploadFile: `.filename` plus an async `.read(n)`
    that serves pre-defined chunks from a list, ignoring the requested
    chunk size — same shape as _FakeUploadFile in test_image_validation.py."""

    def __init__(self, filename: str, chunks: list[bytes], content_type: str | None = None):
        self.filename = filename
        self.content_type = content_type
        self._chunks = list(chunks)
        self._index = 0

    async def read(self, chunk_size: int = -1) -> bytes:
        if self._index >= len(self._chunks):
            return b""
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk


class _FailingUploadFile:
    """Raises partway through reading — simulates a write failure mid-upload
    (e.g. a disconnected client) so save_attachments' cleanup path can be
    exercised."""

    def __init__(self, filename: str):
        self.filename = filename
        self.content_type = None
        self._reads = 0

    async def read(self, chunk_size: int = -1) -> bytes:
        self._reads += 1
        if self._reads == 1:
            return b"partial data"
        raise OSError("simulated read failure")


# -- _sanitize_filename --------------------------------------------------------


class TestSanitizeFilename:
    def test_rejects_path_traversal(self):
        assert _sanitize_filename("../etc/passwd") is None

    def test_rejects_forward_slash_separator(self):
        assert _sanitize_filename("sub/dir/file.txt") is None

    def test_rejects_backslash_separator(self):
        assert _sanitize_filename("sub\\dir\\file.txt") is None

    def test_rejects_empty_name(self):
        assert _sanitize_filename("") is None

    def test_rejects_null_byte(self):
        assert _sanitize_filename("file\x00.txt") is None

    def test_accepts_plain_filename(self):
        assert _sanitize_filename("report.pdf") == "report.pdf"

    def test_accepts_filename_with_spaces_and_unicode(self):
        assert _sanitize_filename("relatório final (v2).pdf") == "relatório final (v2).pdf"


# -- _stream_to_disk ------------------------------------------------------------


class TestStreamToDisk:
    @pytest.mark.asyncio
    async def test_writes_multiple_chunks_correctly(self, tmp_path):
        fake = _FakeUploadFile("f.bin", [b"a" * 10, b"b" * 20, b"c" * 5])
        dest = tmp_path / "out.bin"

        written = await _stream_to_disk(fake, str(dest), chunk_size=1024)

        assert written == 35
        assert dest.read_bytes() == b"a" * 10 + b"b" * 20 + b"c" * 5

    @pytest.mark.asyncio
    async def test_empty_file_writes_zero_bytes(self, tmp_path):
        fake = _FakeUploadFile("empty.bin", [])
        dest = tmp_path / "empty.bin"

        written = await _stream_to_disk(fake, str(dest))

        assert written == 0
        assert dest.read_bytes() == b""


# -- save_attachments -----------------------------------------------------------


class TestSaveAttachments:
    @pytest.mark.asyncio
    async def test_saves_single_file_and_reports_it(self, tmp_path):
        upload = _FakeUploadFile("notes.txt", [b"hello world"])

        result = await save_attachments(str(tmp_path), [upload])

        assert result.errors == []
        assert len(result.attachments) == 1
        saved = result.attachments[0]
        assert saved.original_name == "notes.txt"
        assert saved.size_bytes == len(b"hello world")
        assert os.path.isfile(saved.path)

    @pytest.mark.asyncio
    async def test_invalid_name_is_reported_as_error_not_exception(self, tmp_path):
        upload = _FakeUploadFile("../etc/passwd", [b"x"])

        result = await save_attachments(str(tmp_path), [upload])

        assert result.attachments == []
        assert len(result.errors) == 1
        assert result.errors[0]["original_name"] == "../etc/passwd"

    @pytest.mark.asyncio
    async def test_partial_batch_success_when_one_upload_is_invalid(self, tmp_path):
        good = _FakeUploadFile("good.txt", [b"ok"])
        bad = _FakeUploadFile("../bad.txt", [b"x"])

        result = await save_attachments(str(tmp_path), [good, bad])

        assert len(result.attachments) == 1
        assert result.attachments[0].original_name == "good.txt"
        assert len(result.errors) == 1
        assert result.errors[0]["original_name"] == "../bad.txt"

    @pytest.mark.asyncio
    async def test_removes_whole_folder_when_write_fails_midway(self, tmp_path):
        upload = _FailingUploadFile("boom.txt")

        result = await save_attachments(str(tmp_path), [upload])

        assert result.attachments == []
        assert len(result.errors) == 1

        attachments_root = tmp_path / ".escritorio" / "attachments"
        # No partial/corrupted attachment_id folder should survive the
        # failure — list_attachments must see nothing at all.
        assert list_attachments(str(tmp_path)) == []
        if attachments_root.is_dir():
            assert list(attachments_root.iterdir()) == []


# -- list_attachments ------------------------------------------------------------


class TestListAttachments:
    def test_returns_empty_list_when_attachments_dir_does_not_exist(self, tmp_path):
        assert list_attachments(str(tmp_path)) == []

    def test_lists_saved_attachments_sorted_by_uploaded_at_desc(self, tmp_path):
        # Two folders with distinct epoch-seconds prefixes, built directly
        # (not via save_attachments) so the ordering assertion doesn't
        # depend on both uploads landing in the same wall-clock second.
        attachments_root = tmp_path / ".escritorio" / "attachments"
        older_dir = attachments_root / "1000-aaaa"
        newer_dir = attachments_root / "2000-bbbb"
        older_dir.mkdir(parents=True)
        newer_dir.mkdir(parents=True)
        (older_dir / "first.txt").write_bytes(b"1")
        (newer_dir / "second.txt").write_bytes(b"2")

        listed = list_attachments(str(tmp_path))

        assert [a.original_name for a in listed] == ["second.txt", "first.txt"]

    def test_tolerates_a_folder_disappearing_mid_iteration(self, tmp_path, monkeypatch):
        attachments_root = tmp_path / ".escritorio" / "attachments"
        surviving_dir = attachments_root / "1111-aaaa"
        vanishing_dir = attachments_root / "2222-bbbb"
        surviving_dir.mkdir(parents=True)
        vanishing_dir.mkdir(parents=True)
        (surviving_dir / "keep.txt").write_bytes(b"kept")
        (vanishing_dir / "gone.txt").write_bytes(b"gone")

        real_listdir = os.listdir

        def _flaky_listdir(path):
            # Simulate the vanishing_dir being removed by a concurrent
            # delete right after the top-level os.listdir() already
            # returned its name, but before it's stat'd individually.
            if os.path.abspath(path) == os.path.abspath(str(vanishing_dir)):
                raise FileNotFoundError(path)
            return real_listdir(path)

        monkeypatch.setattr(os, "listdir", _flaky_listdir)

        listed = list_attachments(str(tmp_path))

        assert len(listed) == 1
        assert listed[0].original_name == "keep.txt"


# -- delete_attachment -----------------------------------------------------------


class TestDeleteAttachment:
    @pytest.mark.asyncio
    async def test_removes_the_attachment_folder(self, tmp_path):
        result = await save_attachments(str(tmp_path), [_FakeUploadFile("gone.txt", [b"x"])])
        attachment_id = result.attachments[0].id

        deleted = delete_attachment(str(tmp_path), attachment_id)

        assert deleted is True
        assert list_attachments(str(tmp_path)) == []

    def test_returns_false_for_unknown_id(self, tmp_path):
        assert delete_attachment(str(tmp_path), "does-not-exist") is False

    def test_returns_false_for_traversal_attempt_in_id(self, tmp_path):
        assert delete_attachment(str(tmp_path), "..") is False

    def test_returns_false_when_id_is_an_absolute_path_outside_the_project(self, tmp_path):
        # os.path.join(attachments_root, "/etc") collapses to "/etc" on
        # POSIX (an absolute 2nd argument discards the 1st entirely) —
        # exactly the same class of escape as the Windows drive-letter case
        # below, just via a different join() quirk. A substring blacklist of
        # ".."/"/"/"\\" would reject this outright (it contains "/"), so
        # this alone wouldn't have caught the original bug — the real
        # regression test is the Windows-specific one further down.
        outside_dir = tmp_path.parent / "not-this-project"
        outside_dir.mkdir(exist_ok=True)
        (outside_dir / "keep-me.txt").write_bytes(b"do not delete")

        assert delete_attachment(str(tmp_path), str(outside_dir)) is False
        assert (outside_dir / "keep-me.txt").exists()

    @pytest.mark.skipif(sys.platform != "win32", reason="drive-letter join() quirk is Windows-only")
    def test_returns_false_when_id_carries_a_drive_letter_escape(self, tmp_path):
        # The bug this regression-tests: os.path.join("C:\\proj\\attachments",
        # "D:\\evil") returns "D:\\evil" — the first argument is discarded
        # entirely once the second one starts with its own drive letter, so
        # naively os.path.join()-ing attachment_id onto attachments_root and
        # trusting the result stays under attachments_root is NOT safe on
        # Windows. A substring blacklist of ".."/"/"/"\\" does not contain
        # ":" and would have let this through (see review finding that
        # caught this before shipping).
        outside_dir = tmp_path.parent / "escaped-via-drive-letter"
        outside_dir.mkdir(exist_ok=True)
        (outside_dir / "keep-me.txt").write_bytes(b"do not delete")
        drive, _ = os.path.splitdrive(str(outside_dir))
        assert drive, "test setup assumes tmp_path lives on a lettered drive"

        assert delete_attachment(str(tmp_path), str(outside_dir)) is False
        assert (outside_dir / "keep-me.txt").exists()


class TestIsWithinDirectory:
    def test_true_for_a_real_subdirectory(self, tmp_path):
        child = tmp_path / "attachments" / "abc"
        child.mkdir(parents=True)
        assert _is_within_directory(str(tmp_path / "attachments"), str(child)) is True

    def test_false_for_the_base_dir_itself(self, tmp_path):
        assert _is_within_directory(str(tmp_path), str(tmp_path)) is False

    def test_false_for_a_sibling_directory(self, tmp_path):
        sibling = tmp_path.parent / "sibling-not-under-base"
        assert _is_within_directory(str(tmp_path), str(sibling)) is False

    def test_false_for_a_path_join_drive_letter_escape(self, tmp_path):
        # Mirrors the real bug: os.path.join() on the caller's side already
        # produced a path outside base_dir before this function ever runs —
        # confirms the containment check catches that shape regardless of
        # how the "escaped" path was constructed.
        base = os.path.join(str(tmp_path), "attachments")
        escaped = os.path.join(base, str(tmp_path.parent))
        assert _is_within_directory(base, escaped) is False
