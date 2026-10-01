"""Testes do ArtifactStore (Fase A, Parte 7 seção 7.4.2): upsert por
(projeto, caminho) mantendo o id, regras de título/descrição, filtros por
cliente, subárvore de projeto e tipo, edição e remoção."""
from __future__ import annotations

import asyncio
import re

import pytest
import pytest_asyncio

from app.artifact_store import ArtifactStore, new_artifact_id

ARTIFACT_KEYS = {
    "artifact_id", "project_id", "cliente_id", "path", "kind", "title",
    "description", "excerpt", "size", "mtime", "created_by", "agent_label",
    "created_at", "updated_at",
}


@pytest_asyncio.fixture
async def store(tmp_path):
    s = ArtifactStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


async def _upsert(store, path, project_id="podesubir/site", **overrides):
    kwargs = dict(
        project_id=project_id,
        cliente_id=project_id.split("/")[0],
        path=path,
        kind="markdown",
        auto_title="Título do documento",
        title=None,
        description=None,
        excerpt="trecho",
        size=10,
        mtime=1000.0,
        created_by="agent",
        agent_label="claude",
        session_key=project_id + "::claude",
    )
    kwargs.update(overrides)
    return await store.upsert(**kwargs)


def test_artifact_id_format():
    artifact_id = new_artifact_id()
    assert re.fullmatch(r"af_[A-Za-z0-9_-]{22}", artifact_id)
    assert new_artifact_id() != artifact_id


@pytest.mark.asyncio
async def test_upsert_creates_with_the_documented_shape(store):
    artifact, created = await _upsert(store, "docs/relatorio.md")
    assert created is True
    assert set(artifact) == ARTIFACT_KEYS
    assert artifact["artifact_id"].startswith("af_")
    assert artifact["project_id"] == "podesubir/site"
    assert artifact["cliente_id"] == "podesubir"
    assert artifact["title"] == "Título do documento"
    assert artifact["created_by"] == "agent"
    assert artifact["agent_label"] == "claude"
    assert artifact["created_at"] == artifact["updated_at"]


@pytest.mark.asyncio
async def test_upsert_same_project_and_path_keeps_id_and_updates_fields(store):
    first, _ = await _upsert(store, "docs/r.md", description="v1")
    await asyncio.sleep(0.01)
    second, created = await _upsert(
        store, "docs/r.md", excerpt="novo trecho", size=99, mtime=2000.0,
        auto_title="Título novo", created_by="user", agent_label=None,
    )
    assert created is False
    assert second["artifact_id"] == first["artifact_id"]
    assert second["excerpt"] == "novo trecho"
    assert second["size"] == 99
    assert second["mtime"] == 2000.0
    assert second["updated_at"] > first["updated_at"]
    assert second["created_at"] == first["created_at"]
    # Título automático acompanha o documento enquanto ninguém deu um nome.
    assert second["title"] == "Título novo"
    # Descrição só muda quando vem; quem criou continua o mesmo.
    assert second["description"] == "v1"
    assert second["created_by"] == "agent"
    assert second["agent_label"] == "claude"


@pytest.mark.asyncio
async def test_explicit_title_is_not_overwritten_by_automatic_title(store):
    await _upsert(store, "r.md", title="Nome dado pelo agente")
    again, _ = await _upsert(store, "r.md", auto_title="Outro título do arquivo")
    assert again["title"] == "Nome dado pelo agente"
    renamed, _ = await _upsert(store, "r.md", title="Nome novo")
    assert renamed["title"] == "Nome novo"


@pytest.mark.asyncio
async def test_same_path_in_another_project_is_another_artifact(store):
    a, _ = await _upsert(store, "README.md", project_id="podesubir/site")
    b, created = await _upsert(store, "README.md", project_id="podesubir/app")
    assert created is True
    assert a["artifact_id"] != b["artifact_id"]


@pytest.mark.asyncio
async def test_concurrent_upserts_of_the_same_file_do_not_duplicate(store):
    results = await asyncio.gather(*[_upsert(store, "x.md") for _ in range(5)])
    assert len({artifact["artifact_id"] for artifact, _ in results}) == 1
    assert sum(1 for _, created in results if created) == 1


@pytest.mark.asyncio
async def test_filters_by_cliente_projeto_subtree_and_kind(store):
    await _upsert(store, "a.md", project_id="cli/proj")
    await _upsert(store, "b.md", project_id="cli/proj/sub")
    await _upsert(store, "c.md", project_id="cli/proj/sub/fundo")
    await _upsert(store, "d.html", project_id="cli/proj-novo", kind="html")
    await _upsert(store, "e.pdf", project_id="outro", kind="pdf")
    # `_` no id não pode virar curinga do LIKE.
    await _upsert(store, "f.md", project_id="cli/projXsub")

    def paths(items):
        return sorted(a["path"] for a in items)

    assert paths(await store.list_artifacts(cliente_id="cli")) == ["a.md", "b.md", "c.md", "d.html", "f.md"]
    assert paths(await store.list_artifacts(projeto_id="cli/proj")) == ["a.md", "b.md", "c.md"]
    assert paths(await store.list_artifacts(projeto_id="cli/proj/sub")) == ["b.md", "c.md"]
    assert paths(await store.list_artifacts(projeto_id="cli/proj/sub/fundo")) == ["c.md"]
    assert paths(await store.list_artifacts(kind="html")) == ["d.html"]
    assert paths(await store.list_artifacts(cliente_id="outro", kind="pdf")) == ["e.pdf"]
    assert paths(await store.list_artifacts(projeto_id="cli/proj_sub")) == []


@pytest.mark.asyncio
async def test_list_orders_by_most_recent_update(store):
    await _upsert(store, "velho.md")
    await asyncio.sleep(0.01)
    await _upsert(store, "novo.md")
    await asyncio.sleep(0.01)
    await _upsert(store, "velho.md")
    assert [a["path"] for a in await store.list_artifacts()] == ["velho.md", "novo.md"]


@pytest.mark.asyncio
async def test_update_title_marks_it_custom_and_description_can_be_cleared(store):
    artifact, _ = await _upsert(store, "r.md", description="desc")
    updated = await store.update(artifact["artifact_id"], title="Renomeado")
    assert updated["title"] == "Renomeado"
    assert updated["description"] == "desc"
    again, _ = await _upsert(store, "r.md", auto_title="Automático")
    assert again["title"] == "Renomeado"
    cleared = await store.update(artifact["artifact_id"], clear_description=True)
    assert cleared["description"] is None
    assert await store.update("af_nao_existe", title="x") is None


@pytest.mark.asyncio
async def test_delete_and_paths_for_project(store):
    a, _ = await _upsert(store, "a.md")
    await _upsert(store, "b.md")
    await _upsert(store, "c.md", project_id="podesubir/outro")
    assert await store.paths_for_project("podesubir/site") == {"a.md", "b.md"}
    assert await store.delete(a["artifact_id"]) is True
    assert await store.delete(a["artifact_id"]) is False
    assert await store.get(a["artifact_id"]) is None
    assert await store.paths_for_project("podesubir/site") == {"b.md"}
