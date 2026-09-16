from __future__ import annotations

import asyncio
import time

import aiosqlite

from .board_columns import normalize_column_label, slugify_column_label

# The four columns every pre-existing board had hard-coded. They are seeded
# into `board_columns` on the first initialize() that finds the table empty —
# after that the table is the only source of truth and this tuple is never
# consulted again (re-seeding a board the user has since edited would
# resurrect columns they deleted).
_SEED_COLUMNS = (
    ("a_fazer", "A Fazer", 1, 0),
    ("em_andamento", "Em Andamento", 2, 0),
    ("em_revisao", "Em Revisão", 3, 0),
    ("feito", "Feito", 4, 1),
)


# Shown for a migrated column whose slug is the raw status of a legacy card and
# carries no visible text of its own (a status of "   " or ""). The slug stays
# untouched — rewriting it would re-orphan the cards — but the label has to be
# something the user can read in the header and name in a conversation.
_EMPTY_ORPHAN_LABEL = "(sem nome)"


def _orphan_column_label(status: str) -> str:
    """Label for a column fabricated from a legacy card's raw status."""
    return status.strip() or _EMPTY_ORPHAN_LABEL


class ColumnDeleteError(ValueError):
    """Column deletion refused. Carries a machine-readable `reason` alongside
    the message because the frontend shows a DIFFERENT dialog for each of the
    three refusals (it is the done column / it is the last one / it still has
    N cards), and matching on prose would break the moment the wording
    changes. Subclasses ValueError so existing `except ValueError` handlers
    keep catching it."""

    def __init__(self, reason: str, message: str, cards: int = 0):
        super().__init__(message)
        self.reason = reason
        self.cards = cards


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
        # Guards EVERY method that WRITES on this connection — not just the
        # ones that open an explicit BEGIN. Transaction state in sqlite is per
        # CONNECTION, not per coroutine, so a commit() from any other method
        # lands inside whatever transaction happens to be open and ends it
        # early; the `except -> rollback` that follows then has nothing left to
        # undo. Covering only the BEGIN blocks (as this lock originally did)
        # isolated them from each other and from nothing else, which is how
        # `create()` could commit the middle of `delete_column()`'s
        # count-then-DELETE (bug #3 do QA).
        #
        # Serialising every write costs throughput that a local single-user
        # SQLite file does not have to care about — the writes it serialises
        # would be serialised by the file lock anyway.
        #
        # NOT reentrant: only the outermost writing method may take it, and no
        # method holding it may call another one that takes it. That is why
        # every helper called from inside a locked block (`get`,
        # `list_columns`, `_list_images`, `_existing_slugs`, …) is read-only
        # and lock-free.
        #
        # Known, accepted limit: READS are not covered. A read issued while
        # another coroutine holds an open transaction observes that
        # transaction's uncommitted rows, because it is the same connection.
        # Locking the read paths too would deadlock against the helpers above
        # without a reentrant lock, and the exposure is a momentarily optimistic
        # board that the next poll corrects — not lost or corrupted data.
        self._tx_lock = asyncio.Lock()

    async def initialize(self) -> None:
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
                deleted_at REAL,
                tipo TEXT,
                prazo TEXT,
                board_position REAL
            )
            """
        )
        # `tipo` and `prazo` were added after the original table shipped. The
        # CREATE TABLE above already lists them, so a brand-new sessions.db
        # gets them from the start; the ALTER TABLE block below is
        # belt-and-suspenders for a pre-existing sessions.db, where CREATE
        # TABLE IF NOT EXISTS is a no-op that never touches a table that
        # already exists. On a new DB the columns are already present, so the
        # PRAGMA check skips both ALTERs. Same style (PRAGMA table_info + set)
        # as agent_store.py. No DEFAULT, no backfill, no index: nullable
        # columns at the end of the table.
        async with self._conn.execute("PRAGMA table_info(cards)") as cursor:
            card_columns = {row[1] async for row in cursor}
        if "tipo" not in card_columns:
            await self._conn.execute("ALTER TABLE cards ADD COLUMN tipo TEXT")
        if "prazo" not in card_columns:
            await self._conn.execute("ALTER TABLE cards ADD COLUMN prazo TEXT")
        # `board_position` follows the very same pattern one column later. REAL
        # (not INTEGER) from the start: Phase 3 inserts a card BETWEEN two
        # others by averaging their positions, which needs fractions.
        if "board_position" not in card_columns:
            await self._conn.execute(
                "ALTER TABLE cards ADD COLUMN board_position REAL"
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
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_columns (
                slug TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                position INTEGER NOT NULL,
                is_done INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        # Partial unique index: at most ONE row may carry is_done = 1 (rows
        # with is_done = 0 are not indexed at all, so they never collide). This
        # is what makes "exactly one done column" an invariant of the schema
        # rather than a convention every writer has to remember.
        await self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_board_columns_done "
            "ON board_columns(is_done) WHERE is_done = 1"
        )
        await self._conn.commit()

        await self._seed_board_columns()
        await self._backfill_board_position()

    async def _seed_board_columns(self) -> None:
        """One-shot seeding of `board_columns`, idempotent by the COUNT(*) == 0
        guard: once the table holds any row at all, this is a no-op forever.

        The orphan scan lives INSIDE that guard on purpose. As a standing scan
        it would resurrect, on every boot, a column the user deleted while a
        soft-deleted-then-restored card still referenced it. It only has to run
        once — at the moment the board stops being four hard-coded statuses —
        to make sure no ACTIVE card ends up with a status no column renders.
        Soft-deleted cards are excluded from the scan for the same reason: a
        dirty status on a deleted row would become a permanent column nobody
        asked for."""
        async with self._tx_lock:
            async with self._conn.execute(
                "SELECT COUNT(*) FROM board_columns"
            ) as cursor:
                (existing,) = await cursor.fetchone()
            if existing:
                return

            async with self._conn.execute(
                "SELECT DISTINCT status FROM cards WHERE deleted_at IS NULL"
            ) as cursor:
                active_statuses = [row[0] for row in await cursor.fetchall()]

            seeded_slugs = {slug for slug, _, _, _ in _SEED_COLUMNS}
            orphans = sorted(
                s for s in active_statuses if s and s not in seeded_slugs
            )

            await self._conn.execute("BEGIN")
            try:
                await self._conn.executemany(
                    "INSERT INTO board_columns (slug, label, position, is_done) "
                    "VALUES (?, ?, ?, ?)",
                    _SEED_COLUMNS,
                )
                next_position = len(_SEED_COLUMNS)
                for orphan in orphans:
                    next_position += 1
                    # The SLUG is the raw status, always — anything else would
                    # re-orphan the very cards this column exists to render.
                    # The LABEL goes through _orphan_column_label, because a
                    # status of "   " would otherwise produce a column that is
                    # invisible in the UI and impossible to refer to. is_done =
                    # 0 always: the done column is already `feito`, and the
                    # partial index forbids a second.
                    await self._conn.execute(
                        "INSERT INTO board_columns (slug, label, position, is_done) "
                        "VALUES (?, ?, ?, 0)",
                        (orphan, _orphan_column_label(orphan), next_position),
                    )
            except Exception:
                await self._conn.rollback()
                raise
            else:
                await self._conn.commit()

    async def _backfill_board_position(self) -> None:
        """Give every pre-existing top-level card a position derived from its
        id, preserving exactly the ordering `ORDER BY id ASC` produced before
        this column existed.

        Idempotent through its own WHERE: a row that already has a position
        (including one the user has since dragged to 2.5) is never touched.
        Subcards are excluded — they have no board position, they are ordered
        by id inside their parent."""
        await self._conn.execute(
            "UPDATE cards SET board_position = id * 1.0 "
            "WHERE parent_id IS NULL AND board_position IS NULL"
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
            "tipo": row[12],
            "prazo": row[13],
            "board_position": row[14],
        }

    _CARD_COLUMNS = (
        "id, titulo, projeto_id, parent_id, status, origem, "
        "ultima_atualizacao_por, descricao, session_key, criado_em, "
        "atualizado_em, deleted_at, tipo, prazo, board_position"
    )

    # Scalar subquery computing "one past the last card of this column".
    # Written as a subquery rather than a SELECT followed by a write because
    # CardStore shares ONE connection: reading the max and then writing it back
    # as two statements is a lost-update race between concurrent creates. The
    # MAX is global (no projeto_id filter) because columns are global — a
    # per-project sequence would make two cards of different projects share a
    # position, which Phase 3's anchor-based move cannot resolve.
    _NEXT_POSITION_SQL = (
        "COALESCE((SELECT MAX(board_position) FROM cards "
        "WHERE status = ? AND parent_id IS NULL) + 1.0, 0.0)"
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
        tipo: str | None = None,
        prazo: str | None = None,
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

        # `"" -> None` on the way in: the "clear" sentinel only makes sense on
        # update; on create, an empty string is just an absent value. Without
        # this the INSERT would store "" and the database would end up with
        # two representations of "no tipo" (NULL and "") — any future
        # `WHERE tipo IS NULL` would get it wrong.
        tipo = tipo or None
        prazo = prazo or None

        now = time.time()
        # A top-level card is born at the END of its destination column
        # (MAX + 1.0, or 0.0 when the column is empty); a subcard has no board
        # position at all and keeps NULL. Computed inside the INSERT, so there
        # is no window between reading the max and using it.
        position_sql = "NULL" if parent_id is not None else self._NEXT_POSITION_SQL
        position_params: tuple = () if parent_id is not None else (status,)
        # Under _tx_lock: this commit used to be able to land inside
        # delete_column's open count-then-DELETE transaction and end it early,
        # which is exactly how a card created in the column being deleted got
        # lost (bug #3 do QA).
        async with self._tx_lock:
            cursor = await self._conn.execute(
                f"""
                INSERT INTO cards (
                    titulo, projeto_id, parent_id, status, origem,
                    ultima_atualizacao_por, descricao, session_key,
                    criado_em, atualizado_em, tipo, prazo, board_position
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {position_sql})
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
                    tipo,
                    prazo,
                    *position_params,
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
        # `id ASC` stays as the tiebreaker: two cards can legitimately share a
        # position (nothing in the schema forbids it), and an unstable order
        # would make the board shuffle on every poll.
        query += " ORDER BY board_position ASC, id ASC"

        async with self._conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        return await self._hydrate_top_level_rows(rows)

    async def list_by_cliente(self, cliente_id: str) -> list[dict]:
        """Cards de topo ativos de TODOS os projetos de um cliente — o próprio
        cliente-como-projeto (projeto_id == cliente_id) mais todos os
        sub-projetos (projeto_id começando por "{cliente_id}/"). Mesmo formato
        hidratado de list_top_level (subcards/subcards_resumo/imagens), via o
        mesmo helper, para que os dois caminhos de listagem sejam
        indistinguíveis para quem consome.

        Existe porque listar por cliente não é expressável com list_top_level:
        a lista de sub-projetos não é conhecida pelo CardStore (vem de
        scan_projects, no processo do backend) e um card pode estar num
        projeto cuja pasta já não existe mais.

        Predicado sem wildcard de propósito. O braço de igualdade
        (projeto_id = ?) usa idx_cards_projeto; o braço de prefixo compara
        substr(projeto_id, 1, len) com "{cliente_id}/" literal — sem semântica
        de padrão nenhuma. LIKE está descartado porque "_" é wildcard de 1
        caractere no LIKE e nomes reais de cliente TÊM underscore
        (ex: "cliente_projeto_1", o exemplo canônico da docstring de
        cliente_id_from_projeto_id): LIKE 'cliente_projeto_1/%' casaria também
        com "clienteXprojetoY1/..." — vazamento cross-tenant real. GLOB
        resolveria o "_" mas ainda interpreta "[" como classe de caracteres;
        substr não interpreta nada e compara com collation BINARY
        (case-sensitive), que é o que a regra de isolamento por cliente exige.
        """
        prefix = cliente_id + "/"
        async with self._conn.execute(
            f"""
            SELECT {self._CARD_COLUMNS} FROM cards
            WHERE (projeto_id = ? OR substr(projeto_id, 1, ?) = ?)
              AND parent_id IS NULL AND deleted_at IS NULL
            ORDER BY board_position ASC, id ASC
            """,
            (cliente_id, len(prefix), prefix),
        ) as cursor:
            rows = await cursor.fetchall()

        return await self._hydrate_top_level_rows(rows)

    async def _hydrate_top_level_rows(self, rows) -> list[dict]:
        """Hidratação compartilhada por list_top_level/list_by_cliente: para
        cada linha de card de topo, embute imagens, subcards ativos e o
        subcards_resumo derivado. Extraído para que os dois caminhos de
        listagem retornem provadamente o MESMO formato (o consumidor —
        UI e tool MCP listar_cards — não pode depender de qual dos dois
        rodou)."""
        # Resolved ONCE for the whole batch, not per row: the done column is
        # the same for every card, and a per-row lookup would be one extra
        # SELECT per card on the board's 5s poll.
        #
        # `require_*`, not the nullable getter: with no done column, every
        # `s["status"] == None` is False and EVERY card would quietly report
        # "0 de N concluídos" — a wrong number that looks like a real one.
        # The state is unreachable in practice (the partial unique index plus
        # set_done_column's pre-validation keep exactly one mark alive), so
        # failing loud here costs nothing and makes a broken board obvious
        # instead of subtly wrong.
        done_slug = await self.require_done_slug()
        result = []
        for row in rows:
            card = self._row_to_card_dict(row)
            card["imagens"] = await self._list_images(card["id"])
            subcards = await self._list_active_subcards(card["id"])
            card["subcards"] = subcards
            if subcards:
                feitos = sum(1 for s in subcards if s["status"] == done_slug)
                card["subcards_resumo"] = {"total": len(subcards), "feitos": feitos}
            else:
                card["subcards_resumo"] = None
            result.append(card)
        return result

    async def update(
        self, card_id: int, *, ultima_atualizacao_por: str, **fields
    ) -> dict | None:
        """PATCH genérico — serve card de topo e subcard indistintamente.
        Aceita titulo/descricao/status/tipo/prazo como chaves de `fields`; só
        as chaves presentes E não-None são aplicadas (chaves ausentes ou None
        são tratadas como "não veio no PATCH", não como "limpar o campo").
        Exception: for `tipo` and `prazo`, the empty string "" IS the "clear"
        sentinel and writes NULL — `titulo=""` is still dropped (titulo never
        had clear semantics and the modal blocks an empty submit).
        `ultima_atualizacao_por` é um argumento nomeado separado (não faz
        parte de `**fields`) porque toda atualização precisa setá-lo,
        diferente dos demais campos que são todos opcionais. Retorna o dict
        atualizado, ou None se o id não existe ou já está soft-deletado."""
        current = await self.get(card_id)
        if current is None or current["deleted_at"] is not None:
            return None

        allowed_columns = ("titulo", "descricao", "status", "tipo", "prazo")
        set_clauses = []
        values: list = []
        for column in allowed_columns:
            # The guard tests the RECEIVED value (None => field absent from the
            # PATCH); the "" -> None normalization applies to the BOUND value.
            # Normalizing before the guard would turn "" into None and drop the
            # field itself — "clear" would become a no-op returning 200.
            value = fields.get(column)
            if value is None:
                continue
            if column in ("tipo", "prazo") and value == "":
                value = None
            set_clauses.append(f"{column} = ?")
            values.append(value)

        # Moving a top-level card to ANOTHER column re-appends it at the end of
        # the destination — the only ordering a plain status change can produce
        # without a drop target. The test is the VALUE, never the presence of
        # the key: CardFormModal re-submits the whole form, so `status` arrives
        # on every save, and "key is present" would fling a card that only had
        # its title edited to the bottom of its own column, silently destroying
        # the manual ordering.
        new_status = fields.get("status")
        status_changing = new_status is not None and new_status != current["status"]
        if status_changing and current["parent_id"] is None:
            set_clauses.append(f"board_position = {self._NEXT_POSITION_SQL}")
            values.append(new_status)

        now = time.time()
        set_clauses.append("atualizado_em = ?")
        values.append(now)
        set_clauses.append("ultima_atualizacao_por = ?")
        values.append(ultima_atualizacao_por)
        values.append(card_id)

        async with self._tx_lock:
            await self._conn.execute(
                f"UPDATE cards SET {', '.join(set_clauses)} WHERE id = ?",
                values,
            )
            await self._conn.commit()
        return await self.get(card_id)

    # -- colunas do board ---------------------------------------------------
    #
    # Escopo GLOBAL (decisão de produto do Bruno): não há coluna por projeto.
    # O `slug` é IMUTÁVEL — é o valor gravado em `cards.status` — e só o
    # `label` é editável. Todos os métodos que abrem transação explícita aqui
    # tomam `_tx_lock` e NENHUM deles chama outro que também o tome (o lock
    # não é reentrante).

    @staticmethod
    def _row_to_column_dict(row) -> dict:
        return {
            "slug": row[0],
            "label": row[1],
            "position": row[2],
            "is_done": bool(row[3]),
        }

    async def list_columns(self) -> list[dict]:
        """Colunas na ordem do board. `slug ASC` como desempate para que duas
        colunas com a mesma position (possível: nada no schema o impede)
        nunca alternem de lugar entre dois GETs."""
        async with self._conn.execute(
            "SELECT slug, label, position, is_done FROM board_columns "
            "ORDER BY position ASC, slug ASC"
        ) as cursor:
            rows = await cursor.fetchall()
        return [self._row_to_column_dict(row) for row in rows]

    async def get_done_slug(self) -> str | None:
        """Slug da coluna marcada como concluída, ou None se não houver
        nenhuma (o que o índice único parcial torna improvável, mas não
        impossível: um banco só com a tabela criada e sem semeadura)."""
        async with self._conn.execute(
            "SELECT slug FROM board_columns WHERE is_done = 1"
        ) as cursor:
            row = await cursor.fetchone()
        return row[0] if row else None

    async def require_done_slug(self) -> str:
        """`get_done_slug` que falha alto. Usado onde "sem coluna concluída"
        não pode virar um no-op silencioso (limpar concluídos apagaria zero
        cards e devolveria sucesso)."""
        done_slug = await self.get_done_slug()
        if done_slug is None:
            raise ValueError(
                "Nenhuma coluna está marcada como concluída no board"
            )
        return done_slug

    async def _existing_slugs(self) -> set[str]:
        async with self._conn.execute("SELECT slug FROM board_columns") as cursor:
            return {row[0] async for row in cursor}

    async def _label_taken_by_other(self, label: str, except_slug: str | None) -> bool:
        """Duplicidade de label é BLOQUEADA (decisão de produto), comparada de
        forma case-insensitive e com espaços colapsados — feita em Python e não
        com `COLLATE NOCASE` porque NOCASE do SQLite só dobra ASCII: "Revisão"
        e "REVISÃO" passariam como distintas."""
        normalized = normalize_column_label(label)
        async with self._conn.execute(
            "SELECT slug, label FROM board_columns"
        ) as cursor:
            rows = await cursor.fetchall()
        return any(
            row[0] != except_slug and normalize_column_label(row[1]) == normalized
            for row in rows
        )

    async def create_column(self, label: str) -> dict:
        """Cria uma coluna no FIM da ordem. Nunca is_done: a marca de coluna
        concluída é transferida explicitamente por set_done_column."""
        label = (label or "").strip()
        if not label:
            raise ValueError("O nome da coluna não pode ser vazio")

        # Duplicidade de label, geração de slug e INSERT sob o mesmo lock:
        # separadas, duas criações simultâneas do mesmo nome passam as duas
        # pela checagem, e o slugify de ambas lê o mesmo conjunto `taken` —
        # gerando o MESMO slug, o que faria a segunda estourar IntegrityError
        # de PRIMARY KEY em vez do ValueError legível que a UI espera.
        async with self._tx_lock:
            if await self._label_taken_by_other(label, None):
                raise ValueError(f"Já existe uma coluna chamada '{label}'")

            taken = await self._existing_slugs()
            slug = slugify_column_label(label, taken)

            await self._conn.execute("BEGIN")
            try:
                await self._conn.execute(
                    "INSERT INTO board_columns (slug, label, position, is_done) "
                    "SELECT ?, ?, COALESCE(MAX(position), 0) + 1, 0 "
                    "FROM board_columns",
                    (slug, label),
                )
            except Exception:
                await self._conn.rollback()
                raise
            else:
                await self._conn.commit()

            async with self._conn.execute(
                "SELECT slug, label, position, is_done FROM board_columns WHERE slug = ?",
                (slug,),
            ) as cursor:
                row = await cursor.fetchone()
            return self._row_to_column_dict(row)

    async def update_column_label(self, slug: str, label: str) -> dict | None:
        """Renomeia uma coluna. O slug NUNCA muda junto — ele é o valor
        gravado em `cards.status`, e reescrevê-lo obrigaria a um UPDATE em
        massa de cards por uma operação puramente cosmética. Retorna None se
        a coluna não existe."""
        label = (label or "").strip()
        if not label:
            raise ValueError("O nome da coluna não pode ser vazio")

        # Existência, checagem de duplicidade e UPDATE sob o mesmo lock: fora
        # dele, dois renomeios simultâneos para o mesmo nome passam os dois
        # pela checagem e gravam labels duplicados — que é exatamente o que a
        # decisão de produto proíbe.
        async with self._tx_lock:
            async with self._conn.execute(
                "SELECT slug FROM board_columns WHERE slug = ?", (slug,)
            ) as cursor:
                if await cursor.fetchone() is None:
                    return None

            if await self._label_taken_by_other(label, slug):
                raise ValueError(f"Já existe uma coluna chamada '{label}'")

            await self._conn.execute(
                "UPDATE board_columns SET label = ? WHERE slug = ?", (label, slug)
            )
            await self._conn.commit()

            async with self._conn.execute(
                "SELECT slug, label, position, is_done FROM board_columns WHERE slug = ?",
                (slug,),
            ) as cursor:
                row = await cursor.fetchone()
            return self._row_to_column_dict(row)

    async def reorder_columns(self, slugs: list[str]) -> list[dict]:
        """Reescreve a ordem inteira do board. `slugs` precisa ser uma
        PERMUTAÇÃO EXATA do conjunto atual — não um subconjunto, não com
        repetição, não com um slug desconhecido. Aceitar um subconjunto
        deixaria as colunas de fora com a position antiga, intercalando-se de
        volta no meio da nova ordem de um jeito que ninguém pediu."""
        current = {c["slug"] for c in await self.list_columns()}
        if len(slugs) != len(set(slugs)) or set(slugs) != current:
            raise ValueError(
                "A nova ordem precisa conter exatamente as colunas existentes, "
                "uma vez cada"
            )

        async with self._tx_lock:
            await self._conn.execute("BEGIN")
            try:
                for position, slug in enumerate(slugs, start=1):
                    await self._conn.execute(
                        "UPDATE board_columns SET position = ? WHERE slug = ?",
                        (position, slug),
                    )
            except Exception:
                await self._conn.rollback()
                raise
            else:
                await self._conn.commit()

        return await self.list_columns()

    async def set_done_column(self, slug: str) -> list[dict]:
        """Transfere a marca de "coluna concluída" para `slug`. É um RÁDIO, não
        um toggle: exatamente uma coluna sempre a carrega.

        A existência do slug é validada ANTES de limpar a marca antiga, e —
        criticamente — DENTRO do lock, na mesma transação. Sem isso, o UPDATE
        de limpeza tem sucesso, o de marcação não acerta linha nenhuma, e o
        board fica sem coluna concluída.

        Validar fora do lock não resolve nada: a leitura confirma que a coluna
        existe, um delete_column concorrente daquele mesmo slug roda inteiro no
        intervalo, e a transação segue em frente marcando uma linha que já não
        está lá — o board perde a marca do mesmo jeito. Estar logicamente no
        lugar certo e transacionalmente no lugar errado é o mesmo que não
        estar (bug #2 do QA).

        Limpar e marcar na MESMA transação também é obrigatório na outra
        direção: o índice único parcial proíbe duas linhas com is_done = 1, o
        que força a ordem limpar-depois-marcar; se o processo morrer entre as
        duas, um commit intermediário teria deixado zero colunas concluídas."""
        async with self._tx_lock:
            await self._conn.execute("BEGIN")
            try:
                async with self._conn.execute(
                    "SELECT slug FROM board_columns WHERE slug = ?", (slug,)
                ) as cursor:
                    if await cursor.fetchone() is None:
                        raise ValueError(f"Coluna '{slug}' não existe")

                await self._conn.execute(
                    "UPDATE board_columns SET is_done = 0 WHERE is_done = 1"
                )
                await self._conn.execute(
                    "UPDATE board_columns SET is_done = 1 WHERE slug = ?", (slug,)
                )
            except Exception:
                await self._conn.rollback()
                raise
            else:
                await self._conn.commit()

        return await self.list_columns()

    # Motivos discrimináveis de recusa de exclusão. O frontend escolhe qual
    # dos três diálogos mostrar a partir deste código, não do texto da
    # mensagem — por isso ele viaja como dado, não só como prosa.
    DELETE_COLUMN_IS_DONE = "coluna_concluida"
    # DEFENSIVE, and unreachable through the API on purpose: the done column
    # can never be deleted, so the last surviving column always carries the
    # mark and DELETE_COLUMN_IS_DONE — checked first — is what refuses. This
    # branch only fires on a board whose done mark was cleared OUTSIDE the API
    # (hand-edited database, restore from a dump predating the partial index).
    # It is the last thing between such a board and zero columns, so it stays.
    # Reachability is pinned from both sides in test_card_store.py:
    # …is_last_is_unreachable_through_the_public_api / …fires_on_a_board_with_no_done_mark.
    DELETE_COLUMN_IS_LAST = "ultima_coluna"
    DELETE_COLUMN_HAS_CARDS = "coluna_com_cards"

    async def delete_column(self, slug: str) -> dict | None:
        """Exclui uma coluna vazia. Retorna None se a coluna não existe;
        levanta ColumnDeleteError (com `reason` + `cards`) nos três casos
        recusados.

        A contagem de cards NÃO filtra `parent_id`: um subcard também tem
        status e também desapareceria do resumo do pai se a coluna sumisse
        debaixo dele. Contagem e DELETE ficam na mesma transação para que um
        card criado no meio do caminho não seja perdido.

        TODAS as guardas — existência, is_done, última coluna, contagem de
        cards — leem DENTRO do lock, na mesma transação do DELETE. Ler o
        `is_done` antes de entrar no lock era o bug #1 do QA: a leitura via
        `is_done = 0`, um set_done_column concorrente movia a marca PARA este
        slug, e o DELETE removia a única coluna concluída do board. O índice
        único parcial garante NO MÁXIMO uma coluna concluída; nada no schema
        garante PELO MENOS uma, então essa garantia tem que vir daqui."""
        async with self._tx_lock:
            await self._conn.execute("BEGIN")
            try:
                async with self._conn.execute(
                    "SELECT slug, is_done FROM board_columns WHERE slug = ?",
                    (slug,),
                ) as cursor:
                    row = await cursor.fetchone()
                if row is None:
                    # Nada foi escrito ainda; o commit fecha a transação vazia.
                    await self._conn.commit()
                    return None
                if row[1]:
                    raise ColumnDeleteError(
                        self.DELETE_COLUMN_IS_DONE,
                        "A coluna concluída não pode ser excluída. Marque outra "
                        "coluna como concluída antes.",
                    )

                async with self._conn.execute(
                    "SELECT COUNT(*) FROM board_columns"
                ) as cursor:
                    (total,) = await cursor.fetchone()
                if total <= 1:
                    raise ColumnDeleteError(
                        self.DELETE_COLUMN_IS_LAST,
                        "O board precisa ter pelo menos uma coluna.",
                    )

                async with self._conn.execute(
                    "SELECT COUNT(*) FROM cards WHERE status = ? AND deleted_at IS NULL",
                    (slug,),
                ) as cursor:
                    (card_count,) = await cursor.fetchone()
                if card_count:
                    raise ColumnDeleteError(
                        self.DELETE_COLUMN_HAS_CARDS,
                        f"A coluna ainda tem {card_count} card(s). Mova-os para "
                        "outra coluna antes de excluí-la.",
                        cards=card_count,
                    )

                await self._conn.execute(
                    "DELETE FROM board_columns WHERE slug = ?", (slug,)
                )
            except Exception:
                await self._conn.rollback()
                raise
            else:
                await self._conn.commit()

        return {"slug": slug}

    async def soft_delete(self, card_id: int) -> dict:
        """Marca deleted_at=now. Se o card é de topo (parent_id IS NULL) e
        tem subcards ativos, cascade soft-delete neles também (um subcard
        não tem onde ser renderizado sem o pai visível). Soft-deletar um
        subcard individualmente não afeta o pai nem os irmãos. Retorna
        {"card_id": card_id, "subcards_afetados": N}."""
        now = time.time()
        current = await self.get(card_id)

        # The whole cascade under one lock hold: the parent and its subcards
        # have to become invisible together, and the count returned has to
        # describe what was actually written.
        async with self._tx_lock:
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
        card já tem 5 imagens ativas (limite de negócio). Contagem e INSERT
        sob o mesmo lock: fora dele, dois uploads simultâneos leem 4 cada um e
        gravam a 5ª e a 6ª."""
        async with self._tx_lock:
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
        async with self._tx_lock:
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
        self, projeto_id: str, done_slug: str
    ) -> tuple[list[int], list[int]]:
        """Passos 1-3 da seção 5.4 do Arquiteto. pais_ids = cards de topo do
        projeto com status='feito' e ativos. subcards_ids = TODOS os
        subcards desses pais, INCLUSIVE os já soft-deletados (proposital:
        se o pai está sumindo de qualquer forma, não há razão para deixar
        uma linha soft-deletada órfã para trás — ver "nota de
        interpretação" da seção 5.4 de 05-ARQUITETO.md). Método privado
        reaproveitado por preview_limpar_concluidos e
        executar_limpar_concluidos para os dois nunca divergirem.

        `done_slug` chega como PARÂMETRO, resolvido em Python pelos dois
        chamadores públicos — nunca como subquery
        `status = (SELECT slug FROM board_columns WHERE is_done = 1)`. Uma
        subquery que não casa com nada devolve NULL, o predicado vira
        silenciosamente "nenhum card", e a limpeza não limpa nada sem avisar.
        Resolver antes permite falhar alto (ver get_done_slug)."""
        async with self._conn.execute(
            """
            SELECT id FROM cards
            WHERE projeto_id = ? AND parent_id IS NULL
              AND status = ? AND deleted_at IS NULL
            """,
            (projeto_id, done_slug),
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
        done_slug = await self.require_done_slug()
        pais_ids, subcards_ids = await self._selecionar_alvo_limpar(
            projeto_id, done_slug
        )
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
        done_slug = await self.require_done_slug()
        pais_ids, subcards_ids = await self._selecionar_alvo_limpar(
            projeto_id, done_slug
        )
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

        # Under _tx_lock like every other explicit BEGIN on this connection:
        # without it, a commit from a concurrent create()/update() lands in the
        # middle of this transaction and commits half of the deletion.
        async with self._tx_lock:
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
