from __future__ import annotations

import aiosqlite


class ConversationStore:
    def __init__(self, db_path: str = "sessions.db"):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self.db_path)
        # WAL + busy_timeout: sessions.db é compartilhado por 4 stores, cada
        # um com sua própria conexão/thread (ConversationStore, TaskStore,
        # GlobalAgentStore, CardStore) — sem isso, escritas concorrentes
        # entre elas podem estourar "attempt to write a readonly database".
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA busy_timeout=5000")
        await self._conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_key TEXT PRIMARY KEY,
                claude_session_id TEXT NOT NULL,
                updated_at REAL DEFAULT (unixepoch('now', 'subsec'))
            )
        """)
        # Fase 4 (D-01): colunas adicionadas via ALTER TABLE em bancos já existentes.
        # CREATE TABLE IF NOT EXISTS não adiciona colunas novas a uma tabela que já
        # existe, e ADD COLUMN falha com "duplicate column name" se já rodou antes —
        # cada ALTER é tentado isoladamente e o erro de coluna já existente é ignorado.
        for column_def in (
            "display_name TEXT",
            "needs_attention INTEGER NOT NULL DEFAULT 0",
            "last_activity_seen_at REAL",
        ):
            try:
                await self._conn.execute(f"ALTER TABLE sessions ADD COLUMN {column_def}")
            except aiosqlite.OperationalError:
                pass
        await self._conn.commit()

    async def get(self, session_key: str) -> str | None:
        async with self._conn.execute(
            "SELECT claude_session_id FROM sessions WHERE session_key = ?",
            (session_key,),
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else None

    async def set(self, session_key: str, claude_session_id: str) -> None:
        """Upsert real (Bug 2 fix): o antigo INSERT OR REPLACE trocava a linha
        inteira por uma nova sempre que uma sessão era (re)criada, zerando
        display_name/needs_attention de volta para os defaults a cada
        respawn. ON CONFLICT DO UPDATE só toca claude_session_id, preservando
        o resto da linha."""
        await self._conn.execute(
            """
            INSERT INTO sessions (session_key, claude_session_id)
            VALUES (?, ?)
            ON CONFLICT(session_key) DO UPDATE SET claude_session_id = excluded.claude_session_id
            """,
            (session_key, claude_session_id),
        )
        await self._conn.commit()

    async def clear(self, session_key: str) -> None:
        await self._conn.execute(
            "DELETE FROM sessions WHERE session_key = ?",
            (session_key,),
        )
        await self._conn.commit()

    async def reset_claude_session_id(self, session_key: str) -> None:
        """Bug 2 fix: zera só o claude_session_id de uma sessão já existente,
        preservando display_name/needs_attention — usado pelo endpoint POST
        /api/sessions/{session_key}/reset quando o usuário confirma que quer
        começar uma conversa nova após uma falha de --resume. Diferente de
        clear(), que apaga a linha inteira (usado por /terminate).

        Usa string vazia, não NULL, como sentinela de "sem claude_session_id
        ainda": a coluna é NOT NULL no schema, e todo consumidor existente
        (`get()` + `bool(claude_sid)` em main.py, `claude_sid or uuid4()`)
        já trata string vazia como falsy exatamente como trataria None — não
        exige nenhuma mudança nesses call sites. No-op silencioso se a linha
        não existir (mesma tolerância a chave desconhecida que ack()/rename()
        acima)."""
        await self._conn.execute(
            "UPDATE sessions SET claude_session_id = '' WHERE session_key = ?",
            (session_key,),
        )
        await self._conn.commit()

    async def mark_needs_attention(self, session_key: str) -> None:
        """Fase 4 (ADR-02 revisado): marca que o agente terminou a resposta e
        voltou a aguardar o usuário. Disparado pelo hook Stop do Claude Code
        (ver POST /api/hooks/stop em main.py) — a heurística original de
        transição running->idle nunca disparava porque a própria TUI do
        Claude Code manda ESC[?6n a cada ~200ms, resetando o timer de
        atividade indefinidamente."""
        await self._conn.execute(
            "UPDATE sessions SET needs_attention = 1 WHERE session_key = ?",
            (session_key,),
        )
        await self._conn.commit()

    async def rename(self, session_key: str, display_name: str) -> None:
        """D-08: grava o nome customizado escolhido via toque longo/duplo clique."""
        await self._conn.execute(
            "UPDATE sessions SET display_name = ? WHERE session_key = ?",
            (display_name, session_key),
        )
        await self._conn.commit()

    async def get_session_key_by_claude_id(self, claude_session_id: str) -> str | None:
        """Fase 4 (ADR-02 revisado): o hook Stop só recebe o session_id da
        CLI (UUID) via stdin, não a session_key do Escritório — resolve de
        volta pela mesma tabela que já mapeia os dois."""
        async with self._conn.execute(
            "SELECT session_key FROM sessions WHERE claude_session_id = ?",
            (claude_session_id,),
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else None

    async def ack(self, session_key: str) -> None:
        """Fase 4 (D-04): chamado quando o frontend foca a sessão — zera a
        notificação pendente. No-op silencioso se a linha não existir."""
        await self._conn.execute(
            "UPDATE sessions SET needs_attention = 0, last_activity_seen_at = unixepoch('now', 'subsec') WHERE session_key = ?",
            (session_key,),
        )
        await self._conn.commit()

    async def get_all_meta(self) -> dict[str, dict]:
        """Fase 4: display_name + needs_attention de todas as sessões
        persistidas, para o merge em GET /api/sessions/active."""
        result: dict[str, dict] = {}
        async with self._conn.execute(
            "SELECT session_key, display_name, needs_attention FROM sessions"
        ) as cursor:
            async for row in cursor:
                result[row[0]] = {"display_name": row[1], "needs_attention": bool(row[2])}
        return result

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
