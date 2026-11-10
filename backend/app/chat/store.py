"""SQLite persistence of the V3 chat: sessions, the event log, permission
requests and the per-agent connector settings.

Same pattern as CardStore/WorkspaceStore: its own aiosqlite connection on the
shared `sessions.db`, WAL + busy_timeout, `CREATE TABLE IF NOT EXISTS`, no
declarative foreign keys (`chat_sessions.session_key` is a logical reference to
`sessions.session_key`) and an `asyncio.Lock` around every write.

The event log is the source of truth of a conversation: `append_event` assigns
the next `seq` and writes the event in ONE transaction, so readers can rely on
`seq` being gapless per session.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time

import aiosqlite

logger = logging.getLogger(__name__)

# An event payload above this is replaced by a marker (the conversation keeps
# its shape, the log keeps its size).
MAX_EVENT_PAYLOAD_BYTES = 256 * 1024
# Tool input kept on a permission card.
MAX_PERMISSION_INPUT_BYTES = 64 * 1024
MAX_EVENTS_PAGE = 1000

_SESSION_UPDATABLE = frozenset({
    "project_ref", "agent_id", "cli_path", "cli_version", "cwd", "add_dirs",
    "model", "permission_mode", "status", "last_error", "origin",
    "runtime_owner_pid",
})
_PERMISSION_FINAL_STATUSES = frozenset({"allowed", "denied", "expired", "cancelled"})
_AGENT_SETTINGS_FIELDS = frozenset({"mcp_allowlist", "known_connectors", "connectors_probed_at"})

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS chat_sessions (
        session_key        TEXT PRIMARY KEY,
        project_ref        TEXT NOT NULL,
        agent_id           TEXT NOT NULL,
        cli_path           TEXT,
        cli_version        TEXT,
        cwd                TEXT NOT NULL,
        add_dirs           TEXT NOT NULL DEFAULT '[]',
        model              TEXT,
        permission_mode    TEXT NOT NULL DEFAULT 'default',
        status             TEXT NOT NULL DEFAULT 'new',
        last_error         TEXT,
        last_seq           INTEGER NOT NULL DEFAULT 0,
        origin             TEXT NOT NULL DEFAULT 'chat',
        runtime_owner_pid  INTEGER,
        created_at         REAL NOT NULL,
        updated_at         REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_ref)",
    """
    CREATE TABLE IF NOT EXISTS chat_events (
        session_key TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        ts          REAL NOT NULL,
        kind        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        PRIMARY KEY (session_key, seq)
    ) WITHOUT ROWID
    """,
    """
    CREATE TABLE IF NOT EXISTS permission_requests (
        id           TEXT PRIMARY KEY,
        session_key  TEXT NOT NULL,
        tool_use_id  TEXT,
        kind         TEXT NOT NULL,
        tool_name    TEXT NOT NULL,
        input        TEXT NOT NULL,
        suggestions  TEXT NOT NULL DEFAULT '[]',
        connector    TEXT,
        status       TEXT NOT NULL,
        decision     TEXT,
        decided_by   TEXT,
        created_at   REAL NOT NULL,
        decided_at   REAL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_permission_requests_session_status "
    "ON permission_requests(session_key, status)",
    """
    CREATE TABLE IF NOT EXISTS agent_chat_settings (
        agent_id             TEXT PRIMARY KEY,
        mcp_allowlist        TEXT NOT NULL DEFAULT '[]',
        known_connectors     TEXT NOT NULL DEFAULT '[]',
        connectors_probed_at REAL,
        updated_at           REAL NOT NULL
    )
    """,
)


def _session_from_row(row: aiosqlite.Row) -> dict:
    data = dict(row)
    data["add_dirs"] = json.loads(data["add_dirs"])
    data["last_error"] = json.loads(data["last_error"]) if data["last_error"] else None
    return data


def _permission_from_row(row: aiosqlite.Row) -> dict:
    data = dict(row)
    data["input"] = json.loads(data["input"])
    data["suggestions"] = json.loads(data["suggestions"])
    data["decision"] = json.loads(data["decision"]) if data["decision"] else None
    return data


class _Transaction:
    """Callbacks to run once the commit of a write is durable."""

    def __init__(self) -> None:
        self.callbacks: list = []

    def after_commit(self, callback) -> None:
        self.callbacks.append(callback)


def _clean(text: str) -> str:
    """Text SQLite can bind: a lone surrogate (it cannot be UTF-8 encoded) becomes `?`."""
    return text.encode("utf-8", "replace").decode("utf-8")


class ChatStore:
    # Seconds a commit may take once dispatched; SQLite's own busy_timeout is 5 s.
    commit_grace = 8.0

    def __init__(self, db_path: str = "sessions.db"):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        # One lock for every write (and for the read that must be consistent with
        # them): a single connection shares its transaction state between tasks.
        self._tx_lock = asyncio.Lock()

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self.db_path)
        self._conn.row_factory = aiosqlite.Row
        try:
            await self._conn.execute("PRAGMA journal_mode=WAL")
        except aiosqlite.OperationalError:
            pass
        await self._conn.execute("PRAGMA busy_timeout=5000")
        for statement in _SCHEMA:
            await self._conn.execute(statement)
        await self._conn.commit()

    @contextlib.asynccontextmanager
    async def _write(self):
        """Lock + transaction for one write. Commits when the block ends; rolls back on any
        exit by exception, cancellation included (a transaction left open on the shared
        connection would keep SQLite's write lock and block every other store of
        `sessions.db`).

        The commit itself is shielded from cancellation (O13): once it has been dispatched
        it finishes, and whatever the row's new state means outside the database (a decision
        somebody is waiting on, an event readers must see) is delivered by the callbacks the
        block registered with `tx.after_commit(fn)`, which run right after the commit and
        even when the caller was cancelled meanwhile. The caller still gets its
        CancelledError afterwards. A commit that has not finished after `commit_grace`
        seconds is abandoned and rolled back."""
        tx = _Transaction()
        async with self._tx_lock:
            try:
                yield tx
            except BaseException:
                await self._conn.rollback()
                raise
            await self._commit_shielded(tx)

    async def _commit_shielded(self, tx: "_Transaction") -> None:
        loop = asyncio.get_running_loop()
        commit = asyncio.ensure_future(self._conn.commit())
        cancelled: asyncio.CancelledError | None = None
        deadline = loop.time() + self.commit_grace
        while not commit.done():
            try:
                await asyncio.wait({commit}, timeout=max(0.0, deadline - loop.time()))
            except asyncio.CancelledError as exc:
                # The caller was cancelled with the commit in flight: let it finish.
                cancelled = exc
                continue
            if not commit.done():
                break
        if not commit.done():
            commit.cancel()
            await self._conn.rollback()
            raise cancelled or TimeoutError("sqlite commit did not finish in time")
        try:
            commit.result()
        except BaseException:
            await self._conn.rollback()
            raise
        for callback in tx.callbacks:
            try:
                callback()
            except Exception:  # noqa: BLE001 - a delivery callback must not undo a commit
                logger.exception("chat store: after-commit callback failed")
        if cancelled is not None:
            raise cancelled

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None

    # -- chat_sessions ---------------------------------------------------------------

    async def create_chat_session(self, row: dict) -> None:
        """Insert a session. Required: session_key, project_ref, agent_id, cwd.
        `add_dirs` is a list and `last_error` a dict (or None); both are stored as JSON."""
        now = time.time()
        values = {
            "session_key": row["session_key"],
            "project_ref": row["project_ref"],
            "agent_id": row["agent_id"],
            "cli_path": row.get("cli_path"),
            "cli_version": row.get("cli_version"),
            "cwd": row["cwd"],
            "add_dirs": json.dumps(row.get("add_dirs") or []),
            "model": row.get("model"),
            "permission_mode": row.get("permission_mode", "default"),
            "status": row.get("status", "new"),
            "last_error": json.dumps(row["last_error"]) if row.get("last_error") else None,
            "origin": row.get("origin", "chat"),
            "runtime_owner_pid": row.get("runtime_owner_pid"),
            "created_at": row.get("created_at", now),
            "updated_at": row.get("updated_at", now),
        }
        columns = ", ".join(values)
        marks = ", ".join("?" for _ in values)
        async with self._write():
            await self._conn.execute(
                f"INSERT INTO chat_sessions ({columns}) VALUES ({marks})",
                tuple(values.values()),
            )

    async def get_chat_session(self, session_key: str) -> dict | None:
        async with self._conn.execute(
            "SELECT * FROM chat_sessions WHERE session_key = ?", (session_key,)
        ) as cursor:
            row = await cursor.fetchone()
        return _session_from_row(row) if row else None

    async def list_chat_sessions(self, project_ref: str | None = None) -> list[dict]:
        query = "SELECT * FROM chat_sessions"
        params: tuple = ()
        if project_ref is not None:
            query += " WHERE project_ref = ?"
            params = (project_ref,)
        query += " ORDER BY created_at, session_key"
        async with self._conn.execute(query, params) as cursor:
            return [_session_from_row(row) async for row in cursor]

    async def update_chat_session(self, session_key: str, **fields) -> None:
        """Update the given columns and bump `updated_at`. `last_seq` is owned by
        append_event and cannot be set here."""
        unknown = set(fields) - _SESSION_UPDATABLE
        if unknown:
            raise ValueError(f"cannot update chat_sessions columns: {sorted(unknown)}")
        if not fields:
            return
        values = dict(fields)
        if "add_dirs" in values:
            values["add_dirs"] = json.dumps(values["add_dirs"] or [])
        if "last_error" in values:
            values["last_error"] = json.dumps(values["last_error"]) if values["last_error"] else None
        values["updated_at"] = time.time()
        assignments = ", ".join(f"{name} = ?" for name in values)
        async with self._write():
            await self._conn.execute(
                f"UPDATE chat_sessions SET {assignments} WHERE session_key = ?",
                (*values.values(), session_key),
            )

    # -- chat_events -------------------------------------------------------------------

    async def append_event(
        self, session_key: str, kind: str, payload: dict, on_committed=None
    ) -> tuple[int, float]:
        """Append one event: next seq = chat_sessions.last_seq + 1; both writes in
        ONE transaction under the lock. Returns (seq, ts).

        `on_committed(seq, ts)` runs as soon as the event is durable, even when the caller
        is cancelled at that very moment (the caller then gets CancelledError and no
        return value): it is how the event reaches live readers in that case."""
        encoded = _clean(json.dumps(payload, ensure_ascii=False))
        if len(encoded.encode("utf-8")) > MAX_EVENT_PAYLOAD_BYTES:
            # Log the fact, never the content.
            logger.warning("chat event payload too large; replaced (kind=%s)", kind)
            encoded = json.dumps({"truncated": True, "kind": kind})
        ts = time.time()
        async with self._write() as tx:
            cursor = await self._conn.execute(
                "UPDATE chat_sessions SET last_seq = last_seq + 1, updated_at = ? "
                "WHERE session_key = ?",
                (ts, session_key),
            )
            if cursor.rowcount != 1:
                raise LookupError(f"unknown chat session: {session_key}")
            async with self._conn.execute(
                "SELECT last_seq FROM chat_sessions WHERE session_key = ?", (session_key,)
            ) as read:
                seq = (await read.fetchone())["last_seq"]
            await self._conn.execute(
                "INSERT INTO chat_events (session_key, seq, ts, kind, payload) "
                "VALUES (?, ?, ?, ?, ?)",
                (session_key, seq, ts, kind, encoded),
            )
            if on_committed is not None:
                tx.after_commit(lambda: on_committed(seq, ts))
        return seq, ts

    async def events_since(
        self, session_key: str, since: int, limit: int
    ) -> tuple[list[dict], int, bool]:
        """Events with seq > since, oldest first, at most `limit` (capped at 1000).
        Returns (events, last_seq of the session, has_more)."""
        limit = max(1, min(limit, MAX_EVENTS_PAGE))
        async with self._tx_lock:
            async with self._conn.execute(
                "SELECT seq, ts, kind, payload FROM chat_events "
                "WHERE session_key = ? AND seq > ? ORDER BY seq LIMIT ?",
                (session_key, since, limit + 1),
            ) as cursor:
                rows = await cursor.fetchall()
            async with self._conn.execute(
                "SELECT last_seq FROM chat_sessions WHERE session_key = ?", (session_key,)
            ) as cursor:
                session = await cursor.fetchone()
        has_more = len(rows) > limit
        events = [
            {"seq": r["seq"], "ts": r["ts"], "kind": r["kind"], "payload": json.loads(r["payload"])}
            for r in rows[:limit]
        ]
        return events, (session["last_seq"] if session else 0), has_more

    async def has_event_kind(self, session_key: str, kinds: tuple[str, ...]) -> bool:
        marks = ", ".join("?" for _ in kinds)
        async with self._conn.execute(
            f"SELECT 1 FROM chat_events WHERE session_key = ? AND kind IN ({marks}) LIMIT 1",
            (session_key, *kinds),
        ) as cursor:
            return await cursor.fetchone() is not None

    async def started_since_last_reset(self, session_key: str, kinds: tuple[str, ...]) -> bool:
        """Is there an event of one of `kinds` after the last `session.reset`? A reset gives the
        conversation a new id that no transcript knows yet."""
        marks = ", ".join("?" for _ in kinds)
        async with self._conn.execute(
            f"SELECT 1 FROM chat_events WHERE session_key = ? AND kind IN ({marks}) AND seq > "
            "COALESCE((SELECT MAX(seq) FROM chat_events WHERE session_key = ? AND kind = 'session.reset'), 0) "
            "LIMIT 1",
            (session_key, *kinds, session_key),
        ) as cursor:
            return await cursor.fetchone() is not None

    async def imported_since_last_reset(self, session_key: str) -> bool:
        """Did a history import that brought messages happen after the last `session.reset`?
        It proves the CLI knows the stored id (a transcript was read for it)."""
        async with self._conn.execute(
            "SELECT payload FROM chat_events WHERE session_key = ? AND kind = 'history.imported' AND seq > "
            "COALESCE((SELECT MAX(seq) FROM chat_events WHERE session_key = ? AND kind = 'session.reset'), 0)",
            (session_key, session_key),
        ) as cursor:
            async for row in cursor:
                if (json.loads(row["payload"]).get("count") or 0) > 0:
                    return True
        return False

    async def logged_conversation(self, session_key: str) -> dict:
        """What the log already holds of the conversation, to deduplicate a history import:
        `assistant_ids` (message ids), `tool_use_ids` (of logged tool results) and
        `trailing_user_texts` (the user messages after the last assistant message)."""
        assistant_ids: set[str] = set()
        tool_use_ids: set[str] = set()
        trailing: list[str] = []
        async with self._conn.execute(
            "SELECT kind, payload FROM chat_events WHERE session_key = ? AND kind IN "
            "('message.user', 'message.assistant', 'tool.result') ORDER BY seq",
            (session_key,),
        ) as cursor:
            async for row in cursor:
                payload = json.loads(row["payload"])
                if row["kind"] == "message.assistant":
                    if payload.get("message_id"):
                        assistant_ids.add(payload["message_id"])
                    trailing = []
                elif row["kind"] == "tool.result":
                    if payload.get("tool_use_id"):
                        tool_use_ids.add(payload["tool_use_id"])
                else:
                    trailing.append(payload.get("text") or "")
        return {"assistant_ids": assistant_ids, "tool_use_ids": tool_use_ids,
                "trailing_user_texts": trailing}

    # -- permission_requests -----------------------------------------------------------

    async def create_permission(self, row: dict) -> None:
        """Insert a pending request. Required: id, session_key, kind, tool_name.
        `input` (dict) is capped at 64 KB and `suggestions` (list) must already be
        sanitised by the permission policy."""
        encoded_input = _clean(json.dumps(row.get("input") or {}, ensure_ascii=False))
        if len(encoded_input.encode("utf-8")) > MAX_PERMISSION_INPUT_BYTES:
            encoded_input = json.dumps({"truncated": True})
        async with self._write():
            await self._conn.execute(
                "INSERT INTO permission_requests (id, session_key, tool_use_id, kind, "
                "tool_name, input, suggestions, connector, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row["id"], row["session_key"], row.get("tool_use_id"), row["kind"],
                    row["tool_name"], encoded_input,
                    json.dumps(row.get("suggestions") or []), row.get("connector"),
                    row.get("status", "pending"), row.get("created_at", time.time()),
                ),
            )

    async def get_permission(self, permission_id: str, session_key: str | None = None) -> dict | None:
        """One request. With `session_key` only a request of THAT session is visible: a
        socket of one conversation cannot read or decide the approvals of another."""
        query = "SELECT * FROM permission_requests WHERE id = ?"
        params: tuple = (permission_id,)
        if session_key is not None:
            query += " AND session_key = ?"
            params = (permission_id, session_key)
        async with self._conn.execute(query, params) as cursor:
            row = await cursor.fetchone()
        return _permission_from_row(row) if row else None

    async def decide_permission(
        self, permission_id: str, status: str, decision: dict, decided_by: str,
        on_committed=None, session_key: str | None = None,
    ) -> bool:
        """First decision wins: UPDATE ... WHERE id = ? AND status = 'pending';
        True only for the caller whose update changed the row.

        `on_committed()` runs, for the winner only, as soon as the decision is durable,
        even when the caller is cancelled at that very moment (then the caller gets
        CancelledError and no True): it is how the waiting `Future` still gets resolved,
        so a decision on disk always has someone who acts on it."""
        if status not in _PERMISSION_FINAL_STATUSES:
            raise ValueError(f"invalid permission status: {status}")
        query = (
            "UPDATE permission_requests SET status = ?, decision = ?, decided_by = ?, "
            "decided_at = ? WHERE id = ? AND status = 'pending'"
        )
        params: tuple = (status, json.dumps(decision), decided_by, time.time(), permission_id)
        if session_key is not None:
            query += " AND session_key = ?"
            params += (session_key,)
        async with self._write() as tx:
            cursor = await self._conn.execute(query, params)
            won = cursor.rowcount == 1
            if won and on_committed is not None:
                tx.after_commit(on_committed)
        return won

    async def cancel_permission(self, permission_id: str, status: str = "cancelled") -> dict | None:
        """Close ONE pending request (the CLI withdrew it). Returns the row as it was, or None
        when it was not pending any more (somebody decided first)."""
        if status not in ("expired", "cancelled"):
            raise ValueError(f"invalid status to close a pending request: {status}")
        async with self._write():
            async with self._conn.execute(
                "SELECT * FROM permission_requests WHERE id = ? AND status = 'pending'", (permission_id,)
            ) as cursor:
                found = await cursor.fetchone()
            if found is None:
                return None
            row = _permission_from_row(found)
            await self._conn.execute(
                "UPDATE permission_requests SET status = ?, decided_by = 'system', decided_at = ? "
                "WHERE id = ? AND status = 'pending'",
                (status, time.time(), permission_id),
            )
        return row

    async def close_pending(self, session_key: str | None, status: str) -> list[dict]:
        """Move every pending request (of one session, or of all when session_key is
        None) to `status` (expired or cancelled), decided_by 'system'. Returns the
        rows that were closed, as they were before closing."""
        if status not in _PERMISSION_FINAL_STATUSES - {"allowed", "denied"}:
            raise ValueError(f"invalid status to close pending requests: {status}")
        query = "SELECT * FROM permission_requests WHERE status = 'pending'"
        params: tuple = ()
        if session_key is not None:
            query += " AND session_key = ?"
            params = (session_key,)
        async with self._write():
            async with self._conn.execute(query + " ORDER BY created_at, id", params) as cursor:
                rows = [_permission_from_row(r) async for r in cursor]
            for row in rows:
                await self._conn.execute(
                    "UPDATE permission_requests SET status = ?, decided_by = 'system', "
                    "decided_at = ? WHERE id = ? AND status = 'pending'",
                    (status, time.time(), row["id"]),
                )
        return rows

    async def pending_count(self, session_key: str) -> int:
        async with self._conn.execute(
            "SELECT COUNT(*) AS n FROM permission_requests "
            "WHERE session_key = ? AND status = 'pending'",
            (session_key,),
        ) as cursor:
            return (await cursor.fetchone())["n"]

    # -- cleanup -----------------------------------------------------------------------

    async def delete_session_data(self, session_key: str) -> None:
        """Remove one session's rows from every chat table (never other keys)."""
        async with self._write():
            for table in ("chat_events", "permission_requests", "chat_sessions"):
                await self._conn.execute(
                    f"DELETE FROM {table} WHERE session_key = ?", (session_key,)
                )

    # -- agent_chat_settings -----------------------------------------------------------

    async def get_agent_settings(self, agent_id: str) -> dict:
        """Settings of an agent; an agent never configured gets the defaults
        (empty allowlist) without a row being written."""
        async with self._conn.execute(
            "SELECT * FROM agent_chat_settings WHERE agent_id = ?", (agent_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return {
                "agent_id": agent_id,
                "mcp_allowlist": [],
                "known_connectors": [],
                "connectors_probed_at": None,
                "updated_at": None,
            }
        data = dict(row)
        data["mcp_allowlist"] = json.loads(data["mcp_allowlist"])
        data["known_connectors"] = json.loads(data["known_connectors"])
        return data

    async def put_agent_settings(self, agent_id: str, **fields) -> dict:
        """Upsert the given fields (mcp_allowlist, known_connectors,
        connectors_probed_at), keeping the others; returns the stored settings."""
        unknown = set(fields) - _AGENT_SETTINGS_FIELDS
        if unknown:
            raise ValueError(f"cannot set agent_chat_settings fields: {sorted(unknown)}")
        async with self._write():
            current = await self.get_agent_settings(agent_id)
            current.update(fields)
            await self._conn.execute(
                "INSERT INTO agent_chat_settings (agent_id, mcp_allowlist, known_connectors, "
                "connectors_probed_at, updated_at) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(agent_id) DO UPDATE SET mcp_allowlist = excluded.mcp_allowlist, "
                "known_connectors = excluded.known_connectors, "
                "connectors_probed_at = excluded.connectors_probed_at, "
                "updated_at = excluded.updated_at",
                (
                    agent_id,
                    json.dumps(current["mcp_allowlist"]),
                    json.dumps(current["known_connectors"]),
                    current["connectors_probed_at"],
                    time.time(),
                ),
            )
        return await self.get_agent_settings(agent_id)
