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
        for column_def in ("projects_root_path TEXT",):
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

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
