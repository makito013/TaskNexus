from __future__ import annotations

import json
import time

import aiosqlite

from app.models import Agent


class GlobalAgentStore:
    """Agentes cadastrados globalmente (settings da UI) — atribuídos como a
    lista `agentes` de todo projeto elegível em scan_projects (ver
    agent_discovery.scan_projects). Mesmo padrão de conexão/CREATE TABLE IF
    NOT EXISTS de TaskStore, ver task_store.py."""

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
            CREATE TABLE IF NOT EXISTS global_agents (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                papel TEXT NOT NULL,
                ia TEXT NOT NULL,
                cmd TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        # env foi adicionado depois da tabela original — ALTER TABLE ADD COLUMN
        # é a única forma de trazer bancos já existentes (sessions.db de
        # instalações anteriores) para o novo schema; CREATE TABLE IF NOT
        # EXISTS acima não toca tabelas que já existem.
        async with self._conn.execute("PRAGMA table_info(global_agents)") as cursor:
            columns = {row[1] async for row in cursor}
        if "env" not in columns:
            await self._conn.execute("ALTER TABLE global_agents ADD COLUMN env TEXT")
        await self._conn.commit()

    def _row_to_agent(self, row) -> Agent:
        return Agent(
            id=row[0], nome=row[1], papel=row[2], ia=row[3],
            cmd=json.loads(row[4]),
            env=json.loads(row[5]) if row[5] else {},
        )

    async def list_all(self) -> list[Agent]:
        async with self._conn.execute(
            "SELECT id, nome, papel, ia, cmd, env FROM global_agents ORDER BY id ASC"
        ) as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_agent(row) for row in rows]

    async def create(self, agent: Agent) -> Agent:
        now = time.time()
        try:
            await self._conn.execute(
                """
                INSERT INTO global_agents (id, nome, papel, ia, cmd, env, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (agent.id, agent.nome, agent.papel, agent.ia, json.dumps(agent.cmd),
                 json.dumps(agent.env), now, now),
            )
            await self._conn.commit()
        except aiosqlite.IntegrityError:
            raise ValueError(f"Agent id already exists: {agent.id}")
        return Agent(id=agent.id, nome=agent.nome, papel=agent.papel, ia=agent.ia,
                      cmd=agent.cmd, env=agent.env)

    async def update(self, agent_id: str, agent: Agent) -> Agent | None:
        async with self._conn.execute(
            "SELECT id FROM global_agents WHERE id = ?", (agent_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        await self._conn.execute(
            """
            UPDATE global_agents SET nome = ?, papel = ?, ia = ?, cmd = ?, env = ?, updated_at = ?
            WHERE id = ?
            """,
            (agent.nome, agent.papel, agent.ia, json.dumps(agent.cmd), json.dumps(agent.env),
             time.time(), agent_id),
        )
        await self._conn.commit()
        return Agent(id=agent_id, nome=agent.nome, papel=agent.papel, ia=agent.ia,
                      cmd=agent.cmd, env=agent.env)

    async def delete(self, agent_id: str) -> bool:
        async with self._conn.execute(
            "SELECT id FROM global_agents WHERE id = ?", (agent_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return False
        await self._conn.execute("DELETE FROM global_agents WHERE id = ?", (agent_id,))
        await self._conn.commit()
        return True

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
