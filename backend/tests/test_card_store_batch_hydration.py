"""Card #213: the board/listar_cards hydration runs a few batched queries
instead of several per card. These tests pin that the batched output is the
same as the per-card hydration it replaced, and cover the create dedup window
at the store level."""

from __future__ import annotations

import time

import pytest
import pytest_asyncio

from app.card_store import CardStore


@pytest_asyncio.fixture
async def store(tmp_path):
    s = CardStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


async def _per_card_reference(store: CardStore, projeto_id: str) -> list[dict]:
    """The pre-#213 hydration, rebuilt from the single-card helpers."""
    done_slug = await store.require_done_slug()
    async with store._conn.execute(
        f"SELECT {store._CARD_COLUMNS} FROM cards WHERE projeto_id = ? "
        "AND parent_id IS NULL AND deleted_at IS NULL "
        "ORDER BY board_position ASC, id ASC",
        (projeto_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    result = []
    for row in rows:
        card = store._row_to_card_dict(row)
        card["imagens"] = await store._list_images(card["id"])
        card["attachments"] = await store.list_attachments(card["id"])
        card["questions"] = await store.list_questions(card["id"])
        async with store._conn.execute(
            f"SELECT {store._CARD_COLUMNS} FROM cards WHERE parent_id = ? "
            "AND deleted_at IS NULL ORDER BY id ASC",
            (card["id"],),
        ) as cursor:
            sub_rows = await cursor.fetchall()
        subcards = []
        for sub_row in sub_rows:
            sub = store._row_to_card_dict(sub_row)
            sub["imagens"] = await store._list_images(sub["id"])
            sub["attachments"] = await store.list_attachments(sub["id"])
            sub["questions"] = await store.list_questions(sub["id"])
            sub["subcards"] = []
            sub["subcards_resumo"] = None
            subcards.append(sub)
        card["subcards"] = subcards
        card["subcards_resumo"] = (
            {"total": len(subcards),
             "feitos": sum(1 for s in subcards if s["status"] == done_slug)}
            if subcards else None
        )
        result.append(card)
    return result


@pytest.mark.asyncio
async def test_batched_hydration_matches_per_card_hydration(store):
    done_slug = await store.require_done_slug()
    a = await store.create(titulo="A", projeto_id="p")
    b = await store.create(titulo="B", projeto_id="p")
    await store.create(titulo="vazio", projeto_id="p")
    await store.create(titulo="outro projeto", projeto_id="q")
    sub1 = await store.create(titulo="sub 1", parent_id=a)
    sub2 = await store.create(titulo="sub 2", parent_id=a, status=done_slug)
    removed = await store.create(titulo="sub removido", parent_id=b)
    await store.soft_delete(removed)

    await store.add_image(a, "a1.png", "image/png", 10)
    await store.add_image(a, "a2.png", "image/png", 20)
    await store.add_image(sub1, "s.png", "image/png", 30)
    await store.add_attachment(b, "notes.md", "text/markdown")
    await store.add_attachment(sub2, "log.txt", "text/plain")
    await store.add_questions(a, ["q1", "q2"], "agente:x")
    await store.add_questions(sub2, ["q3"], "agente:x")

    batched = await store.list_top_level(["p"])
    assert batched == await _per_card_reference(store, "p")
    # Sanity: the fixture really exercises every child kind.
    by_title = {c["titulo"]: c for c in batched}
    assert len(by_title["A"]["imagens"]) == 2
    assert [s["titulo"] for s in by_title["A"]["subcards"]] == ["sub 1", "sub 2"]
    assert by_title["A"]["subcards_resumo"] == {"total": 2, "feitos": 1}
    assert by_title["A"]["subcards"][1]["questions"][0]["question"] == "q3"
    assert by_title["B"]["subcards"] == [] and by_title["B"]["subcards_resumo"] is None
    assert by_title["B"]["attachments"][0]["filename"] == "notes.md"


@pytest.mark.asyncio
async def test_batched_hydration_handles_more_cards_than_one_chunk(store, monkeypatch):
    monkeypatch.setattr(CardStore, "_IN_CHUNK_SIZE", 3)
    ids = [await store.create(titulo=f"c{i}", projeto_id="p") for i in range(8)]
    for card_id in ids:
        await store.add_questions(card_id, [f"q{card_id}"], "agente:x")
    cards = await store.list_top_level(["p"])
    assert [c["questions"][0]["question"] for c in cards] == [f"q{i}" for i in ids]


@pytest.mark.asyncio
async def test_empty_listing_runs_no_child_queries(store):
    assert await store.list_top_level(["nada"]) == []


@pytest.mark.asyncio
async def test_create_deduplicated_window(store, monkeypatch):
    kwargs = dict(projeto_id="p", session_key="p::agent", origem="agente:agent")
    first, dup = await store.create_deduplicated("T", **kwargs)
    assert dup is False
    assert await store.create_deduplicated("T", **kwargs) == (first, True)

    # A different session, project or parent is a different card.
    other, dup = await store.create_deduplicated("T", **{**kwargs, "session_key": "p::other"})
    assert dup is False and other != first
    sub, dup = await store.create_deduplicated("T", session_key="p::agent", parent_id=first)
    assert dup is False

    # Outside the window it creates again.
    real_time = time.time
    monkeypatch.setattr(
        "app.card_store.time.time",
        lambda: real_time() + CardStore.AGENT_CREATE_DEDUP_WINDOW_SECONDS + 1,
    )
    later, dup = await store.create_deduplicated("T", **kwargs)
    assert dup is False and later != first


@pytest.mark.asyncio
async def test_plain_create_never_deduplicates(store):
    first = await store.create(titulo="T", projeto_id="p", session_key="p::agent")
    second = await store.create(titulo="T", projeto_id="p", session_key="p::agent")
    assert first != second
