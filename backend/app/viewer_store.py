"""Abas do visualizador de arquivos, por sessão (Fase V, Parte 6 seção 6.4.5).

Cada vez que o agente (tool `abrir_no_visualizador`) ou o usuário (link num
markdown, caminho no terminal) abre um arquivo, nasce uma linha aqui. A aba é
GRAVADA antes de qualquer aviso à tela: o frame `viewer_open` no WebSocket é só
conveniência, e quem não estava conectado busca as abas pelo GET ao abrir a
conversa — nada se perde com a tela fechada.

Mesmo padrão de conexão dos outros stores (ver conversation_store.py):
conexão aiosqlite própria no sessions.db, WAL e busy_timeout.
"""
from __future__ import annotations

import asyncio
import posixpath
import secrets
import time

import aiosqlite

# Decisão da Parte 6 (6.1): até 15 abas por conversa; ao abrir a 16ª, fecha a
# de `updated_at` mais antigo (a usada há mais tempo, não a criada há mais
# tempo — reabrir uma aba a "rejuvenesce").
MAX_ITEMS_PER_SESSION = 15

_COLUMNS = (
    "item_id", "session_key", "project_id", "path", "title", "line",
    "kind", "language", "opened_by", "created_at", "updated_at",
)
_SELECT = "SELECT " + ", ".join(_COLUMNS) + " FROM viewer_items"


def _row_to_item(row) -> dict:
    """Formato `item` da Parte 6, 6.4.3 — o mesmo que vai no frame
    `viewer_open` e nas respostas das rotas."""
    return dict(zip(_COLUMNS, row))


def new_item_id() -> str:
    """Id aleatório e não enumerável: as rotas `/api/viewer/{item_id}/...`
    servem arquivos só para quem conhece o id (6.3)."""
    return "vw_" + secrets.token_urlsafe(16)


class ViewerStore:
    def __init__(self, db_path: str = "sessions.db"):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        # Serializa "procura aba do mesmo caminho -> atualiza OU cria e aplica
        # o limite". Entre os awaits desse trecho outra abertura do mesmo
        # arquivo (o agente chamando a tool duas vezes seguidas, ou agente e
        # usuário ao mesmo tempo) criaria uma aba duplicada. A tabela não tem
        # UNIQUE(session_key, path) de propósito: abrir duplicado continua
        # sendo uma opção trivial (`reuse=False`, 6.1).
        self._open_lock: asyncio.Lock | None = None

    async def initialize(self) -> None:
        # O Lock nasce aqui, dentro do loop que vai usá-lo, e não no
        # __init__: este store é instanciado no import de main.py, e no Python
        # 3.9 `asyncio.Lock()` se prende ao `get_event_loop()` do momento da
        # criação — sob disputa, o loop do uvicorn esperaria num Future de
        # outro loop ("attached to a different loop").
        self._open_lock = asyncio.Lock()
        self._conn = await aiosqlite.connect(self.db_path)
        # WAL + busy_timeout: ver conversation_store.py — mesmo sessions.db,
        # conexão própria, evita "readonly database" sob escrita concorrente.
        try:
            await self._conn.execute("PRAGMA journal_mode=WAL")
        except aiosqlite.OperationalError:
            pass
        await self._conn.execute("PRAGMA busy_timeout=5000")
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS viewer_items (
                item_id     TEXT PRIMARY KEY,
                session_key TEXT NOT NULL,
                project_id  TEXT NOT NULL,
                path        TEXT NOT NULL,
                title       TEXT NOT NULL,
                line        INTEGER,
                kind        TEXT NOT NULL,
                language    TEXT,
                opened_by   TEXT NOT NULL,
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )
            """
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_viewer_items_session "
            "ON viewer_items(session_key, updated_at)"
        )
        await self._conn.commit()

    async def get(self, item_id: str) -> dict | None:
        async with self._conn.execute(_SELECT + " WHERE item_id = ?", (item_id,)) as cursor:
            row = await cursor.fetchone()
        return _row_to_item(row) if row else None

    async def list_for_session(self, session_key: str) -> list[dict]:
        """Na ordem de criação (6.4.3): é a ordem das abas na tela. `rowid`
        desempata duas abas criadas no mesmo instante."""
        async with self._conn.execute(
            _SELECT + " WHERE session_key = ? ORDER BY created_at ASC, rowid ASC",
            (session_key,),
        ) as cursor:
            rows = await cursor.fetchall()
        return [_row_to_item(row) for row in rows]

    async def open_item(
        self,
        *,
        session_key: str,
        project_id: str,
        path: str,
        title: str | None,
        line: int | None,
        kind: str,
        language: str | None,
        opened_by: str,
        reuse: bool = True,
        max_items: int = MAX_ITEMS_PER_SESSION,
    ) -> tuple[dict, bool, list[str]]:
        """Abre `path` na sessão. Devolve `(item, reused, evicted_ids)`.

        - Com `reuse` e já existindo aba do mesmo `path` na sessão: atualiza
          `line`, `kind`, `language` e `updated_at` dela (o agente pode ter
          alterado o arquivo, a tela recarrega) e devolve `reused=True`. O
          título só muda se veio um novo: abrir de novo sem `titulo` não
          apaga o nome curto que o agente deu da primeira vez.
        - Senão cria a aba (título padrão: nome do arquivo) e, se a sessão
          passar de `max_items`, apaga as de `updated_at` mais antigo. Os ids
          apagados voltam para a tela poder fechá-las sem recarregar a lista.
        """
        async with self._open_lock:
            now = time.time()
            if reuse:
                async with self._conn.execute(
                    _SELECT + " WHERE session_key = ? AND path = ? "
                    "ORDER BY updated_at DESC, rowid DESC LIMIT 1",
                    (session_key, path),
                ) as cursor:
                    row = await cursor.fetchone()
                if row is not None:
                    existing = _row_to_item(row)
                    await self._conn.execute(
                        "UPDATE viewer_items SET title = ?, line = ?, kind = ?, "
                        "language = ?, updated_at = ? WHERE item_id = ?",
                        (title or existing["title"], line, kind, language, now,
                         existing["item_id"]),
                    )
                    await self._conn.commit()
                    return await self.get(existing["item_id"]), True, []

            item_id = new_item_id()
            await self._conn.execute(
                "INSERT INTO viewer_items (" + ", ".join(_COLUMNS) + ") "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item_id, session_key, project_id, path,
                 title or posixpath.basename(path), line, kind, language,
                 opened_by, now, now),
            )
            async with self._conn.execute(
                "SELECT item_id FROM viewer_items WHERE session_key = ? "
                "ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?",
                (session_key, max_items),
            ) as cursor:
                evicted = [row[0] for row in await cursor.fetchall()]
            if evicted:
                await self._conn.executemany(
                    "DELETE FROM viewer_items WHERE item_id = ?",
                    [(evicted_id,) for evicted_id in evicted],
                )
            await self._conn.commit()
            return await self.get(item_id), False, evicted

    async def delete(self, session_key: str, item_id: str) -> bool:
        """Fecha uma aba. Filtra pela sessão também: uma sessão não fecha a
        aba de outra só por conhecer o id."""
        cursor = await self._conn.execute(
            "DELETE FROM viewer_items WHERE item_id = ? AND session_key = ?",
            (item_id, session_key),
        )
        await self._conn.commit()
        return cursor.rowcount > 0

    async def clear_for_session(self, session_key: str) -> int:
        """Fecha todas as abas da sessão ("Fechar todas" e o encerramento da
        conversa). Devolve quantas foram fechadas."""
        cursor = await self._conn.execute(
            "DELETE FROM viewer_items WHERE session_key = ?",
            (session_key,),
        )
        await self._conn.commit()
        return cursor.rowcount

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
