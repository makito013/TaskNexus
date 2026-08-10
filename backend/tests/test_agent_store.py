import pytest
import pytest_asyncio
from app.agent_store import GlobalAgentStore
from app.models import Agent


@pytest_asyncio.fixture
async def store(tmp_path):
    s = GlobalAgentStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_list_all_empty_returns_empty_list(store):
    assert await store.list_all() == []


@pytest.mark.asyncio
async def test_create_and_list_all(store):
    agent = Agent(id="claude-work", nome="Claude (Work)", papel="Assistente", ia="claude", cmd=["claude", "--settings", "~/.claude-work"])
    created = await store.create(agent)
    assert created.id == "claude-work"
    assert created.cmd == ["claude", "--settings", "~/.claude-work"]
    assert created.default is False
    assert created.system_prompt is None

    all_agents = await store.list_all()
    assert len(all_agents) == 1
    assert all_agents[0].id == "claude-work"
    assert all_agents[0].nome == "Claude (Work)"
    assert all_agents[0].cmd == ["claude", "--settings", "~/.claude-work"]


@pytest.mark.asyncio
async def test_create_duplicate_id_raises_value_error(store):
    agent = Agent(id="dup", nome="A", papel="p", ia="claude", cmd=["claude"])
    await store.create(agent)
    with pytest.raises(ValueError):
        await store.create(agent)


@pytest.mark.asyncio
async def test_update_existing_agent(store):
    agent = Agent(id="dup", nome="A", papel="p", ia="claude", cmd=["claude"])
    await store.create(agent)

    updated = await store.update("dup", Agent(id="dup", nome="B", papel="p2", ia="gemini", cmd=["agy", "--flag"]))
    assert updated is not None
    assert updated.id == "dup"
    assert updated.nome == "B"
    assert updated.papel == "p2"
    assert updated.ia == "gemini"
    assert updated.cmd == ["agy", "--flag"]

    all_agents = await store.list_all()
    assert len(all_agents) == 1
    assert all_agents[0].nome == "B"


@pytest.mark.asyncio
async def test_update_ignores_id_in_body_uses_path_id(store):
    """The URL-path id always wins, even if the body carries a different id."""
    agent = Agent(id="dup", nome="A", papel="p", ia="claude", cmd=["claude"])
    await store.create(agent)

    updated = await store.update("dup", Agent(id="different-id", nome="B", papel="p2", ia="claude", cmd=["claude"]))
    assert updated.id == "dup"


@pytest.mark.asyncio
async def test_update_nonexistent_id_returns_none(store):
    result = await store.update("ghost", Agent(id="ghost", nome="B", papel="p", ia="claude", cmd=["claude"]))
    assert result is None


@pytest.mark.asyncio
async def test_delete_existing_agent(store):
    agent = Agent(id="dup", nome="A", papel="p", ia="claude", cmd=["claude"])
    await store.create(agent)

    ok = await store.delete("dup")
    assert ok is True
    assert await store.list_all() == []


@pytest.mark.asyncio
async def test_delete_nonexistent_id_returns_false(store):
    ok = await store.delete("ghost")
    assert ok is False


@pytest.mark.asyncio
async def test_persists_across_instances(tmp_path):
    db = str(tmp_path / "persist.db")
    s1 = GlobalAgentStore(db_path=db)
    await s1.initialize()
    await s1.create(Agent(id="claude-work", nome="A", papel="p", ia="claude", cmd=["claude"]))
    await s1.close()

    s2 = GlobalAgentStore(db_path=db)
    await s2.initialize()
    all_agents = await s2.list_all()
    await s2.close()
    assert len(all_agents) == 1
    assert all_agents[0].id == "claude-work"


@pytest.mark.asyncio
async def test_list_all_ordered_by_id(store):
    await store.create(Agent(id="z-agent", nome="Z", papel="p", ia="claude", cmd=["claude"]))
    await store.create(Agent(id="a-agent", nome="A", papel="p", ia="claude", cmd=["claude"]))
    all_agents = await store.list_all()
    assert [a.id for a in all_agents] == ["a-agent", "z-agent"]
