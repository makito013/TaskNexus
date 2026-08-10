from __future__ import annotations

import time

import aiosqlite


class SettingsStore:
    """Configurações globais de aparência da aplicação (layout_version,
    theme_mode) — Milestone 1 do plano de Layout v2 (05-TL.md). Mesmo padrão
    de conexão/CREATE TABLE IF NOT EXISTS de CardStore/ConversationStore/
    TaskStore: conexão própria via aiosqlite.connect(db_path), mesmo arquivo
    sessions.db, cada store com sua própria conexão.

    Linha única (id=1, CHECK constraint) — a app inteira compartilha uma
    única configuração de aparência, não há escopo por usuário/dispositivo
    ainda."""

    def __init__(self, db_path: str = "sessions.db"):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self.db_path)
        # WAL + busy_timeout: ver conversation_store.py — mesmo sessions.db,
        # conexão própria, evita "readonly database" sob escrita concorrente.
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA busy_timeout=5000")
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                layout_version TEXT NOT NULL DEFAULT 'v1',
                theme_mode TEXT NOT NULL DEFAULT 'dark',
                updated_at REAL
            )
            """
        )
        # projects_root_path adicionado via ALTER TABLE em bancos já
        # existentes — mesmo padrão de conversation_store.py:26-38. Nullable
        # (sem DEFAULT): NULL significa "sem override, usa o fallback de
        # sempre" (env var PROJECTS_ROOT / ~/projetos), preservando o
        # comportamento de instalações já existentes ao introduzir a coluna.
        # quiet_hours_*: quiet-hours window for end-of-chat notifications.
        # `quiet_hours_enabled` is its OWN boolean — the old semantics of
        # "start == end means off" was rejected, because it made it
        # impossible to keep a configured time saved while the window is
        # off. Defaults of 22:00/07:00 exist only so the UI has something
        # coherent to show the first time the toggle is turned on; with
        # enabled = 0 they have no effect at all.
        for column_def in (
            "projects_root_path TEXT",
            "quiet_hours_enabled INTEGER NOT NULL DEFAULT 0",
            "quiet_hours_start TEXT NOT NULL DEFAULT '22:00'",
            "quiet_hours_end TEXT NOT NULL DEFAULT '07:00'",
        ):
            try:
                await self._conn.execute(f"ALTER TABLE app_settings ADD COLUMN {column_def}")
            except aiosqlite.OperationalError:
                pass
        # INSERT OR IGNORE: garante a linha id=1 com os defaults na primeira
        # vez, e é inofensivo (no-op) em toda chamada seguinte de initialize()
        # — ex: um segundo processo/teste apontando pro mesmo arquivo de DB
        # nunca reseta uma configuração já persistida por outra instância.
        await self._conn.execute(
            """
            INSERT OR IGNORE INTO app_settings (id, layout_version, theme_mode, updated_at)
            VALUES (1, 'v1', 'dark', ?)
            """,
            (time.time(),),
        )
        await self._conn.commit()

    async def get(self) -> dict:
        async with self._conn.execute(
            "SELECT layout_version, theme_mode, projects_root_path FROM app_settings WHERE id = 1"
        ) as cursor:
            row = await cursor.fetchone()
        return {"layout_version": row[0], "theme_mode": row[1], "projects_root_path": row[2]}

    async def update(
        self,
        layout_version: str | None = None,
        theme_mode: str | None = None,
        projects_root_path: str | None = None,
    ) -> dict:
        """Partial update: só atualiza a coluna cujo argumento correspondente
        não é None. COALESCE(?, coluna) deixa a coluna intacta quando o
        parâmetro do bind chega como NULL (Python None -> SQLite NULL)."""
        await self._conn.execute(
            """
            UPDATE app_settings
            SET layout_version = COALESCE(?, layout_version),
                theme_mode = COALESCE(?, theme_mode),
                projects_root_path = COALESCE(?, projects_root_path),
                updated_at = ?
            WHERE id = 1
            """,
            (layout_version, theme_mode, projects_root_path, time.time()),
        )
        await self._conn.commit()
        return await self.get()

    async def get_notifications(self) -> dict:
        """Notification settings (quiet-hours window) — a read separate from
        `get()` on purpose: these are different endpoint contracts
        (/api/settings/appearance vs /api/settings/notifications) and mixing
        the two would force every appearance consumer to load fields it
        doesn't use."""
        async with self._conn.execute(
            "SELECT quiet_hours_enabled, quiet_hours_start, quiet_hours_end "
            "FROM app_settings WHERE id = 1"
        ) as cursor:
            row = await cursor.fetchone()
        return {
            "quiet_hours_enabled": bool(row[0]),
            "quiet_hours_start": row[1],
            "quiet_hours_end": row[2],
        }

    async def update_notifications(
        self,
        quiet_hours_enabled: bool | None = None,
        quiet_hours_start: str | None = None,
        quiet_hours_end: str | None = None,
    ) -> dict:
        """Partial update, same COALESCE(?, column) pattern as `update()`
        above. `quiet_hours_enabled` is explicitly turned into 0/1: SQLite
        would store the Python bool as an integer anyway, but None (= "leave
        it alone") needs to stay None, so the conversion can't be
        unconditional."""
        enabled_value = None if quiet_hours_enabled is None else int(quiet_hours_enabled)
        await self._conn.execute(
            """
            UPDATE app_settings
            SET quiet_hours_enabled = COALESCE(?, quiet_hours_enabled),
                quiet_hours_start = COALESCE(?, quiet_hours_start),
                quiet_hours_end = COALESCE(?, quiet_hours_end),
                updated_at = ?
            WHERE id = 1
            """,
            (enabled_value, quiet_hours_start, quiet_hours_end, time.time()),
        )
        await self._conn.commit()
        return await self.get_notifications()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
