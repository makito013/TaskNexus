from __future__ import annotations

"""Content of the Web Push notification for a finished session (Phase 3).

TWIN of `buildSessionNotification` in
frontend/src/utils/sessionNotifications.js — same deliberate pairing as
app/quiet_hours.py / frontend/src/utils/quietHours.js. Channel A (the sound +
Web Notification on the open tab) builds the text in the browser; channel B
(this one) builds it on the server, because a push has to carry its own text.
The two MUST produce identical output, or the same finished chat would be
described one way in the tab and another way on the phone.

The canonical case table is duplicated on both sides on purpose:
backend/tests/test_push_payload.py and
frontend/src/utils/sessionNotifications.test.js. Changing the text here
without changing it there is exactly the divergence those tables exist to
catch.

The user-visible strings stay in Portuguese: they're the product's language,
which is the documented exception to the English-only code convention.
"""

# Push services reject payloads over ~4KB, and the encrypted envelope adds
# overhead on top of the JSON. A body that long is a bug elsewhere (a
# display_name pasted from a whole document), but truncating is cheaper than
# losing the notification entirely.
MAX_BODY_LENGTH = 300


def _truncate(text: str, limit: int = MAX_BODY_LENGTH) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def build_push_payload(session_key: str, meta: dict | None = None) -> dict:
    """Payload delivered to the service worker's `push` listener.

    `tag` is the `session_key`: the Web Notification API itself implements
    the PO's "one notification per session" this way — a new notification
    with the same tag replaces the previous one instead of stacking.
    `data.session_key` is what the `notificationclick` handler deep-links
    with.
    """
    meta = meta or {}
    # projectId can contain '/' (sub-projects) but never '::', so the
    # positional split is safe. The third segment (the random suffix of a
    # second chat for the same agent) is left out of the text: it's noise.
    parts = str(session_key).split("::")
    project_id = parts[0] if parts else str(session_key)
    agent_id = parts[1] if len(parts) > 1 else None

    custom_name = (meta.get("display_name") or "").strip()
    label = custom_name or agent_id or session_key
    # The agent only appears next to the project when a custom name has
    # replaced it in the title — otherwise it would be repeated.
    location_parts = [project_id]
    if custom_name and agent_id:
        location_parts.append(agent_id)
    location = " · ".join(p for p in location_parts if p)

    return {
        "tag": session_key,
        "title": _truncate(f"{label} terminou"),
        "body": _truncate(f"Projeto {location}" if location else session_key),
        "data": {"session_key": session_key},
    }
