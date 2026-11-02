"""Disk side of board card file attachments (CardStore only touches the
database, same split as card images).

Layout: `{root}/{card_id}/{attachment_id}/{original sanitized name}`. One
folder per attachment, so the route that serves it can pass that folder as the
"project root" to file_serving: neighbour resolution (`f/<path>`) can never
reach another attachment, and the original name (with its extension) drives
the kind/Content-Type detection and the download name.

`root` must NOT be the statically-mounted board_uploads/: an uploaded .html
there would run same-origin without the sandbox CSP that file_serving adds.
"""
from __future__ import annotations

import mimetypes
import os
import shutil
from typing import Any

from app.attachments import _sanitize_filename
from app.file_access import is_denied
from app.image_validation import UploadTooLargeError

_CHUNK_SIZE = 65536


def clean_filename(raw_name: str | None) -> str | None:
    """Disk-safe basename for an uploaded file, or None when the name is
    unusable: empty, path traversal, or a name the viewer refuses to serve
    (`.env`, keys, sqlite files…), which would be uploaded but never opened."""
    name = _sanitize_filename(raw_name or "")
    if name is None or name in (".", "..") or is_denied(name):
        return None
    return name


def guess_mime_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def attachment_dir(root: str, card_id: int, attachment_id: int) -> str:
    return os.path.join(root, str(card_id), str(attachment_id))


async def save_upload(upload: Any, dest_path: str, max_bytes: int) -> int:
    """Streams `upload` to `dest_path` in chunks (never the whole file in
    memory). Raises UploadTooLargeError past `max_bytes`; the caller removes
    the partial file. Returns the number of bytes written."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    total = 0
    with open(dest_path, "wb") as dest:
        while True:
            chunk = await upload.read(_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise UploadTooLargeError(f"Upload exceeds {max_bytes} bytes")
            dest.write(chunk)
    return total


def copy_file(src_path: str, dest_path: str, max_bytes: int) -> int:
    """Copies a file of the agent's project into an attachment folder.
    Synchronous (run it in a thread). Raises UploadTooLargeError past
    `max_bytes`, checked before copying anything."""
    size = os.path.getsize(src_path)
    if size > max_bytes:
        raise UploadTooLargeError(f"File exceeds {max_bytes} bytes")
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    shutil.copyfile(src_path, dest_path)
    return size


def remove_attachment_dir(root: str, card_id: int, attachment_id: int) -> None:
    """Best effort: a leftover folder is harmless (the row is the source of
    truth for what the card lists)."""
    shutil.rmtree(attachment_dir(root, card_id, attachment_id), ignore_errors=True)
    _remove_if_empty(os.path.join(root, str(card_id)))


def remove_card_dir(root: str, card_id: int) -> None:
    shutil.rmtree(os.path.join(root, str(card_id)), ignore_errors=True)


def _remove_if_empty(path: str) -> None:
    try:
        os.rmdir(path)
    except OSError:
        pass
