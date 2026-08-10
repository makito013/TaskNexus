from __future__ import annotations

import time

import aiosqlite


class TaskStore:
    """Tarefas de validação criadas pelo agente (via MCP) ou manualmente pela
    UI, escopadas por session_key (D-plano MCP tarefas). Mesmo padrão de
    conexão/CREATE TABLE IF NOT EXISTS de ConversationStore — ver
    conversation_store.py."""

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
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_key TEXT NOT NULL,
                titulo TEXT NOT NULL,
                descricao_markdown TEXT NOT NULL,
                descricao_html TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at REAL NOT NULL,
                completed_at REAL,
                projeto_id TEXT
            )
            """
        )
        # projeto_id adicionado via ALTER TABLE em bancos já existentes:
        # CREATE TABLE IF NOT EXISTS não adiciona colunas novas a uma tabela
        # que já existe (o banco de produção já está populado), e ADD COLUMN
        # falha com "duplicate column name" se já rodou antes — o erro de
        # coluna já existente é ignorado. Mesmo padrão defensivo de
        # ConversationStore.initialize (ver conversation_store.py).
        try:
            await self._conn.execute("ALTER TABLE tasks ADD COLUMN projeto_id TEXT")
        except aiosqlite.OperationalError:
            pass
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_key)"
        )
        await self._conn.commit()

    async def create(
        self,
        session_key: str,
        titulo: str,
        descricao_markdown: str,
        descricao_html: str | None = None,
        projeto_id: str | None = None,
    ) -> int:
        # projeto_id fica no FINAL da assinatura, com default None, de
        # propósito: os chamadores posicionais existentes
        # (store.create(session_key, titulo, descricao_markdown, ...)) não
        # quebram. NULL = tarefa da própria sessão (fallback via session_key
        # é resolvido na leitura, ver GET /api/tasks/global).
        created_at = time.time()
        cursor = await self._conn.execute(
            """
            INSERT INTO tasks (session_key, titulo, descricao_markdown, descricao_html, status, created_at, projeto_id)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)
            """,
            (session_key, titulo, descricao_markdown, descricao_html, created_at, projeto_id),
        )
        await self._conn.commit()
        return cursor.lastrowid

    async def list_for_session(self, session_key: str) -> list[dict]:
        async with self._conn.execute(
            """
            SELECT id, session_key, titulo, descricao_markdown, descricao_html,
                   status, created_at, completed_at, projeto_id
            FROM tasks WHERE session_key = ?
            ORDER BY id ASC
            """,
            (session_key,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": row[0],
                    "session_key": row[1],
                    "titulo": row[2],
                    "descricao_markdown": row[3],
                    "descricao_html": row[4],
                    "status": row[5],
                    "created_at": row[6],
                    "completed_at": row[7],
                    "projeto_id": row[8],
                }
                for row in rows
            ]

    async def list_all(self) -> list[dict]:
        """Retorna todas as tarefas de todas as sessões, sem filtro de
        session_key, ordenadas por session_key ASC, id ASC. Mesmo formato de
        dict que list_for_session."""
        async with self._conn.execute(
            """
            SELECT id, session_key, titulo, descricao_markdown, descricao_html,
                   status, created_at, completed_at, projeto_id
            FROM tasks
            ORDER BY session_key ASC, id ASC
            """
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": row[0],
                    "session_key": row[1],
                    "titulo": row[2],
                    "descricao_markdown": row[3],
                    "descricao_html": row[4],
                    "status": row[5],
                    "created_at": row[6],
                    "completed_at": row[7],
                    "projeto_id": row[8],
                }
                for row in rows
            ]

    async def mark_done(self, session_key: str, task_id: int) -> bool:
        """Idempotente: retorna False se o id não existe OU pertence a outra
        session_key (filtro de segurança — uma sessão não pode concluir a
        tarefa de outra). Retorna True tanto para "concluiu agora" quanto
        para "já estava done", sem lançar exceção — completed_at só é escrito
        na primeira transição para done."""
        async with self._conn.execute(
            "SELECT status FROM tasks WHERE id = ? AND session_key = ?",
            (task_id, session_key),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return False
        if row[0] == "done":
            return True
        await self._conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ? AND session_key = ?",
            (time.time(), task_id, session_key),
        )
        await self._conn.commit()
        return True

    async def mark_pending(self, session_key: str, task_id: int) -> bool:
        """Espelha mark_done, no sentido inverso: reabre uma tarefa concluída
        (status volta a 'pending', completed_at é limpo). Idempotente: chamar
        numa tarefa que já está pending retorna True sem erro, sem
        reescrever nada. Mesmo filtro de segurança de mark_done — retorna
        False se o id não existe OU pertence a outra session_key."""
        async with self._conn.execute(
            "SELECT status FROM tasks WHERE id = ? AND session_key = ?",
            (task_id, session_key),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return False
        if row[0] == "pending":
            return True
        await self._conn.execute(
            "UPDATE tasks SET status = 'pending', completed_at = NULL WHERE id = ? AND session_key = ?",
            (task_id, session_key),
        )
        await self._conn.commit()
        return True

    async def clear_for_session(self, session_key: str) -> None:
        await self._conn.execute(
            "DELETE FROM tasks WHERE session_key = ?",
            (session_key,),
        )
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
