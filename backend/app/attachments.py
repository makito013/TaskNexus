"""Per-project attachments — filesystem is the sole source of truth (no
table in sessions.db). Same spirit as agent_discovery.py: pure functions
over the filesystem, no network I/O. Disk I/O (reading an upload stream,
writing/removing files) is expected and unavoidable here — "no network I/O"
only rules out anything like HTTP calls, not local file access.

Layout on disk: `{project_path}/.escritorio/attachments/{attachment_id}/`,
each such folder holding exactly one file (the attachment itself, under its
original — sanitized — name). `attachment_id` doubles as an encoded
creation timestamp (`f"{int(time.time())}-{secrets.token_hex(4)}"`), which
lets `list_attachments` recover `uploaded_at` without needing a metadata
sidecar file.
"""
from __future__ import annotations

import mimetypes
import os
import secrets
import shutil
import time
from datetime import datetime
from typing import Any

from app.models import Attachment, AttachmentUploadResult

_ATTACHMENTS_DIRNAME = os.path.join(".escritorio", "attachments")


def _is_within_directory(base_dir: str, target_dir: str) -> bool:
    """True only if `target_dir` resolves to somewhere strictly inside
    `base_dir` — both sides run through os.path.realpath() first, so
    drive letters, ".." segments, symlinks and relative fragments all
    collapse to the same canonical form before comparing. This is the
    actual containment check; a substring blacklist (an earlier version
    of this module used one) only approximates it and misses
    platform-specific escapes — e.g. on Windows, os.path.join() silently
    drops everything before a component that itself carries a drive
    letter ("C:\\attachments" joined with "D:\\evil" yields "D:\\evil",
    not a path under attachments/ at all), which no blacklist of
    characters like ".."/"/" catches. os.path.commonpath() raises
    ValueError when the two paths don't even share a drive — that case is
    "not contained", not an error, from this function's point of view."""
    base_real = os.path.realpath(base_dir)
    target_real = os.path.realpath(target_dir)
    try:
        common = os.path.commonpath([base_real, target_real])
    except ValueError:
        return False
    return common == base_real and target_real != base_real


# Checked against the RAW name received from the client, before
# os.path.basename() is applied — basename() alone would silently reduce a
# traversal attempt like "../etc/passwd" down to a harmless-looking
# "passwd" and let it through. Rejecting outright on any of these
# substrings is stricter, and matches the product decision to surface a
# traversal attempt as a reported error rather than quietly rewriting it —
# unrelated to, and not a substitute for, _is_within_directory() above
# (that one guards path CONTAINMENT for server-generated/untrusted path
# segments like attachment_id; this one is a stricter-than-necessary,
# deliberately conservative content policy for client-supplied filenames).
_FORBIDDEN_NAME_SUBSTRINGS = ("..", "/", "\\", "\x00")


def _sanitize_filename(original_name: str) -> str | None:
    """Reduces a raw upload filename to a bare, disk-safe basename, or
    returns None if the name is invalid (empty, contains a path separator,
    a ".." segment, or a null byte). Callers treat None as "reject this one
    upload, keep processing the rest of the batch" — never an exception."""
    if not original_name:
        return None
    if any(token in original_name for token in _FORBIDDEN_NAME_SUBSTRINGS):
        return None
    basename = os.path.basename(original_name)
    if not basename:
        return None
    return basename


def _guess_content_type(filename: str) -> str | None:
    return mimetypes.guess_type(filename)[0]


def _uploaded_at_from_attachment_id(attachment_id: str) -> str:
    """Recovers the ISO 8601 creation timestamp encoded in the
    attachment_id's epoch-seconds prefix (see save_attachments). Falls back
    to epoch 0 for any id that doesn't match the expected shape, rather
    than raising — list_attachments must never break on a malformed/foreign
    directory that ended up under attachments/."""
    epoch_str, _, _ = attachment_id.partition("-")
    try:
        epoch = int(epoch_str)
    except ValueError:
        epoch = 0
    return datetime.fromtimestamp(epoch).isoformat()


async def _stream_to_disk(file: Any, dest_path: str, chunk_size: int = 65536) -> int:
    """Reads `file` (any object with an async `.read(chunk_size)`, like a
    FastAPI/Starlette UploadFile) in chunks and writes each one straight to
    `dest_path`, never accumulating chunks in memory — this is the key
    difference from image_validation.validate_upload_stream, which buffers
    the whole file in RAM (fine for its 5MB card-image cap, wrong for
    attachments, which have no size limit by design). Returns the total
    number of bytes written."""
    total_bytes = 0
    with open(dest_path, "wb") as dest_file:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            dest_file.write(chunk)
            total_bytes += len(chunk)
    return total_bytes


def list_attachments(project_path: str) -> list[Attachment]:
    """Lists every attachment for a project by scanning
    `{project_path}/.escritorio/attachments/*/` — one subfolder per
    attachment_id, one file per subfolder. Ordered by uploaded_at desc.

    Tolerant to a subfolder disappearing between the os.listdir() below and
    the moment a given entry is stat'd (concurrent delete) — that single
    entry is skipped, the rest of the listing still completes. Same
    defensive pattern as card_store.py's delete_image / the card-image
    routes in main.py, applied here to a directory scan instead of a DB
    row."""
    attachments_root = os.path.join(project_path, _ATTACHMENTS_DIRNAME)
    try:
        attachment_ids = os.listdir(attachments_root)
    except FileNotFoundError:
        return []

    attachments: list[Attachment] = []
    for attachment_id in attachment_ids:
        attachment_dir = os.path.join(attachments_root, attachment_id)
        try:
            filenames = os.listdir(attachment_dir)
            if not filenames:
                continue
            original_name = filenames[0]
            file_path = os.path.join(attachment_dir, original_name)
            size_bytes = os.path.getsize(file_path)
        except FileNotFoundError:
            continue

        attachments.append(Attachment(
            id=attachment_id,
            original_name=original_name,
            size_bytes=size_bytes,
            uploaded_at=_uploaded_at_from_attachment_id(attachment_id),
            content_type=_guess_content_type(original_name),
            path=os.path.abspath(file_path),
        ))

    attachments.sort(key=lambda a: a.uploaded_at, reverse=True)
    return attachments


async def save_attachments(project_path: str, uploads: list[Any]) -> AttachmentUploadResult:
    """Saves each upload under its own `{attachment_id}/` folder. A failure
    on any single upload (invalid name, or any exception while writing to
    disk) never aborts the batch — it removes that upload's own
    (possibly-partial) folder if one was created, records the failure in
    `errors`, and moves on to the next upload. Never leaves a partial or
    corrupted folder listable afterwards."""
    attachments: list[Attachment] = []
    errors: list[dict] = []

    for upload in uploads:
        original_name = upload.filename or ""
        sanitized_name = _sanitize_filename(original_name)
        if sanitized_name is None:
            errors.append({
                "original_name": original_name,
                "error": "Invalid file name",
            })
            continue

        attachment_id = f"{int(time.time())}-{secrets.token_hex(4)}"
        attachments_root = os.path.join(project_path, _ATTACHMENTS_DIRNAME)
        attachment_dir = os.path.join(attachments_root, attachment_id)
        dest_path = os.path.join(attachment_dir, sanitized_name)

        # Defense in depth: attachment_id is server-generated and
        # sanitized_name has already been through _sanitize_filename above,
        # so dest_path should always land inside attachments_root — this
        # just makes that invariant a hard stop instead of an assumption,
        # at negligible cost, mirroring the same check delete_attachment()
        # relies on for its untrusted (client-supplied) attachment_id.
        if not _is_within_directory(attachments_root, dest_path):
            errors.append({
                "original_name": original_name,
                "error": "Invalid file name",
            })
            continue

        try:
            os.makedirs(attachment_dir, exist_ok=True)
            size_bytes = await _stream_to_disk(upload, dest_path)
        except Exception as e:
            shutil.rmtree(attachment_dir, ignore_errors=True)
            errors.append({
                "original_name": original_name,
                "error": str(e),
            })
            continue

        attachments.append(Attachment(
            id=attachment_id,
            original_name=sanitized_name,
            size_bytes=size_bytes,
            uploaded_at=_uploaded_at_from_attachment_id(attachment_id),
            content_type=_guess_content_type(sanitized_name),
            path=os.path.abspath(dest_path),
        ))

    return AttachmentUploadResult(attachments=attachments, errors=errors)


def delete_attachment(project_path: str, attachment_id: str) -> bool:
    """Removes an attachment's whole folder. Returns False (caller decides
    whether that means 404) when `attachment_id` doesn't resolve to a real
    subfolder actually contained within attachments/ — `attachment_id`
    arrives here as a raw, untrusted URL path segment, so this is checked
    via _is_within_directory() (real containment after resolving both
    paths), not a substring blacklist: a blacklist of "..", "/", "\\" still
    lets an id like "D:\\Users\\bruno\\Documents" through on Windows,
    because os.path.join() silently discards the "{project}/.escritorio/
    attachments" prefix once it hits a component that itself starts with a
    drive letter — the result is a path OUTSIDE attachments/ entirely, and
    the old blacklist had no rule for that shape at all. Found in review
    before shipping; see test_delete_rejects_drive_letter_escape_on_windows."""
    attachments_root = os.path.join(project_path, _ATTACHMENTS_DIRNAME)
    attachment_dir = os.path.join(attachments_root, attachment_id)

    if not _is_within_directory(attachments_root, attachment_dir):
        return False
    if not os.path.isdir(attachment_dir):
        return False

    shutil.rmtree(attachment_dir, ignore_errors=True)
    return True
