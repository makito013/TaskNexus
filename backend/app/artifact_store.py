"""Galeria de artefatos por projeto (Fase A, Parte 7 seção 7.4.2).

Um registro por (projeto, caminho): publicar de novo o mesmo arquivo atualiza
o registro e mantém o `artifact_id` — o link/aba que a tela já tem continua
valendo. Diferente das abas do visualizador (viewer_store.py), nada aqui é
por sessão: a galeria é permanente (7.1, A6) e sobrevive ao encerramento da
conversa e ao limite de 15 abas.

Remover da lista apaga só a linha; o arquivo no disco nunca é tocado por este
módulo (A7).

Mesmo padrão de conexão dos outros stores (ver conversation_store.py):
conexão aiosqlite própria no sessions.db, WAL e busy_timeout.
"""
from __future__ import annotations

import asyncio
import secrets
import time

import aiosqlite

# Colunas do formato `Artifact` (7.4.3), na ordem da tabela. `session_key` e
# `title_custom` existem na tabela mas ficam FORA da resposta: o primeiro é só
# informativo (a sessão pode nem existir mais), o segundo é regra interna.
_COLUMNS = (
    "artifact_id", "project_id", "cliente_id", "path", "kind", "title",
    "description", "excerpt", "size", "mtime", "created_by", "agent_label",
    "session_key", "title_custom", "created_at", "updated_at",
)
_PUBLIC_COLUMNS = tuple(c for c in _COLUMNS if c not in ("session_key", "title_custom"))
_SELECT = "SELECT " + ", ".join(_COLUMNS) + " FROM artifacts"


def _row_to_artifact(row) -> dict:
    full = dict(zip(_COLUMNS, row))
    return {key: full[key] for key in _PUBLIC_COLUMNS}


def new_artifact_id() -> str:
    """Id aleatório e não enumerável: as rotas `/api/artifacts/{id}/f/...`
    servem arquivos só para quem conhece o id (mesma regra do `vw_` da Fase V)."""
    return "af_" + secrets.token_urlsafe(16)


def _like_prefix(value: str) -> str:
    """`value` como prefixo literal de um LIKE com ESCAPE '\\': `_` e `%` são
    curingas no LIKE, e ids de projeto com `_` são comuns (cliente_projeto_1)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


class ArtifactStore:
    def __init__(self, db_path: str = "sessions.db"):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        # Serializa o "procura (projeto, caminho) -> atualiza OU cria" do
        # upsert. O UNIQUE da tabela já impede a linha duplicada, mas sem o
        # lock duas publicações simultâneas do mesmo arquivo (o agente chama
        # `publicar_artefato` logo depois de `abrir_no_visualizador`, que
        # também publica) disputariam o INSERT e uma delas viraria erro.
        self._lock: asyncio.Lock | None = None

    async def initialize(self) -> None:
        # Lock criado aqui e não no __init__: ver ViewerStore.initialize (no
        # Python 3.9 o Lock se prende ao loop do momento da criação).
        self._lock = asyncio.Lock()
        self._conn = await aiosqlite.connect(self.db_path)
        try:
            await self._conn.execute("PRAGMA journal_mode=WAL")
        except aiosqlite.OperationalError:
            pass
        await self._conn.execute("PRAGMA busy_timeout=5000")
        # `title_custom`: 1 quando o título veio de alguém (agente com
        # `titulo`, usuário no "Renomear"). Com 0, o título acompanha o
        # documento a cada nova publicação (o agente reescreve o `# título`
        # do .md e a galeria mostra o novo); com 1, nunca é sobrescrito por
        # um título automático.
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS artifacts (
                artifact_id  TEXT PRIMARY KEY,
                project_id   TEXT NOT NULL,
                cliente_id   TEXT NOT NULL,
                path         TEXT NOT NULL,
                kind         TEXT NOT NULL,
                title        TEXT NOT NULL,
                description  TEXT,
                excerpt      TEXT,
                size         INTEGER,
                mtime        REAL,
                created_by   TEXT NOT NULL,
                agent_label  TEXT,
                session_key  TEXT,
                title_custom INTEGER NOT NULL DEFAULT 0,
                created_at   REAL NOT NULL,
                updated_at   REAL NOT NULL,
                UNIQUE(project_id, path)
            )
            """
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_artifacts_cliente "
            "ON artifacts(cliente_id, updated_at)"
        )
        await self._conn.commit()

    async def get(self, artifact_id: str) -> dict | None:
        async with self._conn.execute(
            _SELECT + " WHERE artifact_id = ?", (artifact_id,),
        ) as cursor:
            row = await cursor.fetchone()
        return _row_to_artifact(row) if row else None

    async def upsert(
        self,
        *,
        project_id: str,
        cliente_id: str,
        path: str,
        kind: str,
        auto_title: str,
        title: str | None,
        description: str | None,
        excerpt: str | None,
        size: int | None,
        mtime: float | None,
        created_by: str,
        agent_label: str | None,
        session_key: str | None,
    ) -> tuple[dict, bool]:
        """Cria ou atualiza o artefato de (project_id, path). Devolve
        `(artifact, created)`.

        - `title`: o título explícito (agente ou usuário). Sem ele, vale
          `auto_title` (do documento ou nome do arquivo) — mas um título
          explícito anterior nunca é trocado por um automático.
        - `description`: só muda quando veio.
        - `kind`, `excerpt`, `size`, `mtime`, `updated_at`: sempre atualizados
          (o arquivo pode ter mudado).
        - `created_by`, `agent_label`, `session_key`, `created_at`: ficam os
          de quem criou. Se o usuário importou e depois o agente reabriu, o
          cartão continua dizendo "você".
        """
        async with self._lock:
            now = time.time()
            async with self._conn.execute(
                "SELECT artifact_id, title_custom FROM artifacts "
                "WHERE project_id = ? AND path = ?",
                (project_id, path),
            ) as cursor:
                row = await cursor.fetchone()
            if row is not None:
                artifact_id, title_custom = row
                sets = ["kind = ?", "excerpt = ?", "size = ?", "mtime = ?", "updated_at = ?"]
                params: list = [kind, excerpt, size, mtime, now]
                if title:
                    sets += ["title = ?", "title_custom = 1"]
                    params.append(title)
                elif not title_custom:
                    sets.append("title = ?")
                    params.append(auto_title)
                if description:
                    sets.append("description = ?")
                    params.append(description)
                await self._conn.execute(
                    "UPDATE artifacts SET " + ", ".join(sets) + " WHERE artifact_id = ?",
                    (*params, artifact_id),
                )
                await self._conn.commit()
                return await self.get(artifact_id), False

            artifact_id = new_artifact_id()
            await self._conn.execute(
                "INSERT INTO artifacts (" + ", ".join(_COLUMNS) + ") "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (artifact_id, project_id, cliente_id, path, kind,
                 title or auto_title, description, excerpt, size, mtime,
                 created_by, agent_label, session_key, 1 if title else 0,
                 now, now),
            )
            await self._conn.commit()
            return await self.get(artifact_id), True

    async def update(
        self,
        artifact_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        clear_description: bool = False,
    ) -> dict | None:
        """Renomear / editar descrição (PATCH). None se não existe. Renomear
        marca o título como explícito: uma republicação automática não desfaz
        o nome que o usuário escolheu."""
        sets: list[str] = []
        params: list = []
        if title:
            sets += ["title = ?", "title_custom = 1"]
            params.append(title)
        if clear_description:
            sets.append("description = NULL")
        elif description:
            sets.append("description = ?")
            params.append(description)
        if sets:
            sets.append("updated_at = ?")
            params.append(time.time())
            cursor = await self._conn.execute(
                "UPDATE artifacts SET " + ", ".join(sets) + " WHERE artifact_id = ?",
                (*params, artifact_id),
            )
            await self._conn.commit()
            if cursor.rowcount == 0:
                return None
        return await self.get(artifact_id)

    async def delete(self, artifact_id: str) -> bool:
        """Remove da galeria. O arquivo no disco fica (7.1, A7)."""
        cursor = await self._conn.execute(
            "DELETE FROM artifacts WHERE artifact_id = ?", (artifact_id,),
        )
        await self._conn.commit()
        return cursor.rowcount > 0

    async def list_artifacts(
        self,
        *,
        cliente_id: str | None = None,
        projeto_id: str | None = None,
        kind: str | None = None,
    ) -> list[dict]:
        """Filtros que o SQL resolve bem; busca textual e ordenação final
        ficam na camada de cima (precisam de casefold sem acento e do `mtime`
        atual do disco).

        `projeto_id` inclui a subárvore: o próprio projeto e todo projeto cujo
        id começa com `projeto_id/` — a mesma regra do `collectSubtreeIds` do
        frontend. O prefixo leva a barra para "site" não pegar "site-novo"."""
        where: list[str] = []
        params: list = []
        if cliente_id:
            where.append("cliente_id = ?")
            params.append(cliente_id)
        if projeto_id:
            where.append("(project_id = ? OR project_id LIKE ? ESCAPE '\\')")
            params += [projeto_id, _like_prefix(projeto_id + "/")]
        if kind:
            where.append("kind = ?")
            params.append(kind)
        sql = _SELECT
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY updated_at DESC, rowid DESC"
        async with self._conn.execute(sql, params) as cursor:
            rows = await cursor.fetchall()
        return [_row_to_artifact(row) for row in rows]

    async def paths_for_project(self, project_id: str) -> set[str]:
        """Caminhos já publicados de um projeto (os candidatos de importação
        não repetem o que já está na galeria)."""
        async with self._conn.execute(
            "SELECT path FROM artifacts WHERE project_id = ?", (project_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        return {row[0] for row in rows}

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
