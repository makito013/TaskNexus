import sqlite3

import pytest
import pytest_asyncio
from app.task_store import TaskStore


@pytest_asyncio.fixture
async def store(tmp_path):
    s = TaskStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_create_returns_id(store):
    task_id = await store.create("proj::claude", "Título", "conteúdo")
    assert isinstance(task_id, int)
    assert task_id > 0


@pytest.mark.asyncio
async def test_create_and_list_for_session(store):
    task_id = await store.create("proj::claude", "Título", "conteúdo", "<p>conteúdo</p>")
    tasks = await store.list_for_session("proj::claude")
    assert len(tasks) == 1
    task = tasks[0]
    assert task["id"] == task_id
    assert task["session_key"] == "proj::claude"
    assert task["titulo"] == "Título"
    assert task["descricao_markdown"] == "conteúdo"
    assert task["descricao_html"] == "<p>conteúdo</p>"
    assert task["status"] == "pending"
    assert isinstance(task["created_at"], float)
    assert task["completed_at"] is None


@pytest.mark.asyncio
async def test_create_descricao_html_optional(store):
    await store.create("proj::claude", "Título", "conteúdo")
    tasks = await store.list_for_session("proj::claude")
    assert tasks[0]["descricao_html"] is None


@pytest.mark.asyncio
async def test_list_for_session_only_returns_matching_session(store):
    await store.create("proj-a::claude", "A", "descr A")
    await store.create("proj-b::claude", "B", "descr B")

    tasks_a = await store.list_for_session("proj-a::claude")
    assert len(tasks_a) == 1
    assert tasks_a[0]["titulo"] == "A"

    tasks_b = await store.list_for_session("proj-b::claude")
    assert len(tasks_b) == 1
    assert tasks_b[0]["titulo"] == "B"


@pytest.mark.asyncio
async def test_list_for_session_empty_returns_empty_list(store):
    tasks = await store.list_for_session("ghost::claude")
    assert tasks == []


@pytest.mark.asyncio
async def test_mark_done_success(store):
    task_id = await store.create("proj::claude", "Título", "conteúdo")
    ok = await store.mark_done("proj::claude", task_id)
    assert ok is True

    tasks = await store.list_for_session("proj::claude")
    assert tasks[0]["status"] == "done"
    assert tasks[0]["completed_at"] is not None


@pytest.mark.asyncio
async def test_mark_done_idempotent_on_already_done(store):
    task_id = await store.create("proj::claude", "Título", "conteúdo")
    ok1 = await store.mark_done("proj::claude", task_id)
    tasks_after_first = await store.list_for_session("proj::claude")
    completed_at_1 = tasks_after_first[0]["completed_at"]

    ok2 = await store.mark_done("proj::claude", task_id)
    tasks_after_second = await store.list_for_session("proj::claude")

    assert ok1 is True
    assert ok2 is True
    # completed_at does not get rewritten on the second (already-done) call.
    assert tasks_after_second[0]["completed_at"] == completed_at_1


@pytest.mark.asyncio
async def test_mark_done_nonexistent_id_returns_false(store):
    ok = await store.mark_done("proj::claude", 9999)
    assert ok is False


@pytest.mark.asyncio
async def test_mark_done_wrong_session_key_returns_false(store):
    """Security-relevant: a session cannot mark another session's task done."""
    task_id = await store.create("proj-a::claude", "Título", "conteúdo")
    ok = await store.mark_done("proj-b::claude", task_id)
    assert ok is False

    tasks = await store.list_for_session("proj-a::claude")
    assert tasks[0]["status"] == "pending"


@pytest.mark.asyncio
async def test_mark_pending_reopens_done_task(store):
    task_id = await store.create("proj::claude", "Título", "conteúdo")
    await store.mark_done("proj::claude", task_id)

    ok = await store.mark_pending("proj::claude", task_id)
    assert ok is True

    tasks = await store.list_for_session("proj::claude")
    assert tasks[0]["status"] == "pending"
    assert tasks[0]["completed_at"] is None


@pytest.mark.asyncio
async def test_mark_pending_idempotent_on_already_pending(store):
    task_id = await store.create("proj::claude", "Título", "conteúdo")
    ok = await store.mark_pending("proj::claude", task_id)
    assert ok is True

    tasks = await store.list_for_session("proj::claude")
    assert tasks[0]["status"] == "pending"
    assert tasks[0]["completed_at"] is None


@pytest.mark.asyncio
async def test_mark_pending_nonexistent_id_returns_false(store):
    ok = await store.mark_pending("proj::claude", 9999)
    assert ok is False


@pytest.mark.asyncio
async def test_mark_pending_wrong_session_key_returns_false(store):
    """Security-relevant: a session cannot reopen another session's task."""
    task_id = await store.create("proj-a::claude", "Título", "conteúdo")
    await store.mark_done("proj-a::claude", task_id)

    ok = await store.mark_pending("proj-b::claude", task_id)
    assert ok is False

    tasks = await store.list_for_session("proj-a::claude")
    assert tasks[0]["status"] == "done"


@pytest.mark.asyncio
async def test_clear_for_session_removes_only_matching_tasks(store):
    await store.create("proj-a::claude", "A", "descr A")
    await store.create("proj-b::claude", "B", "descr B")

    await store.clear_for_session("proj-a::claude")

    assert await store.list_for_session("proj-a::claude") == []
    assert len(await store.list_for_session("proj-b::claude")) == 1


@pytest.mark.asyncio
async def test_clear_for_session_nonexistent_is_noop(store):
    await store.clear_for_session("ghost::claude")  # must not raise


@pytest.mark.asyncio
async def test_list_all_returns_tasks_from_multiple_sessions(store):
    await store.create("proj-a::claude", "A1", "descr A1")
    await store.create("proj-b::claude", "B1", "descr B1")
    await store.create("proj-a::claude", "A2", "descr A2")

    tasks = await store.list_all()

    session_keys = {task["session_key"] for task in tasks}
    assert session_keys == {"proj-a::claude", "proj-b::claude"}
    assert len(tasks) == 3


@pytest.mark.asyncio
async def test_list_all_orders_by_session_key_then_id(store):
    # Created out of session_key order on purpose to make sure sorting is
    # done by the query, not by insertion order.
    id_b1 = await store.create("proj-b::claude", "B1", "descr B1")
    id_a1 = await store.create("proj-a::claude", "A1", "descr A1")
    id_a2 = await store.create("proj-a::claude", "A2", "descr A2")

    tasks = await store.list_all()

    assert [(task["session_key"], task["id"]) for task in tasks] == [
        ("proj-a::claude", id_a1),
        ("proj-a::claude", id_a2),
        ("proj-b::claude", id_b1),
    ]


@pytest.mark.asyncio
async def test_list_all_empty_returns_empty_list(store):
    assert await store.list_all() == []


# -- projeto_id (Tarefa 2) ---------------------------------------------------


@pytest.mark.asyncio
async def test_create_defaults_projeto_id_to_none(store):
    """Chamada posicional legada (sem projeto_id) continua funcionando —
    projeto_id fica NULL."""
    await store.create("proj::claude", "Título", "conteúdo", "<p>c</p>")
    tasks = await store.list_for_session("proj::claude")
    assert tasks[0]["projeto_id"] is None


@pytest.mark.asyncio
async def test_create_with_projeto_id_is_persisted(store):
    await store.create("proj::claude", "Título", "conteúdo", projeto_id="cliente/sub")
    tasks = await store.list_for_session("proj::claude")
    assert tasks[0]["projeto_id"] == "cliente/sub"


@pytest.mark.asyncio
async def test_list_all_includes_projeto_id(store):
    await store.create("proj-a::claude", "A", "descr", projeto_id="cliente/x")
    await store.create("proj-b::claude", "B", "descr")  # NULL
    tasks = await store.list_all()
    by_titulo = {t["titulo"]: t for t in tasks}
    assert by_titulo["A"]["projeto_id"] == "cliente/x"
    assert by_titulo["B"]["projeto_id"] is None


@pytest.mark.asyncio
async def test_initialize_adds_projeto_id_to_preexisting_table(tmp_path):
    """Risco crítico (TL): CREATE TABLE IF NOT EXISTS não adiciona coluna a um
    banco já populado. Este teste cria a tabela `tasks` SEM projeto_id (schema
    antigo, via sqlite3 stdlib), com uma linha dentro, e verifica que
    TaskStore.initialize() adiciona a coluna via ALTER TABLE best-effort sem
    perder a linha existente — e que rodar de novo (coluna já presente) não
    quebra."""
    db = str(tmp_path / "legacy.db")
    conn = sqlite3.connect(db)
    conn.execute(
        """
        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_key TEXT NOT NULL,
            titulo TEXT NOT NULL,
            descricao_markdown TEXT NOT NULL,
            descricao_html TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at REAL NOT NULL,
            completed_at REAL
        )
        """
    )
    conn.execute(
        "INSERT INTO tasks (session_key, titulo, descricao_markdown, created_at) "
        "VALUES ('legacy::claude', 'Antiga', 'md', 1.0)"
    )
    conn.commit()
    conn.close()

    s = TaskStore(db_path=db)
    await s.initialize()
    try:
        tasks = await s.list_for_session("legacy::claude")
        assert len(tasks) == 1
        assert tasks[0]["titulo"] == "Antiga"
        assert tasks[0]["projeto_id"] is None  # coluna nova, linha antiga -> NULL
        # nova criação com projeto_id funciona no banco migrado
        await s.create("legacy::claude", "Nova", "md", projeto_id="cliente/y")
        tasks2 = await s.list_for_session("legacy::claude")
        assert {t["titulo"]: t["projeto_id"] for t in tasks2} == {
            "Antiga": None, "Nova": "cliente/y",
        }
    finally:
        await s.close()

    # Reabrir (initialize de novo, coluna já existe) não pode quebrar.
    s2 = TaskStore(db_path=db)
    await s2.initialize()
    try:
        assert len(await s2.list_for_session("legacy::claude")) == 2
    finally:
        await s2.close()


@pytest.mark.asyncio
async def test_persists_across_instances(tmp_path):
    db = str(tmp_path / "persist.db")
    s1 = TaskStore(db_path=db)
    await s1.initialize()
    task_id = await s1.create("proj::claude", "Título", "conteúdo")
    await s1.close()

    s2 = TaskStore(db_path=db)
    await s2.initialize()
    tasks = await s2.list_for_session("proj::claude")
    await s2.close()
    assert len(tasks) == 1
    assert tasks[0]["id"] == task_id
