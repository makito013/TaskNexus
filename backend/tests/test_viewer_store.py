"""Testes do ViewerStore (Fase V, Parte 6 seção 6.4.5): abas por sessão,
reaproveitamento da aba do mesmo caminho e limite de 15 por sessão."""
from __future__ import annotations

import asyncio
import re
import sqlite3

import pytest
import pytest_asyncio

from app.viewer_store import MAX_ITEMS_PER_SESSION, ViewerStore, new_item_id

SK = "podesubir/tasknexus::claude"


@pytest_asyncio.fixture
async def store(tmp_path):
    s = ViewerStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


async def _open(store, path, session_key=SK, **overrides):
    kwargs = dict(
        session_key=session_key,
        project_id=session_key.partition("::")[0],
        path=path,
        title=None,
        line=None,
        kind="markdown",
        language="markdown",
        opened_by="agent",
    )
    kwargs.update(overrides)
    return await store.open_item(**kwargs)


def test_item_id_format():
    item_id = new_item_id()
    assert re.fullmatch(r"vw_[A-Za-z0-9_-]{22}", item_id)
    assert new_item_id() != item_id


@pytest.mark.asyncio
async def test_open_creates_item_with_the_documented_shape(store):
    item, reused, evicted = await _open(store, "docs/relatorio.html",
                                        kind="html", language="html")
    assert reused is False
    assert evicted == []
    assert set(item) == {
        "item_id", "session_key", "project_id", "path", "title", "line",
        "kind", "language", "opened_by", "created_at", "updated_at",
    }
    assert item["item_id"].startswith("vw_")
    assert item["session_key"] == SK
    assert item["project_id"] == "podesubir/tasknexus"
    assert item["path"] == "docs/relatorio.html"
    # Título padrão: nome do arquivo.
    assert item["title"] == "relatorio.html"
    assert item["line"] is None
    assert item["kind"] == "html"
    assert item["language"] == "html"
    assert item["opened_by"] == "agent"
    assert item["created_at"] == item["updated_at"]


@pytest.mark.asyncio
async def test_same_path_reuses_the_tab_and_updates_line_and_updated_at(store):
    first, _, _ = await _open(store, "docs/plano.md", title="Plano")
    await asyncio.sleep(0.01)
    second, reused, evicted = await _open(store, "docs/plano.md", line=42)
    assert reused is True
    assert evicted == []
    assert second["item_id"] == first["item_id"]
    assert second["line"] == 42
    assert second["updated_at"] > first["updated_at"]
    assert second["created_at"] == first["created_at"]
    # Sem título novo, o nome curto dado antes continua.
    assert second["title"] == "Plano"
    third, _, _ = await _open(store, "docs/plano.md", title="Plano v2")
    assert third["title"] == "Plano v2"
    assert len(await store.list_for_session(SK)) == 1


@pytest.mark.asyncio
async def test_reuse_false_creates_a_duplicate_tab(store):
    first, _, _ = await _open(store, "a.md")
    second, reused, _ = await _open(store, "a.md", reuse=False)
    assert reused is False
    assert second["item_id"] != first["item_id"]


@pytest.mark.asyncio
async def test_same_path_in_another_session_is_a_different_tab(store):
    first, _, _ = await _open(store, "a.md")
    other, reused, _ = await _open(store, "a.md", session_key="outro::claude")
    assert reused is False
    assert other["item_id"] != first["item_id"]


@pytest.mark.asyncio
async def test_list_is_in_creation_order_even_after_reuse(store):
    a, _, _ = await _open(store, "a.md")
    b, _, _ = await _open(store, "b.md")
    c, _, _ = await _open(store, "c.md")
    # Reabrir "a" atualiza updated_at mas não muda a posição da aba.
    await _open(store, "a.md", line=3)
    ids = [item["item_id"] for item in await store.list_for_session(SK)]
    assert ids == [a["item_id"], b["item_id"], c["item_id"]]


@pytest.mark.asyncio
async def test_limit_evicts_the_least_recently_updated_tab(store):
    opened = []
    for i in range(MAX_ITEMS_PER_SESSION):
        item, _, evicted = await _open(store, f"f{i}.md")
        assert evicted == []
        opened.append(item["item_id"])
    # Reabrir f0 a torna a mais recente: quem sai é f1.
    await _open(store, "f0.md")
    new_item, reused, evicted = await _open(store, "novo.md")
    assert reused is False
    assert evicted == [opened[1]]
    ids = [item["item_id"] for item in await store.list_for_session(SK)]
    assert len(ids) == MAX_ITEMS_PER_SESSION
    assert opened[1] not in ids
    assert opened[0] in ids
    assert new_item["item_id"] in ids


@pytest.mark.asyncio
async def test_limit_is_per_session(store):
    for i in range(MAX_ITEMS_PER_SESSION):
        await _open(store, f"f{i}.md")
    _, _, evicted = await _open(store, "x.md", session_key="outra::codex")
    assert evicted == []
    assert len(await store.list_for_session(SK)) == MAX_ITEMS_PER_SESSION


@pytest.mark.asyncio
async def test_concurrent_opens_of_the_same_path_do_not_duplicate(store):
    results = await asyncio.gather(*[_open(store, "mesmo.md") for _ in range(5)])
    assert len({item["item_id"] for item, _, _ in results}) == 1
    assert sum(1 for _, reused, _ in results if not reused) == 1
    assert len(await store.list_for_session(SK)) == 1


@pytest.mark.asyncio
async def test_get_unknown_returns_none(store):
    assert await store.get("vw_nao_existe") is None


@pytest.mark.asyncio
async def test_delete_is_scoped_to_the_session(store):
    item, _, _ = await _open(store, "a.md")
    assert await store.delete("outra::claude", item["item_id"]) is False
    assert await store.get(item["item_id"]) is not None
    assert await store.delete(SK, item["item_id"]) is True
    assert await store.get(item["item_id"]) is None
    assert await store.delete(SK, item["item_id"]) is False


@pytest.mark.asyncio
async def test_clear_for_session_returns_count_and_spares_other_sessions(store):
    await _open(store, "a.md")
    await _open(store, "b.md")
    await _open(store, "a.md", session_key="outra::claude")
    assert await store.clear_for_session(SK) == 2
    assert await store.list_for_session(SK) == []
    assert len(await store.list_for_session("outra::claude")) == 1
    assert await store.clear_for_session(SK) == 0


@pytest.mark.asyncio
async def test_items_persist_across_instances(tmp_path):
    db = str(tmp_path / "persist.db")
    first = ViewerStore(db_path=db)
    await first.initialize()
    item, _, _ = await _open(first, "docs/a.md")
    await first.close()

    second = ViewerStore(db_path=db)
    await second.initialize()
    try:
        assert await second.get(item["item_id"]) == item
    finally:
        await second.close()


@pytest.mark.asyncio
async def test_schema_has_the_documented_index(store, tmp_path):
    conn = sqlite3.connect(str(tmp_path / "test.db"))
    try:
        indexes = {row[1] for row in conn.execute("PRAGMA index_list('viewer_items')")}
    finally:
        conn.close()
    assert "ix_viewer_items_session" in indexes
