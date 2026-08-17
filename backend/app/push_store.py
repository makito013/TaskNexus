from __future__ import annotations

import time

import aiosqlite

# Ceiling on how many devices may be registered at once. This is a personal
# install: a handful of browsers, never a fleet. The cap is a cost bound, not
# a quota — send_push_to_all() walks the table SEQUENTIALLY with a
# PUSH_TIMEOUT_SECONDS (10s) budget per delivery, so N unreachable rows mean
# N×10s of live background task on every end-of-chat notification.
MAX_SUBSCRIPTIONS = 20


class TooManySubscriptionsError(RuntimeError):
    """Raised by upsert() when registering a NEW endpoint would push the
    table past MAX_SUBSCRIPTIONS. Refreshing an endpoint that is already
    registered never raises: a legitimate device must not lose the ability
    to renew its keys just because the table happens to be full."""


class PushSubscriptionStore:
    """Web Push subscriptions + the server's VAPID keypair (Phase 3 of the
    end-of-chat notification feature).

    Same connection/CREATE TABLE IF NOT EXISTS pattern as
    SettingsStore/ConversationStore: its own aiosqlite connection over the
    same sessions.db file, WAL + busy_timeout so concurrent writes from the
    other stores don't hit "attempt to write a readonly database".

    Why the VAPID keypair lives HERE and not in its own store: decision G-1
    generates the keypair on first boot instead of reading it from .env, so
    it needs persistence — and adding a sixth aiosqlite connection to
    sessions.db just to hold a single row would cost more than it's worth.
    The crypto itself is NOT in this module (app/vapid_keys.py owns it);
    this store only reads and writes the already-serialized strings, so the
    file stays importable on a machine without pywebpush/cryptography
    installed.
    """

    def __init__(self, db_path: str = "sessions.db"):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self.db_path)
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA busy_timeout=5000")
        # endpoint as PRIMARY KEY is what makes registration idempotent: the
        # browser hands back the SAME endpoint URL for the same
        # device/origin, so two tabs (or a re-subscribe after a page reload)
        # collapse into one row instead of duplicating the push.
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                endpoint TEXT PRIMARY KEY,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                user_agent TEXT,
                created_at REAL,
                last_success_at REAL
            )
            """
        )
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vapid_keys (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                private_pem TEXT NOT NULL,
                public_key TEXT NOT NULL,
                created_at REAL
            )
            """
        )
        await self._conn.commit()

    # ─── Subscriptions ──────────────────────────────────────────────────

    async def upsert(
        self,
        endpoint: str,
        p256dh: str,
        auth: str,
        user_agent: str | None = None,
    ) -> None:
        """Registers (or refreshes) a device subscription.

        ON CONFLICT DO UPDATE deliberately leaves `created_at` alone: only
        the keys/user agent are refreshed, so re-subscribing the same device
        doesn't look like a brand-new registration.

        Raises TooManySubscriptionsError when a new endpoint would exceed
        MAX_SUBSCRIPTIONS. The module global is read here, at call time, on
        purpose — that is what lets a test lower the cap without rewriting
        the store.
        """
        await self._reject_if_capped(endpoint)
        await self._conn.execute(
            """
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                user_agent = excluded.user_agent
            """,
            (endpoint, p256dh, auth, user_agent, time.time()),
        )
        await self._conn.commit()

    async def _reject_if_capped(self, endpoint: str) -> None:
        """Blocks only the registration of a genuinely NEW endpoint.

        The "is this a refresh?" lookup runs only when the table is already
        full, which is the rare case — the common path stays a single
        COUNT(*) over a table of at most a couple of dozen rows.

        ⚠️ Known limitation (accepted): the COUNT and the INSERT that follows
        are not one transaction, so two registrations racing at exactly the
        cap can both read `total == MAX_SUBSCRIPTIONS - 1` and land, leaving
        the table one row over. Harmless at this scale — the cap is a cost
        bound on sequential delivery, not a security boundary — and a single
        personal install has no concurrent registrations worth serializing a
        write transaction for.
        """
        async with self._conn.execute(
            "SELECT COUNT(*) FROM push_subscriptions"
        ) as cursor:
            (total,) = await cursor.fetchone()
        if total < MAX_SUBSCRIPTIONS:
            return

        async with self._conn.execute(
            "SELECT 1 FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
        ) as cursor:
            is_refresh = await cursor.fetchone() is not None
        if not is_refresh:
            raise TooManySubscriptionsError(
                f"limite de {MAX_SUBSCRIPTIONS} dispositivos registrados atingido; "
                "remova um dispositivo antes de registrar outro"
            )

    async def list_all(self) -> list[dict]:
        rows: list[dict] = []
        async with self._conn.execute(
            "SELECT endpoint, p256dh, auth, user_agent, created_at, last_success_at "
            "FROM push_subscriptions ORDER BY created_at"
        ) as cursor:
            async for row in cursor:
                rows.append(
                    {
                        "endpoint": row[0],
                        "p256dh": row[1],
                        "auth": row[2],
                        "user_agent": row[3],
                        "created_at": row[4],
                        "last_success_at": row[5],
                    }
                )
        return rows

    async def delete(self, endpoint: str) -> None:
        """Removes a subscription. No-op when the endpoint is unknown —
        same tolerance as ConversationStore.ack(): this is called both by
        the user's "disable push" action and by the automatic prune of an
        endpoint the push service already reported as gone (404/410), and
        neither should fail over a row that isn't there anymore."""
        await self._conn.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
        )
        await self._conn.commit()

    async def touch_success(self, endpoint: str) -> None:
        """Records the last delivery accepted by the push service. Purely
        diagnostic (nothing branches on it) — it's what makes a silently
        dead device distinguishable from one that never had a push sent."""
        await self._conn.execute(
            "UPDATE push_subscriptions SET last_success_at = ? WHERE endpoint = ?",
            (time.time(), endpoint),
        )
        await self._conn.commit()

    # ─── VAPID keypair ──────────────────────────────────────────────────

    async def get_vapid_keys(self) -> dict | None:
        async with self._conn.execute(
            "SELECT private_pem, public_key FROM vapid_keys WHERE id = 1"
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        return {"private_pem": row[0], "public_key": row[1]}

    async def save_vapid_keys(self, private_pem: str, public_key: str) -> None:
        """Persists the keypair generated on first boot.

        INSERT OR IGNORE, never a replace: overwriting an existing keypair
        would invalidate every subscription already registered against the
        old public key (the push service rejects them with 403 from then
        on), with no visible cause. Two racing boots therefore agree on
        whichever pair landed first.
        """
        await self._conn.execute(
            """
            INSERT OR IGNORE INTO vapid_keys (id, private_pem, public_key, created_at)
            VALUES (1, ?, ?, ?)
            """,
            (private_pem, public_key, time.time()),
        )
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
