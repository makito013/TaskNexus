from __future__ import annotations

import time

import aiosqlite


class CardStore:
    """Cards de board (Jira-like), persistentes por projeto — DESACOPLADO de
    Task (tarefas de validação por sessão, ver TaskStore). Mesmo padrão de
    conexão/CREATE TABLE IF NOT EXISTS de TaskStore/ConversationStore:
    conexão própria via aiosqlite.connect(db_path), mesmo arquivo
    sessions.db, métodos retornando dict (não os modelos Pydantic
    diretamente — isso é responsabilidade de quem chama, o endpoint).

    `parent_id` NULL = card de topo; caso contrário, é subcard. Regra de 1
    nível só (subcard nunca pode ser pai de outro subcard) e herança de
    `projeto_id` do pai são validadas aqui, em código — não há FOREIGN KEY
    real no schema (ver seção 1.2 de 05-ARQUITETO.md: nenhuma outra tabela do
    projeto usa FK declarativa, e a validação que importa não seria
    expressável numa FK simples do SQLite de qualquer forma)."""

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
            CREATE TABLE IF NOT EXISTS cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                projeto_id TEXT NOT NULL,
                parent_id INTEGER,
                status TEXT NOT NULL DEFAULT 'a_fazer',
                origem TEXT NOT NULL,
                ultima_atualizacao_por TEXT NOT NULL,
                descricao TEXT,
                session_key TEXT,
                criado_em REAL NOT NULL,
                atualizado_em REAL NOT NULL,
                deleted_at REAL
            )
            """
        )
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS card_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                criado_em REAL NOT NULL
            )
            """
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cards_projeto ON cards(projeto_id)"
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cards_parent ON cards(parent_id)"
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_card_images_card ON card_images(card_id)"
        )
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None

    # -- helpers internos --------------------------------------------------

    @staticmethod
    def _row_to_card_dict(row) -> dict:
        return {
            "id": row[0],
            "titulo": row[1],
            "projeto_id": row[2],
            "parent_id": row[3],
            "status": row[4],
            "origem": row[5],
            "ultima_atualizacao_por": row[6],
            "descricao": row[7],
            "session_key": row[8],
            "criado_em": row[9],
            "atualizado_em": row[10],
            "deleted_at": row[11],
        }

    _CARD_COLUMNS = (
        "id, titulo, projeto_id, parent_id, status, origem, "
        "ultima_atualizacao_por, descricao, session_key, criado_em, "
        "atualizado_em, deleted_at"
    )

    async def _list_images(self, card_id: int) -> list[dict]:
        async with self._conn.execute(
            """
            SELECT id, card_id, filename, mime_type, size_bytes, criado_em
            FROM card_images WHERE card_id = ? ORDER BY id ASC
            """,
            (card_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        return [
            {
                "id": row[0],
                "card_id": row[1],
                "filename": row[2],
                "mime_type": row[3],
                "size_bytes": row[4],
                "criado_em": row[5],
            }
            for row in rows
        ]

    async def _list_active_subcards(self, parent_id: int) -> list[dict]:
        """Subcards ativos de um pai, no "mesmo formato" de um card de topo
        exceto que a recursão para de propósito neste nível: subcards() vem
        sempre vazio e subcards_resumo sempre None, porque a regra de 1
        nível garante que um subcard nunca tem filhos."""
        async with self._conn.execute(
            f"""
            SELECT {self._CARD_COLUMNS} FROM cards
            WHERE parent_id = ? AND deleted_at IS NULL
            ORDER BY id ASC
            """,
            (parent_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        subcards = []
        for row in rows:
            sub = self._row_to_card_dict(row)
            sub["imagens"] = await self._list_images(sub["id"])
            sub["subcards"] = []
            sub["subcards_resumo"] = None
            subcards.append(sub)
        return subcards

    # -- CRUD de cards -------------------------------------------------------

    async def create(
        self,
        titulo: str,
        projeto_id: str | None = None,
        status: str = "a_fazer",
        origem: str = "bruno",
        ultima_atualizacao_por: str = "bruno",
        descricao: str | None = None,
        parent_id: int | None = None,
        session_key: str | None = None,
        cliente_id: str | None = None,
    ) -> int:
        """Cria um card de topo (parent_id=None) ou um subcard.

        Resolução de projeto_id, em ordem (só o ramo 3 é novo):
        1. parent_id presente -> deriva projeto_id do pai, **ignorando**
           projeto_id/cliente_id recebidos do chamador — regra de
           integridade estrutural, não uma convenção esperada de quem chama.
        2. elif projeto_id presente -> usa como está (card vinculado a um
           projeto específico).
        3. elif cliente_id presente (sem projeto_id) -> projeto_id =
           cliente_id — card "cliente-only", vinculado só ao cliente-pai.
           Schema não muda: não existe coluna cliente_id em `cards`,
           `scan_projects` já materializa um Project sintético pro
           cliente-pai mesmo sem agentes próprios, então gravar
           projeto_id=cliente_id já resolve/agrupa corretamente em tudo que
           já existe (resolveProjectName, groupCardsByProject, filtro
           IN (...)).
        4. else -> ValueError (nem projeto nem cliente foram informados).
        """
        if parent_id is not None:
            parent = await self.get(parent_id)
            if parent is None or parent["deleted_at"] is not None:
                raise ValueError(
                    f"Card pai {parent_id} não existe ou foi removido"
                )
            if parent["parent_id"] is not None:
                raise ValueError(
                    f"Card {parent_id} já é um subcard — não é possível "
                    "criar um subcard sob outro subcard (limite de 1 nível)"
                )
            projeto_id = parent["projeto_id"]
        elif projeto_id:
            pass
        elif cliente_id:
            projeto_id = cliente_id
        else:
            raise ValueError(
                "É necessário informar projeto_id ou cliente_id para criar um card"
            )

        now = time.time()
        cursor = await self._conn.execute(
            """
            INSERT INTO cards (
                titulo, projeto_id, parent_id, status, origem,
                ultima_atualizacao_por, descricao, session_key,
                criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                titulo,
                projeto_id,
                parent_id,
                status,
                origem,
                ultima_atualizacao_por,
                descricao,
                session_key,
                now,
                now,
            ),
        )
        await self._conn.commit()
        return cursor.lastrowid

    async def get(self, card_id: int) -> dict | None:
        """Busca um card por id, sem filtrar deleted_at — uso interno (ex:
        validação de pai em create(), ou de existência em update())."""
        async with self._conn.execute(
            f"SELECT {self._CARD_COLUMNS} FROM cards WHERE id = ?",
            (card_id,),
        ) as cursor:
            row = await cursor.fetchone()
        return self._row_to_card_dict(row) if row else None

    async def list_top_level(
        self, projeto_ids: list[str] | None = None
    ) -> list[dict]:
        """Cards de topo ativos (parent_id IS NULL AND deleted_at IS NULL),
        cada um com subcards/subcards_resumo/imagens embutidos. Filtro
        opcional por lista de projeto_id — None ou lista vazia retorna
        todos os projetos."""
        query = (
            f"SELECT {self._CARD_COLUMNS} FROM cards "
            "WHERE parent_id IS NULL AND deleted_at IS NULL"
        )
        params: list = []
        if projeto_ids:
            placeholders = ",".join("?" * len(projeto_ids))
            query += f" AND projeto_id IN ({placeholders})"
            params.extend(projeto_ids)
        query += " ORDER BY id ASC"

        async with self._conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        result = []
        for row in rows:
            card = self._row_to_card_dict(row)
            card["imagens"] = await self._list_images(card["id"])
            subcards = await self._list_active_subcards(card["id"])
            card["subcards"] = subcards
            if subcards:
                feitos = sum(1 for s in subcards if s["status"] == "feito")
                card["subcards_resumo"] = {"total": len(subcards), "feitos": feitos}
            else:
                card["subcards_resumo"] = None
            result.append(card)
        return result

    async def update(
        self, card_id: int, *, ultima_atualizacao_por: str, **fields
    ) -> dict | None:
        """PATCH genérico — serve card de topo e subcard indistintamente.
        Aceita titulo/descricao/status como chaves de `fields`; só as chaves
        presentes E não-None são aplicadas (chaves ausentes ou None são
        tratadas como "não veio no PATCH", não como "limpar o campo").
        `ultima_atualizacao_por` é um argumento nomeado separado (não faz
        parte de `**fields`) porque toda atualização precisa setá-lo,
        diferente dos demais campos que são todos opcionais. Retorna o dict
        atualizado, ou None se o id não existe ou já está soft-deletado."""
        current = await self.get(card_id)
        if current is None or current["deleted_at"] is not None:
            return None

        allowed_columns = ("titulo", "descricao", "status")
        set_clauses = []
        values: list = []
        for column in allowed_columns:
            if fields.get(column) is not None:
                set_clauses.append(f"{column} = ?")
                values.append(fields[column])

        now = time.time()
        set_clauses.append("atualizado_em = ?")
        values.append(now)
        set_clauses.append("ultima_atualizacao_por = ?")
        values.append(ultima_atualizacao_por)
        values.append(card_id)

        await self._conn.execute(
            f"UPDATE cards SET {', '.join(set_clauses)} WHERE id = ?",
            values,
        )
        await self._conn.commit()
        return await self.get(card_id)

    async def soft_delete(self, card_id: int) -> dict:
        """Marca deleted_at=now. Se o card é de topo (parent_id IS NULL) e
        tem subcards ativos, cascade soft-delete neles também (um subcard
        não tem onde ser renderizado sem o pai visível). Soft-deletar um
        subcard individualmente não afeta o pai nem os irmãos. Retorna
        {"card_id": card_id, "subcards_afetados": N}."""
        now = time.time()
        current = await self.get(card_id)

        subcards_afetados = 0
        if current is not None and current["parent_id"] is None:
            async with self._conn.execute(
                "SELECT id FROM cards WHERE parent_id = ? AND deleted_at IS NULL",
                (card_id,),
            ) as cursor:
                subcard_rows = await cursor.fetchall()
            subcards_afetados = len(subcard_rows)
            if subcards_afetados:
                await self._conn.execute(
                    "UPDATE cards SET deleted_at = ? WHERE parent_id = ? AND deleted_at IS NULL",
                    (now, card_id),
                )

        await self._conn.execute(
            "UPDATE cards SET deleted_at = ? WHERE id = ?",
            (now, card_id),
        )
        await self._conn.commit()
        return {"card_id": card_id, "subcards_afetados": subcards_afetados}

    async def count_active_subcards(self, card_id: int) -> int:
        """Leitura pura, sem side-effect — usada pela UI para mostrar "N
        subtarefas" antes de confirmar exclusão, sem reconstruir a árvore
        inteira via list_top_level."""
        async with self._conn.execute(
            "SELECT COUNT(*) FROM cards WHERE parent_id = ? AND deleted_at IS NULL",
            (card_id,),
        ) as cursor:
            row = await cursor.fetchone()
        return row[0]

    # -- imagens --------------------------------------------------------------

    async def add_image(
        self, card_id: int, filename: str, mime_type: str, size_bytes: int
    ) -> int:
        """Insere uma linha de card_images, rejeitando com ValueError se o
        card já tem 5 imagens ativas (limite de negócio)."""
        async with self._conn.execute(
            "SELECT COUNT(*) FROM card_images WHERE card_id = ?",
            (card_id,),
        ) as cursor:
            row = await cursor.fetchone()
        if row[0] >= 5:
            raise ValueError(
                f"Card {card_id} já atingiu o limite de 5 imagens"
            )

        criado_em = time.time()
        cursor = await self._conn.execute(
            """
            INSERT INTO card_images (card_id, filename, mime_type, size_bytes, criado_em)
            VALUES (?, ?, ?, ?, ?)
            """,
            (card_id, filename, mime_type, size_bytes, criado_em),
        )
        await self._conn.commit()
        return cursor.lastrowid

    async def delete_image(self, card_id: int, image_id: int) -> str | None:
        """Apaga a linha de card_images filtrando por card_id E image_id
        juntos (por segurança — não deixa apagar imagem de outro card).
        Retorna o filename apagado (para o chamador remover o arquivo do
        disco — CardStore nunca toca em filesystem) ou None se não achou."""
        async with self._conn.execute(
            "SELECT filename FROM card_images WHERE card_id = ? AND id = ?",
            (card_id, image_id),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None

        await self._conn.execute(
            "DELETE FROM card_images WHERE card_id = ? AND id = ?",
            (card_id, image_id),
        )
        await self._conn.commit()
        return row[0]

    # -- limpar concluídos ------------------------------------------------

    async def _selecionar_alvo_limpar(
        self, projeto_id: str
    ) -> tuple[list[int], list[int]]:
        """Passos 1-3 da seção 5.4 do Arquiteto. pais_ids = cards de topo do
        projeto com status='feito' e ativos. subcards_ids = TODOS os
        subcards desses pais, INCLUSIVE os já soft-deletados (proposital:
        se o pai está sumindo de qualquer forma, não há razão para deixar
        uma linha soft-deletada órfã para trás — ver "nota de
        interpretação" da seção 5.4 de 05-ARQUITETO.md). Método privado
        reaproveitado por preview_limpar_concluidos e
        executar_limpar_concluidos para os dois nunca divergirem."""
        async with self._conn.execute(
            """
            SELECT id FROM cards
            WHERE projeto_id = ? AND parent_id IS NULL
              AND status = 'feito' AND deleted_at IS NULL
            """,
            (projeto_id,),
        ) as cursor:
            pais_rows = await cursor.fetchall()
        pais_ids = [row[0] for row in pais_rows]

        if not pais_ids:
            return [], []

        placeholders = ",".join("?" * len(pais_ids))
        async with self._conn.execute(
            f"SELECT id FROM cards WHERE parent_id IN ({placeholders})",
            pais_ids,
        ) as cursor:
            sub_rows = await cursor.fetchall()
        subcards_ids = [row[0] for row in sub_rows]

        return pais_ids, subcards_ids

    async def preview_limpar_concluidos(self, projeto_id: str) -> dict:
        """Dry-run: recalcula a mesma seleção usada pela execução real, mas
        não escreve nada no banco. Retorna {"cards": N, "imagens": M}."""
        pais_ids, subcards_ids = await self._selecionar_alvo_limpar(projeto_id)
        alvo = pais_ids + subcards_ids
        if not alvo:
            return {"cards": 0, "imagens": 0}

        placeholders = ",".join("?" * len(alvo))
        async with self._conn.execute(
            f"SELECT COUNT(*) FROM card_images WHERE card_id IN ({placeholders})",
            alvo,
        ) as cursor:
            row = await cursor.fetchone()
        return {"cards": len(alvo), "imagens": row[0]}

    async def executar_limpar_concluidos(self, projeto_id: str) -> dict:
        """Recalcula _selecionar_alvo_limpar de novo (não confia num preview
        anterior, que pode ter ficado desatualizado). Roda o DELETE de
        card_images + cards na mesma transação explícita (BEGIN/COMMIT via
        aiosqlite — o padrão idiomático aqui é executar "BEGIN" manualmente
        e usar commit()/rollback() da conexão para fechar a transação,
        já que os SELECTs de leitura acima não abrem transação implícita
        no sqlite3/aiosqlite). CardStore nunca toca em filesystem — só
        retorna os (card_id, filename) que o endpoint (Tarefa 6) deve
        remover do disco, best-effort, fora desta transação."""
        pais_ids, subcards_ids = await self._selecionar_alvo_limpar(projeto_id)
        alvo = pais_ids + subcards_ids
        if not alvo:
            return {"cards": 0, "imagens": 0, "filenames_apagados": []}

        placeholders = ",".join("?" * len(alvo))
        async with self._conn.execute(
            f"SELECT card_id, filename FROM card_images WHERE card_id IN ({placeholders})",
            alvo,
        ) as cursor:
            image_rows = await cursor.fetchall()
        filenames_apagados = [(row[0], row[1]) for row in image_rows]

        await self._conn.execute("BEGIN")
        try:
            await self._conn.execute(
                f"DELETE FROM card_images WHERE card_id IN ({placeholders})",
                alvo,
            )
            await self._conn.execute(
                f"DELETE FROM cards WHERE id IN ({placeholders})",
                alvo,
            )
        except Exception:
            await self._conn.rollback()
            raise
        else:
            await self._conn.commit()

        return {
            "cards": len(alvo),
            "imagens": len(filenames_apagados),
            "filenames_apagados": filenames_apagados,
        }
