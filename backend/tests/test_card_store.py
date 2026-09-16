import asyncio

import pytest
import pytest_asyncio
from app.card_store import CardStore, ColumnDeleteError


@pytest_asyncio.fixture
async def store(tmp_path):
    s = CardStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


# -- criação de card de topo -----------------------------------------------


@pytest.mark.asyncio
async def test_create_top_level_card_returns_id(store):
    card_id = await store.create(
        titulo="Título",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    assert isinstance(card_id, int)
    assert card_id > 0

    card = await store.get(card_id)
    assert card["titulo"] == "Título"
    assert card["projeto_id"] == "proj-a"
    assert card["parent_id"] is None
    assert card["status"] == "a_fazer"
    assert card["origem"] == "bruno"
    assert card["ultima_atualizacao_por"] == "bruno"
    assert card["descricao"] is None
    assert card["session_key"] is None
    assert card["deleted_at"] is None
    assert isinstance(card["criado_em"], float)
    assert isinstance(card["atualizado_em"], float)


# -- criação de subcard -----------------------------------------------------


@pytest.mark.asyncio
async def test_create_subcard_inherits_projeto_id_from_parent(store):
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )

    # Mesmo passando um projeto_id diferente, deve ser ignorado — subcard
    # sempre herda do pai.
    sub_id = await store.create(
        titulo="Subtarefa",
        projeto_id="proj-DIFERENTE",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )

    sub = await store.get(sub_id)
    assert sub["parent_id"] == parent_id
    assert sub["projeto_id"] == "proj-a"


@pytest.mark.asyncio
async def test_create_subcard_under_subcard_raises_value_error(store):
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub_id = await store.create(
        titulo="Subtarefa",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )

    with pytest.raises(ValueError):
        await store.create(
            titulo="Neto",
            projeto_id="proj-a",
            status="a_fazer",
            origem="bruno",
            ultima_atualizacao_por="bruno",
            parent_id=sub_id,
        )


@pytest.mark.asyncio
async def test_create_subcard_under_nonexistent_parent_raises_value_error(store):
    with pytest.raises(ValueError):
        await store.create(
            titulo="Órfão",
            projeto_id="proj-a",
            status="a_fazer",
            origem="bruno",
            ultima_atualizacao_por="bruno",
            parent_id=9999,
        )


@pytest.mark.asyncio
async def test_create_subcard_under_soft_deleted_parent_raises_value_error(store):
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    await store.soft_delete(parent_id)

    with pytest.raises(ValueError):
        await store.create(
            titulo="Subtarefa tardia",
            projeto_id="proj-a",
            status="a_fazer",
            origem="bruno",
            ultima_atualizacao_por="bruno",
            parent_id=parent_id,
        )


# -- cliente_id (Grupo B da feature Cliente/Projeto, ramo 3) -----------------


@pytest.mark.asyncio
async def test_create_with_only_cliente_id_grava_projeto_id_igual_ao_cliente(store):
    """Card "cliente-only": nenhum projeto_id foi enviado, só cliente_id —
    a linha grava projeto_id == cliente_id direto, sem coluna nova."""
    card_id = await store.create(
        titulo="Card do cliente",
        cliente_id="cliente_projeto_1",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    card = await store.get(card_id)
    assert card["projeto_id"] == "cliente_projeto_1"


@pytest.mark.asyncio
async def test_create_without_projeto_id_nem_cliente_id_raises_value_error(store):
    """Nem um nem outro foi informado — ValueError, card nunca sem
    projeto_id de fato gravado (schema continua com a coluna NOT NULL)."""
    with pytest.raises(ValueError):
        await store.create(
            titulo="Card órfão de vínculo",
            status="a_fazer",
            origem="bruno",
            ultima_atualizacao_por="bruno",
        )


@pytest.mark.asyncio
async def test_create_subcard_with_parent_id_ignores_cliente_id_do_chamador(store):
    """parent_id presente sempre vence — mesma regra que já vale para
    projeto_id ignorado do chamador, agora também vale para cliente_id."""
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub_id = await store.create(
        titulo="Subtarefa",
        cliente_id="cliente-DIFERENTE",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    sub = await store.get(sub_id)
    assert sub["projeto_id"] == "proj-a"


@pytest.mark.asyncio
async def test_create_with_projeto_id_and_cliente_id_projeto_id_vence(store):
    """Quando projeto_id E cliente_id são passados (sem parent_id), a regra
    2 (projeto_id presente) vence sobre a 3 — cliente_id é ignorado."""
    card_id = await store.create(
        titulo="Card com projeto específico",
        projeto_id="cliente_projeto_1/subprojeto_1",
        cliente_id="cliente_projeto_1",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    card = await store.get(card_id)
    assert card["projeto_id"] == "cliente_projeto_1/subprojeto_1"


# -- list_top_level ----------------------------------------------------------


@pytest.mark.asyncio
async def test_list_top_level_embeds_subcards_resumo_and_imagens(store):
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub1_id = await store.create(
        titulo="Sub 1",
        projeto_id="proj-a",
        status="feito",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.create(
        titulo="Sub 2",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.add_image(parent_id, "capa.png", "image/png", 1234)
    await store.add_image(sub1_id, "sub.png", "image/png", 1234)

    cards = await store.list_top_level()
    assert len(cards) == 1
    card = cards[0]
    assert card["id"] == parent_id
    assert len(card["subcards"]) == 2
    assert card["subcards_resumo"] == {"total": 2, "feitos": 1}
    assert len(card["imagens"]) == 1
    assert card["imagens"][0]["filename"] == "capa.png"

    sub1 = next(s for s in card["subcards"] if s["id"] == sub1_id)
    assert len(sub1["imagens"]) == 1
    assert sub1["imagens"][0]["filename"] == "sub.png"
    assert sub1["subcards"] == []
    assert sub1["subcards_resumo"] is None


@pytest.mark.asyncio
async def test_list_top_level_card_without_subcards_has_none_resumo(store):
    await store.create(
        titulo="Solo",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    cards = await store.list_top_level()
    assert cards[0]["subcards"] == []
    assert cards[0]["subcards_resumo"] is None


@pytest.mark.asyncio
async def test_list_top_level_filters_by_projeto_ids(store):
    await store.create(
        titulo="A",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    await store.create(
        titulo="B",
        projeto_id="proj-b",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )

    cards = await store.list_top_level(projeto_ids=["proj-a"])
    assert len(cards) == 1
    assert cards[0]["titulo"] == "A"

    cards_all = await store.list_top_level(projeto_ids=None)
    assert len(cards_all) == 2

    cards_empty_filter = await store.list_top_level(projeto_ids=[])
    assert len(cards_empty_filter) == 2


@pytest.mark.asyncio
async def test_list_top_level_filtra_card_cliente_only_e_card_de_projeto_especifico_do_mesmo_cliente(
    store,
):
    """Cenário BDD P0 (Cliente/Projeto): um card cliente-only
    (cliente_id="acme" -> projeto_id="acme") e um card vinculado a um
    projeto específico daquele cliente (projeto_id="acme/site") devem
    aparecer JUNTOS quando o filtro passa a lista agregada
    [clienteId, projetoId] — mesma fórmula que o frontend monta em
    BoardView.jsx (selectedProjectIds) quando Cliente+Projeto estão
    selecionados. Nunca tinha sido provado com dados reais (só com
    useCards mockado no frontend e com um único projeto_id por vez no
    backend)."""
    cliente_only_id = await store.create(
        titulo="Card cliente-only",
        cliente_id="acme",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    projeto_especifico_id = await store.create(
        titulo="Card do projeto específico",
        projeto_id="acme/site",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    # Card de um cliente diferente — não deve aparecer no filtro abaixo.
    await store.create(
        titulo="Card de outro cliente",
        projeto_id="outro-cliente",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )

    cards = await store.list_top_level(projeto_ids=["acme", "acme/site"])

    ids = {card["id"] for card in cards}
    assert ids == {cliente_only_id, projeto_especifico_id}


@pytest.mark.asyncio
async def test_list_top_level_excludes_deleted_and_subcards(store):
    top_id = await store.create(
        titulo="Topo",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    await store.create(
        titulo="Sub",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=top_id,
    )
    deleted_id = await store.create(
        titulo="Deletado",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    await store.soft_delete(deleted_id)

    cards = await store.list_top_level()
    ids = [c["id"] for c in cards]
    assert ids == [top_id]


# -- update -------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_applies_only_provided_fields(store):
    card_id = await store.create(
        titulo="Original",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        descricao="descrição original",
    )

    updated = await store.update(
        card_id, ultima_atualizacao_por="agente:claude", status="feito"
    )

    assert updated["status"] == "feito"
    assert updated["titulo"] == "Original"
    assert updated["descricao"] == "descrição original"
    assert updated["ultima_atualizacao_por"] == "agente:claude"


@pytest.mark.asyncio
async def test_update_returns_none_for_missing_or_deleted_card(store):
    assert await store.update(9999, ultima_atualizacao_por="bruno", status="feito") is None

    card_id = await store.create(
        titulo="X",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    await store.soft_delete(card_id)
    assert await store.update(card_id, ultima_atualizacao_por="bruno", status="feito") is None


# -- tipo / prazo (Cards Board v2, Phase 1) ---------------------------------


@pytest.mark.asyncio
async def test_create_persists_tipo_and_prazo(store):
    card_id = await store.create(
        titulo="Com tipo e prazo",
        projeto_id="proj-a",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        tipo="bug",
        prazo="2026-09-15",
    )
    card = await store.get(card_id)
    assert card["tipo"] == "bug"
    assert card["prazo"] == "2026-09-15"


@pytest.mark.asyncio
async def test_create_without_tipo_and_prazo_leaves_them_null(store):
    card_id = await store.create(
        titulo="Sem tipo",
        projeto_id="proj-a",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    card = await store.get(card_id)
    assert card["tipo"] is None
    assert card["prazo"] is None


@pytest.mark.asyncio
async def test_create_with_empty_string_tipo_stores_null_not_blank(store):
    """An empty string on create writes NULL, never "" — otherwise the
    database ends up with two representations of "no tipo" (D-4.2)."""
    card_id = await store.create(
        titulo="Tipo vazio",
        projeto_id="proj-a",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        tipo="",
        prazo="",
    )
    card = await store.get(card_id)
    assert card["tipo"] is None
    assert card["prazo"] is None


@pytest.mark.asyncio
async def test_update_sets_tipo_and_prazo(store):
    card_id = await store.create(
        titulo="X", projeto_id="proj-a", origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    updated = await store.update(
        card_id, ultima_atualizacao_por="bruno", tipo="hotfix"
    )
    assert updated["tipo"] == "hotfix"
    updated = await store.update(
        card_id, ultima_atualizacao_por="bruno", prazo="2026-01-02"
    )
    assert updated["prazo"] == "2026-01-02"


@pytest.mark.asyncio
async def test_update_empty_string_clears_tipo_from_a_card_that_had_one(store):
    """Sentinel "" -> NULL. The initial state WITH a tipo is essential:
    starting from a card with no tipo lets the buggy version of the
    normalization (guard before normalization) pass just the same."""
    card_id = await store.create(
        titulo="X", projeto_id="proj-a", origem="bruno",
        ultima_atualizacao_por="bruno", tipo="bug", prazo="2026-09-15",
    )
    updated = await store.update(card_id, ultima_atualizacao_por="bruno", tipo="")
    assert updated["tipo"] is None
    updated = await store.update(card_id, ultima_atualizacao_por="bruno", prazo="")
    assert updated["prazo"] is None


@pytest.mark.asyncio
async def test_update_tipo_none_does_not_clear_existing_tipo(store):
    """Absent != clear: proves the "" sentinel did not leak into the
    omission semantics."""
    card_id = await store.create(
        titulo="X", projeto_id="proj-a", origem="bruno",
        ultima_atualizacao_por="bruno", tipo="bug",
    )
    updated = await store.update(
        card_id, ultima_atualizacao_por="bruno", tipo=None, titulo="Y"
    )
    assert updated["tipo"] == "bug"
    assert updated["titulo"] == "Y"


@pytest.mark.asyncio
async def test_update_other_fields_leave_tipo_intact(store):
    card_id = await store.create(
        titulo="X", projeto_id="proj-a", origem="bruno",
        ultima_atualizacao_por="bruno", tipo="bug",
    )
    updated = await store.update(
        card_id, ultima_atualizacao_por="bruno", status="feito"
    )
    assert updated["status"] == "feito"
    assert updated["tipo"] == "bug"


# -- soft_delete / cascade -------------------------------------------------


@pytest.mark.asyncio
async def test_soft_delete_top_level_cascades_active_subcards(store):
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub1_id = await store.create(
        titulo="Sub 1",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    sub2_id = await store.create(
        titulo="Sub 2",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )

    result = await store.soft_delete(parent_id)
    assert result == {"card_id": parent_id, "subcards_afetados": 2}

    parent = await store.get(parent_id)
    sub1 = await store.get(sub1_id)
    sub2 = await store.get(sub2_id)
    assert parent["deleted_at"] is not None
    assert sub1["deleted_at"] is not None
    assert sub2["deleted_at"] is not None


@pytest.mark.asyncio
async def test_soft_delete_subcard_does_not_affect_parent_or_siblings(store):
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub1_id = await store.create(
        titulo="Sub 1",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    sub2_id = await store.create(
        titulo="Sub 2",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )

    result = await store.soft_delete(sub1_id)
    assert result == {"card_id": sub1_id, "subcards_afetados": 0}

    parent = await store.get(parent_id)
    sub1 = await store.get(sub1_id)
    sub2 = await store.get(sub2_id)
    assert parent["deleted_at"] is None
    assert sub1["deleted_at"] is not None
    assert sub2["deleted_at"] is None


@pytest.mark.asyncio
async def test_soft_delete_top_level_without_subcards_returns_zero(store):
    card_id = await store.create(
        titulo="Solo",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    result = await store.soft_delete(card_id)
    assert result == {"card_id": card_id, "subcards_afetados": 0}


# -- imagens ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_image_rejects_sixth_image(store):
    card_id = await store.create(
        titulo="Card",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    for i in range(5):
        await store.add_image(card_id, f"img{i}.png", "image/png", 100)

    with pytest.raises(ValueError):
        await store.add_image(card_id, "img5.png", "image/png", 100)


@pytest.mark.asyncio
async def test_delete_image_returns_filename_and_scopes_by_card(store):
    card_a = await store.create(
        titulo="A",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    card_b = await store.create(
        titulo="B",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    image_id = await store.add_image(card_a, "foto.png", "image/png", 100)

    # Não pode apagar a imagem de A usando o id de B.
    assert await store.delete_image(card_b, image_id) is None

    filename = await store.delete_image(card_a, image_id)
    assert filename == "foto.png"

    # Já apagada — segunda tentativa retorna None.
    assert await store.delete_image(card_a, image_id) is None


@pytest.mark.asyncio
async def test_count_active_subcards(store):
    parent_id = await store.create(
        titulo="Pai",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub_id = await store.create(
        titulo="Sub",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    assert await store.count_active_subcards(parent_id) == 1

    await store.soft_delete(sub_id)
    assert await store.count_active_subcards(parent_id) == 0


# -- limpar concluídos -------------------------------------------------------


@pytest.mark.asyncio
async def test_selecionar_alvo_limpar_includes_soft_deleted_subcards(store):
    parent_id = await store.create(
        titulo="Pai feito",
        projeto_id="proj-a",
        status="feito",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub_deleted_id = await store.create(
        titulo="Sub já deletado",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.soft_delete(sub_deleted_id)
    sub_active_id = await store.create(
        titulo="Sub ativo em outro status",
        projeto_id="proj-a",
        status="em_andamento",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )

    pais_ids, subcards_ids = await store._selecionar_alvo_limpar(
        "proj-a", await store.require_done_slug()
    )

    assert pais_ids == [parent_id]
    assert set(subcards_ids) == {sub_deleted_id, sub_active_id}


@pytest.mark.asyncio
async def test_preview_limpar_concluidos_does_not_mutate_state(store):
    parent_id = await store.create(
        titulo="Pai feito",
        projeto_id="proj-a",
        status="feito",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub_deleted_id = await store.create(
        titulo="Sub já deletado",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.soft_delete(sub_deleted_id)
    await store.create(
        titulo="Sub ativo em outro status",
        projeto_id="proj-a",
        status="em_andamento",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.add_image(parent_id, "capa.png", "image/png", 100)

    before = await store.list_top_level()
    result = await store.preview_limpar_concluidos("proj-a")
    after = await store.list_top_level()

    assert result == {"cards": 3, "imagens": 1}
    assert before == after


@pytest.mark.asyncio
async def test_executar_limpar_concluidos_removes_rows_and_returns_filenames(store):
    parent_id = await store.create(
        titulo="Pai feito",
        projeto_id="proj-a",
        status="feito",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    sub_deleted_id = await store.create(
        titulo="Sub já deletado",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.soft_delete(sub_deleted_id)
    sub_active_id = await store.create(
        titulo="Sub ativo em outro status",
        projeto_id="proj-a",
        status="em_andamento",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.add_image(parent_id, "capa.png", "image/png", 100)
    await store.add_image(sub_active_id, "sub.png", "image/png", 100)

    result = await store.executar_limpar_concluidos("proj-a")

    assert result["cards"] == 3
    assert result["imagens"] == 2
    assert set(result["filenames_apagados"]) == {
        (parent_id, "capa.png"),
        (sub_active_id, "sub.png"),
    }

    assert await store.get(parent_id) is None
    assert await store.get(sub_deleted_id) is None
    assert await store.get(sub_active_id) is None


@pytest.mark.asyncio
async def test_executar_limpar_concluidos_is_idempotent(store):
    parent_id = await store.create(
        titulo="Pai feito",
        projeto_id="proj-a",
        status="feito",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    await store.create(
        titulo="Sub",
        projeto_id="proj-a",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.add_image(parent_id, "capa.png", "image/png", 100)

    first = await store.executar_limpar_concluidos("proj-a")
    assert first["cards"] == 2
    assert first["imagens"] == 1

    second = await store.executar_limpar_concluidos("proj-a")
    assert second == {"cards": 0, "imagens": 0, "filenames_apagados": []}


# -- list_by_cliente (Fase 3) ------------------------------------------------


async def _create_top_level(store, titulo: str, projeto_id: str) -> int:
    return await store.create(
        titulo=titulo,
        projeto_id=projeto_id,
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
    )


@pytest.mark.asyncio
async def test_list_by_cliente_returns_cliente_project_and_all_subprojects(store):
    """Caso normal: o card cliente-only (projeto_id == cliente_id) e os cards
    dos sub-projetos do mesmo cliente vêm todos juntos, e nada de outro
    cliente entra."""
    cliente_only = await _create_top_level(store, "Cliente-only", "acme")
    site = await _create_top_level(store, "Site", "acme/site")
    app_card = await _create_top_level(store, "App", "acme/app")
    await _create_top_level(store, "De outro cliente", "globex/site")

    cards = await store.list_by_cliente("acme")

    assert [c["id"] for c in cards] == [cliente_only, site, app_card]
    assert all(c["projeto_id"].startswith("acme") for c in cards)


@pytest.mark.asyncio
async def test_list_by_cliente_cliente_as_projeto_without_subprojects(store):
    """Cliente-como-projeto sem nenhum sub-projeto: o predicado do braço de
    igualdade sozinho já tem que devolver o card."""
    card_id = await _create_top_level(store, "Único", "podesubir")

    cards = await store.list_by_cliente("podesubir")

    assert len(cards) == 1
    assert cards[0]["id"] == card_id


@pytest.mark.asyncio
async def test_list_by_cliente_does_not_leak_cliente_whose_name_shares_prefix(store):
    """Fronteira de prefixo: "cliente" é prefixo de "cliente2". Um
    LIKE 'cliente%' ingênuo (sem a "/" no padrão) vazaria os cards de
    cliente2 para quem consulta cliente."""
    proprio = await _create_top_level(store, "Do cliente", "cliente/proj")
    proprio_raiz = await _create_top_level(store, "Cliente-only", "cliente")
    await _create_top_level(store, "Do cliente2", "cliente2/proj")
    await _create_top_level(store, "Cliente2-only", "cliente2")

    cards = await store.list_by_cliente("cliente")

    assert sorted(c["id"] for c in cards) == sorted([proprio, proprio_raiz])
    assert all(c["projeto_id"] in ("cliente", "cliente/proj") for c in cards)


@pytest.mark.asyncio
async def test_list_by_cliente_does_not_leak_when_cliente_id_contains_like_wildcards(
    store,
):
    """Fronteira que o teste de prefixo acima NÃO pega: nomes reais de cliente
    contêm "_" (ex: "cliente_projeto_1", o exemplo canônico da docstring de
    cliente_id_from_projeto_id), e "_" é wildcard de 1 caractere no LIKE. Um
    LIKE 'cliente_a/%' casaria com "clienteXa/proj" — vazamento cross-tenant.
    Este é o caso com dentes: o teste de fronteira de prefixo acima passa até
    com o LIKE ingênuo, porque a "/" no padrão já barra "cliente2"."""
    proprio = await _create_top_level(store, "Legítimo", "cliente_a/proj")
    await _create_top_level(store, "Vizinho casado pelo _ do LIKE", "clienteXa/proj")

    cards = await store.list_by_cliente("cliente_a")

    assert [c["id"] for c in cards] == [proprio]


@pytest.mark.asyncio
async def test_list_by_cliente_does_not_leak_when_cliente_id_contains_percent(store):
    """Mesma família do teste acima, para o outro wildcard do LIKE: um
    cliente_id contendo "%" (caractere legal em nome de pasta no Windows)
    viraria LIKE 'cli%/%', que casa com QUALQUER cliente cujo id comece com
    "cli"."""
    proprio = await _create_top_level(store, "Legítimo", "cli%/proj")
    await _create_top_level(store, "Vizinho casado pelo % do LIKE", "cliente2/proj")

    cards = await store.list_by_cliente("cli%")

    assert [c["id"] for c in cards] == [proprio]


@pytest.mark.asyncio
async def test_list_by_cliente_handles_non_ascii_cliente_id(store):
    """O braço de prefixo compara substr(projeto_id, 1, len(prefixo)) — len em
    Python conta code points e substr do SQLite conta caracteres, não bytes.
    Um nome de cliente acentuado (plausível num projeto PT-BR: "açougue",
    "são-paulo") desalinharia os dois se a contagem fosse em bytes, casando o
    cliente errado ou nenhum."""
    proprio = await _create_top_level(store, "Legítimo", "açme/proj")
    await _create_top_level(store, "Vizinho sem acento", "acme/proj")

    cards = await store.list_by_cliente("açme")

    assert [c["id"] for c in cards] == [proprio]


@pytest.mark.asyncio
async def test_list_by_cliente_hydrates_like_list_top_level(store):
    """Os dois caminhos de listagem (por projeto e por cliente) precisam
    devolver exatamente o mesmo formato — subcards, subcards_resumo e imagens
    inclusive —, senão o consumidor teria que saber qual dos dois rodou."""
    parent_id = await _create_top_level(store, "Pai", "acme/site")
    await store.create(
        titulo="Sub feito",
        projeto_id="acme/site",
        status="feito",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    await store.add_image(parent_id, "capa.png", "image/png", 100)

    por_cliente = await store.list_by_cliente("acme")
    por_projeto = await store.list_top_level(["acme/site"])

    assert por_cliente == por_projeto
    assert por_cliente[0]["subcards_resumo"] == {"total": 1, "feitos": 1}
    assert por_cliente[0]["imagens"][0]["filename"] == "capa.png"


@pytest.mark.asyncio
async def test_list_by_cliente_omits_subcards_and_deleted_cards_from_top_level(store):
    parent_id = await _create_top_level(store, "Pai", "acme/site")
    await store.create(
        titulo="Sub",
        projeto_id="acme/site",
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        parent_id=parent_id,
    )
    apagado = await _create_top_level(store, "Apagado", "acme/app")
    await store.soft_delete(apagado)

    cards = await store.list_by_cliente("acme")

    assert [c["id"] for c in cards] == [parent_id]


# -- ad-hoc migration of the tipo/prazo columns (F1-T9) --------------------
#
# The CREATE TABLE of a pre-feature database, pasted LITERALLY as a
# constant — reusing the module's DDL would defeat the test (the module
# already has the new columns).
_LEGACY_CARDS_DDL = """
CREATE TABLE cards (
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

_LEGACY_CARD_IMAGES_DDL = """
CREATE TABLE card_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    criado_em REAL NOT NULL
)
"""

_LEGACY_CARD_COLUMNS = (
    "id, titulo, projeto_id, parent_id, status, origem, "
    "ultima_atualizacao_por, descricao, session_key, criado_em, "
    "atualizado_em, deleted_at"
)

_EXPECTED_CARD_COLUMNS_IN_ORDER = [
    "id", "titulo", "projeto_id", "parent_id", "status", "origem",
    "ultima_atualizacao_por", "descricao", "session_key", "criado_em",
    "atualizado_em", "deleted_at", "tipo", "prazo", "board_position",
]


def _build_legacy_db(db_path: str) -> list[dict]:
    """Create a sessions.db on the pre-tipo/prazo schema with 2 cards (top
    level + subcard) and 1 row in card_images. Returns the dicts of the
    inserted card rows, for field-by-field comparison after the migration."""
    import sqlite3

    now = 1_700_000_000.0
    rows = [
        {
            "id": 1, "titulo": "Card de topo legado", "projeto_id": "acme/site",
            "parent_id": None, "status": "em_andamento", "origem": "bruno",
            "ultima_atualizacao_por": "bruno", "descricao": "desc legada",
            "session_key": None, "criado_em": now, "atualizado_em": now + 5,
            "deleted_at": None,
        },
        {
            "id": 2, "titulo": "Subcard legado", "projeto_id": "acme/site",
            "parent_id": 1, "status": "feito", "origem": "agente:claude",
            "ultima_atualizacao_por": "agente:claude", "descricao": None,
            "session_key": "acme/site::claude", "criado_em": now + 1,
            "atualizado_em": now + 2, "deleted_at": None,
        },
    ]
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(_LEGACY_CARDS_DDL)
        conn.execute(_LEGACY_CARD_IMAGES_DDL)
        for row in rows:
            conn.execute(
                f"INSERT INTO cards ({_LEGACY_CARD_COLUMNS}) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                tuple(row[c] for c in _EXPECTED_CARD_COLUMNS_IN_ORDER[:12]),
            )
        conn.execute(
            "INSERT INTO card_images "
            "(id, card_id, filename, mime_type, size_bytes, criado_em) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (1, 1, "print.png", "image/png", 2048, now + 3),
        )
        conn.commit()
    finally:
        conn.close()
    return rows


@pytest.mark.asyncio
async def test_initialize_migrates_legacy_db_without_losing_data(tmp_path):
    db_path = str(tmp_path / "legacy.db")
    original_rows = _build_legacy_db(db_path)

    store = CardStore(db_path=db_path)
    await store.initialize()
    try:
        # (c) PRAGMA table_info returns the 14 columns, tipo/prazo at the end, in order.
        async with store._conn.execute("PRAGMA table_info(cards)") as cursor:
            cols_in_order = [row[1] async for row in cursor]
        assert cols_in_order == _EXPECTED_CARD_COLUMNS_IN_ORDER

        # (a) and (b): the 2 rows are still there, field by field identical, and
        # tipo/prazo came out as NULL.
        async with store._conn.execute(
            "SELECT id, titulo, projeto_id, parent_id, status, origem, "
            "ultima_atualizacao_por, descricao, session_key, criado_em, "
            "atualizado_em, deleted_at, tipo, prazo, board_position "
            "FROM cards ORDER BY id ASC"
        ) as cursor:
            migrated = await cursor.fetchall()
        assert len(migrated) == len(original_rows)
        for original, row in zip(original_rows, migrated):
            migrated_dict = dict(zip(_EXPECTED_CARD_COLUMNS_IN_ORDER, row))
            for column in _EXPECTED_CARD_COLUMNS_IN_ORDER[:12]:
                assert migrated_dict[column] == original[column], column
            assert migrated_dict["tipo"] is None
            assert migrated_dict["prazo"] is None

        # (e) card_images untouched.
        async with store._conn.execute(
            "SELECT id, card_id, filename, mime_type, size_bytes FROM card_images"
        ) as cursor:
            images = await cursor.fetchall()
        assert images == [(1, 1, "print.png", "image/png", 2048)]
    finally:
        await store.close()

    # (d) idempotency: a second initialize() over the same file (new
    # instance — initialize() reassigns self._conn without closing the
    # previous one) does not raise and does not change the data.
    store2 = CardStore(db_path=db_path)
    await store2.initialize()
    try:
        async with store2._conn.execute("PRAGMA table_info(cards)") as cursor:
            cols_again = [row[1] async for row in cursor]
        assert cols_again == _EXPECTED_CARD_COLUMNS_IN_ORDER
        async with store2._conn.execute("SELECT COUNT(*) FROM cards") as cursor:
            (count,) = await cursor.fetchone()
        assert count == len(original_rows)
    finally:
        await store2.close()



# -- board_position: creation, reordering on status change -------------------


async def _positions_by_id(store) -> dict:
    async with store._conn.execute(
        "SELECT id, board_position FROM cards"
    ) as cursor:
        return {row[0]: row[1] async for row in cursor}


async def _make_card(store, titulo, status="a_fazer", **kwargs):
    return await store.create(
        titulo=titulo,
        projeto_id="proj-a",
        status=status,
        origem="bruno",
        ultima_atualizacao_por="bruno",
        **kwargs,
    )


@pytest.mark.asyncio
async def test_create_assigns_increasing_board_position_per_column(store):
    first = await _make_card(store, "Primeiro")
    second = await _make_card(store, "Segundo")
    other_column = await _make_card(store, "Outra coluna", status="em_andamento")

    positions = await _positions_by_id(store)
    assert positions[first] == 0.0
    assert positions[second] == 1.0
    # Position is per COLUMN: the first card of an empty column starts at 0
    # again, even though cards already exist elsewhere on the board.
    assert positions[other_column] == 0.0


@pytest.mark.asyncio
async def test_create_subcard_leaves_board_position_null(store):
    parent = await _make_card(store, "Pai")
    subcard = await _make_card(store, "Sub", parent_id=parent)

    positions = await _positions_by_id(store)
    assert positions[subcard] is None


@pytest.mark.asyncio
async def test_update_with_same_status_does_not_touch_board_position(store):
    first = await _make_card(store, "Primeiro")
    second = await _make_card(store, "Segundo")
    before = await _positions_by_id(store)

    # This is the payload CardFormModal sends on every save: the whole form,
    # status included, even when only the title changed. Re-appending the card
    # here would silently destroy any manual ordering.
    await store.update(
        first,
        ultima_atualizacao_por="bruno",
        titulo="Primeiro editado",
        status="a_fazer",
    )

    after = await _positions_by_id(store)
    assert after[first] == before[first]
    assert after[second] == before[second]


@pytest.mark.asyncio
async def test_update_to_a_different_status_appends_to_destination_column(store):
    await _make_card(store, "Ja em andamento", status="em_andamento")
    moving = await _make_card(store, "Vai mudar de coluna")

    await store.update(moving, ultima_atualizacao_por="bruno", status="em_andamento")

    positions = await _positions_by_id(store)
    # The destination column held one card at 0.0, so the moved card lands at 1.0.
    assert positions[moving] == 1.0


@pytest.mark.asyncio
async def test_update_to_an_empty_column_starts_at_zero(store):
    moving = await _make_card(store, "Unico card")

    await store.update(moving, ultima_atualizacao_por="bruno", status="em_revisao")

    positions = await _positions_by_id(store)
    assert positions[moving] == 0.0


@pytest.mark.asyncio
async def test_update_subcard_status_keeps_board_position_null(store):
    parent = await _make_card(store, "Pai")
    subcard = await _make_card(store, "Sub", parent_id=parent)

    await store.update(subcard, ultima_atualizacao_por="bruno", status="feito")

    positions = await _positions_by_id(store)
    assert positions[subcard] is None


@pytest.mark.asyncio
async def test_list_top_level_orders_by_board_position_not_id(store):
    first = await _make_card(store, "Primeiro")
    second = await _make_card(store, "Segundo")

    # Simulates what Phase 3's drag will do: rewrite a position by hand.
    await store._conn.execute(
        "UPDATE cards SET board_position = ? WHERE id = ?", (-1.0, second)
    )
    await store._conn.commit()

    listed = [c["id"] for c in await store.list_top_level()]
    assert listed == [second, first]


@pytest.mark.asyncio
async def test_list_by_cliente_orders_by_board_position_not_id(store):
    first = await store.create(
        titulo="Primeiro", projeto_id="acme/site", origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    second = await store.create(
        titulo="Segundo", projeto_id="acme/app", origem="bruno",
        ultima_atualizacao_por="bruno",
    )
    await store._conn.execute(
        "UPDATE cards SET board_position = ? WHERE id = ?", (-1.0, second)
    )
    await store._conn.commit()

    listed = [c["id"] for c in await store.list_by_cliente("acme")]
    assert listed == [second, first]


# -- board columns: seeding --------------------------------------------------


@pytest.mark.asyncio
async def test_initialize_seeds_the_four_legacy_columns(store):
    columns = await store.list_columns()
    assert [c["slug"] for c in columns] == [
        "a_fazer", "em_andamento", "em_revisao", "feito",
    ]
    assert [c["position"] for c in columns] == [1, 2, 3, 4]
    assert [c["is_done"] for c in columns] == [False, False, False, True]
    assert await store.get_done_slug() == "feito"


@pytest.mark.asyncio
async def test_done_column_index_forbids_a_second_done_column(store):
    import aiosqlite

    with pytest.raises(aiosqlite.IntegrityError):
        await store._conn.execute(
            "UPDATE board_columns SET is_done = 1 WHERE slug = 'a_fazer'"
        )


@pytest.mark.asyncio
async def test_require_done_slug_raises_when_no_column_is_marked(store):
    await store._conn.execute("UPDATE board_columns SET is_done = 0")
    await store._conn.commit()

    assert await store.get_done_slug() is None
    with pytest.raises(ValueError):
        await store.require_done_slug()


# -- board columns: CRUD -----------------------------------------------------


@pytest.mark.asyncio
async def test_create_column_appends_at_the_end_and_derives_a_slug(store):
    created = await store.create_column("Em Homologação")

    assert created == {
        "slug": "em_homologacao", "label": "Em Homologação",
        "position": 5, "is_done": False,
    }
    assert [c["slug"] for c in await store.list_columns()][-1] == "em_homologacao"


@pytest.mark.asyncio
async def test_create_column_rejects_a_blank_label(store):
    with pytest.raises(ValueError):
        await store.create_column("   ")


@pytest.mark.asyncio
async def test_create_column_rejects_a_duplicate_label_case_insensitively(store):
    await store.create_column("Em Homologação")
    with pytest.raises(ValueError):
        await store.create_column("  em   HOMOLOGAÇÃO ")


@pytest.mark.asyncio
async def test_create_column_rejects_a_label_matching_a_legacy_column(store):
    with pytest.raises(ValueError):
        await store.create_column("a fazer")


@pytest.mark.asyncio
async def test_update_column_label_keeps_the_slug(store):
    updated = await store.update_column_label("a_fazer", "Backlog")

    assert updated["slug"] == "a_fazer"
    assert updated["label"] == "Backlog"


@pytest.mark.asyncio
async def test_update_column_label_accepts_the_columns_own_label(store):
    updated = await store.update_column_label("a_fazer", "A Fazer")
    assert updated["label"] == "A Fazer"


@pytest.mark.asyncio
async def test_update_column_label_rejects_another_columns_label(store):
    with pytest.raises(ValueError):
        await store.update_column_label("a_fazer", "feito")


@pytest.mark.asyncio
async def test_update_column_label_returns_none_for_an_unknown_slug(store):
    assert await store.update_column_label("nao_existe", "Qualquer") is None


@pytest.mark.asyncio
async def test_reorder_columns_rewrites_every_position(store):
    reordered = await store.reorder_columns(
        ["feito", "a_fazer", "em_revisao", "em_andamento"]
    )

    assert [c["slug"] for c in reordered] == [
        "feito", "a_fazer", "em_revisao", "em_andamento",
    ]
    assert [c["position"] for c in reordered] == [1, 2, 3, 4]


@pytest.mark.asyncio
async def test_reorder_columns_rejects_a_subset(store):
    with pytest.raises(ValueError):
        await store.reorder_columns(["feito", "a_fazer"])


@pytest.mark.asyncio
async def test_reorder_columns_rejects_a_repeated_slug(store):
    with pytest.raises(ValueError):
        await store.reorder_columns(
            ["feito", "feito", "em_revisao", "em_andamento"]
        )


@pytest.mark.asyncio
async def test_reorder_columns_rejects_an_unknown_slug(store):
    with pytest.raises(ValueError):
        await store.reorder_columns(
            ["feito", "a_fazer", "em_revisao", "nao_existe"]
        )


@pytest.mark.asyncio
async def test_set_done_column_transfers_the_mark(store):
    columns = await store.set_done_column("em_revisao")

    done = [c["slug"] for c in columns if c["is_done"]]
    assert done == ["em_revisao"]


@pytest.mark.asyncio
async def test_set_done_column_on_an_unknown_slug_keeps_the_current_one(store):
    with pytest.raises(ValueError):
        await store.set_done_column("nao_existe")

    # The clear-then-set pair must not have run at all: a board with zero done
    # columns is worse than a refused request.
    assert await store.get_done_slug() == "feito"


@pytest.mark.asyncio
async def test_delete_column_removes_an_empty_column(store):
    await store.create_column("Em Homologação")

    assert await store.delete_column("em_homologacao") == {"slug": "em_homologacao"}
    assert "em_homologacao" not in [c["slug"] for c in await store.list_columns()]


@pytest.mark.asyncio
async def test_delete_column_returns_none_for_an_unknown_slug(store):
    assert await store.delete_column("nao_existe") is None


@pytest.mark.asyncio
async def test_delete_column_refuses_the_done_column(store):
    with pytest.raises(ColumnDeleteError) as excinfo:
        await store.delete_column("feito")
    assert excinfo.value.reason == CardStore.DELETE_COLUMN_IS_DONE


@pytest.mark.asyncio
async def test_delete_column_refuses_the_last_column(store):
    # The done check runs before the last-column check, so the last survivor
    # has to be a NON-done column for this refusal to be reachable at all.
    await store.create_column("Sobrevivente")
    await store.set_done_column("a_fazer")
    for slug in ("em_andamento", "em_revisao", "feito"):
        await store.delete_column(slug)
    await store.set_done_column("sobrevivente")
    await store.delete_column("a_fazer")

    with pytest.raises(ColumnDeleteError) as excinfo:
        await store.delete_column("sobrevivente")
    assert excinfo.value.reason == CardStore.DELETE_COLUMN_IS_DONE


@pytest.mark.asyncio
async def test_delete_column_refuses_a_column_holding_active_cards(store):
    await store.create_column("Em Homologação")
    await _make_card(store, "Card parado ali", status="em_homologacao")

    with pytest.raises(ColumnDeleteError) as excinfo:
        await store.delete_column("em_homologacao")
    assert excinfo.value.reason == CardStore.DELETE_COLUMN_HAS_CARDS
    assert excinfo.value.cards == 1


@pytest.mark.asyncio
async def test_delete_column_counts_subcards_too(store):
    await store.create_column("Em Homologação")
    parent = await _make_card(store, "Pai")
    await _make_card(store, "Sub", status="em_homologacao", parent_id=parent)

    with pytest.raises(ColumnDeleteError) as excinfo:
        await store.delete_column("em_homologacao")
    assert excinfo.value.cards == 1


@pytest.mark.asyncio
async def test_delete_column_ignores_soft_deleted_cards(store):
    await store.create_column("Em Homologação")
    card_id = await _make_card(store, "Card removido", status="em_homologacao")
    await store.soft_delete(card_id)

    assert await store.delete_column("em_homologacao") == {"slug": "em_homologacao"}


# -- subcard summary / limpar concluidos follow the done column, not 'feito' --


@pytest.mark.asyncio
async def test_subcards_resumo_follows_the_done_column_after_it_moves(store):
    parent = await _make_card(store, "Pai")
    await _make_card(store, "Sub em revisao", status="em_revisao", parent_id=parent)
    await _make_card(store, "Sub feito", status="feito", parent_id=parent)

    listed = await store.list_top_level()
    assert listed[0]["subcards_resumo"] == {"total": 2, "feitos": 1}

    # Same 1-of-2 count, but now it is the 'em_revisao' subcard being counted:
    # the summary follows the done COLUMN, not the literal 'feito' string.
    await store.set_done_column("em_revisao")
    listed = await store.list_top_level()
    assert listed[0]["subcards_resumo"] == {"total": 2, "feitos": 1}

    await store.set_done_column("a_fazer")
    listed = await store.list_top_level()
    assert listed[0]["subcards_resumo"] == {"total": 2, "feitos": 0}


@pytest.mark.asyncio
async def test_limpar_concluidos_targets_the_done_column_after_it_moves(store):
    revisao = await _make_card(store, "Em revisao", status="em_revisao")
    feito = await _make_card(store, "Feito", status="feito")

    await store.set_done_column("em_revisao")

    preview = await store.preview_limpar_concluidos("proj-a")
    assert preview["cards"] == 1

    result = await store.executar_limpar_concluidos("proj-a")
    assert result["cards"] == 1
    remaining = [c["id"] for c in await store.list_top_level()]
    assert remaining == [feito]
    assert revisao not in remaining


@pytest.mark.asyncio
async def test_list_top_level_raises_when_no_done_column_exists(store):
    """Fails loud rather than reporting "0 de N concluídos" for every card:
    with no done column, the comparison would silently match nothing and the
    wrong count would look exactly like a real one."""
    await _make_card(store, "Qualquer")
    await store._conn.execute("UPDATE board_columns SET is_done = 0")
    await store._conn.commit()

    with pytest.raises(ValueError):
        await store.list_top_level()
    with pytest.raises(ValueError):
        await store.list_by_cliente("proj-a")


@pytest.mark.asyncio
async def test_limpar_concluidos_raises_when_no_done_column_exists(store):
    await store._conn.execute("UPDATE board_columns SET is_done = 0")
    await store._conn.commit()

    with pytest.raises(ValueError):
        await store.preview_limpar_concluidos("proj-a")
    with pytest.raises(ValueError):
        await store.executar_limpar_concluidos("proj-a")



# -- migration of board_columns + board_position over a legacy database ------


def _build_legacy_db_with_orphan_statuses(db_path: str) -> list[dict]:
    """Legacy schema again, but seeded with the case that actually decides the
    seeding rules: a card sitting on a status NO hard-coded column ever had.

    Two of them, on purpose — one ACTIVE (must get a column of its own, or it
    would vanish from a board that only renders known columns) and one
    SOFT-DELETED (must NOT, or every dirty status ever soft-deleted becomes a
    permanent column the user has to clean up by hand)."""
    import sqlite3

    now = 1_700_000_000.0
    rows = [
        {
            "id": 1, "titulo": "Card de topo legado", "projeto_id": "acme/site",
            "parent_id": None, "status": "em_andamento", "origem": "bruno",
            "ultima_atualizacao_por": "bruno", "descricao": "desc legada",
            "session_key": None, "criado_em": now, "atualizado_em": now + 5,
            "deleted_at": None,
        },
        {
            "id": 2, "titulo": "Subcard legado", "projeto_id": "acme/site",
            "parent_id": 1, "status": "feito", "origem": "agente:claude",
            "ultima_atualizacao_por": "agente:claude", "descricao": None,
            "session_key": "acme/site::claude", "criado_em": now + 1,
            "atualizado_em": now + 2, "deleted_at": None,
        },
        {
            "id": 3, "titulo": "Card com status orfao ATIVO",
            "projeto_id": "acme/site", "parent_id": None,
            "status": "bloqueado", "origem": "bruno",
            "ultima_atualizacao_por": "bruno", "descricao": None,
            "session_key": None, "criado_em": now + 3, "atualizado_em": now + 3,
            "deleted_at": None,
        },
        {
            "id": 4, "titulo": "Card com status orfao SOFT-DELETADO",
            "projeto_id": "acme/site", "parent_id": None,
            "status": "arquivado_2019", "origem": "bruno",
            "ultima_atualizacao_por": "bruno", "descricao": None,
            "session_key": None, "criado_em": now + 4, "atualizado_em": now + 4,
            "deleted_at": now + 6,
        },
    ]
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(_LEGACY_CARDS_DDL)
        conn.execute(_LEGACY_CARD_IMAGES_DDL)
        for row in rows:
            conn.execute(
                f"INSERT INTO cards ({_LEGACY_CARD_COLUMNS}) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                tuple(row[c] for c in _EXPECTED_CARD_COLUMNS_IN_ORDER[:12]),
            )
        conn.commit()
    finally:
        conn.close()
    return rows


async def _status_counts(store) -> dict:
    async with store._conn.execute(
        "SELECT status, COUNT(*) FROM cards GROUP BY status"
    ) as cursor:
        return {row[0]: row[1] async for row in cursor}


@pytest.mark.asyncio
async def test_migration_seeds_columns_and_backfills_positions(tmp_path):
    db_path = str(tmp_path / "legacy_columns.db")
    original_rows = _build_legacy_db_with_orphan_statuses(db_path)

    store = CardStore(db_path=db_path)
    await store.initialize()
    try:
        # No card changed column: the migration only ADDS the table that
        # describes the columns, it never rewrites cards.status.
        counts = await _status_counts(store)
        expected_counts = {}
        for row in original_rows:
            expected_counts[row["status"]] = expected_counts.get(row["status"], 0) + 1
        assert counts == expected_counts

        columns = await store.list_columns()
        slugs = [c["slug"] for c in columns]
        # The 4 legacy columns in their historical order, plus ONE extra for
        # the active orphan. 'arquivado_2019' (soft-deleted) gets nothing.
        assert slugs == [
            "a_fazer", "em_andamento", "em_revisao", "feito", "bloqueado",
        ]
        assert [c["position"] for c in columns] == [1, 2, 3, 4, 5]

        # Every ACTIVE card's status is renderable.
        async with store._conn.execute(
            "SELECT DISTINCT status FROM cards WHERE deleted_at IS NULL"
        ) as cursor:
            active_statuses = {row[0] async for row in cursor}
        assert active_statuses <= set(slugs)

        assert [c["slug"] for c in columns if c["is_done"]] == ["feito"]

        # Positions: id * 1.0 for top-level cards, NULL for the subcard.
        async with store._conn.execute(
            "SELECT id, parent_id, board_position FROM cards ORDER BY id ASC"
        ) as cursor:
            positions = await cursor.fetchall()
        for card_id, parent_id, position in positions:
            if parent_id is None:
                assert position == card_id * 1.0
            else:
                assert position is None
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_migration_is_idempotent_and_preserves_manual_positions(tmp_path):
    db_path = str(tmp_path / "legacy_idempotent.db")
    _build_legacy_db_with_orphan_statuses(db_path)

    store = CardStore(db_path=db_path)
    await store.initialize()
    try:
        # Simulate what the user does between two boots: rename a column,
        # delete another, and drag a card to a fractional position.
        await store.update_column_label("a_fazer", "Backlog")
        await store.delete_column("em_revisao")
        await store._conn.execute(
            "UPDATE cards SET board_position = 2.5 WHERE id = 1"
        )
        await store._conn.commit()
    finally:
        await store.close()

    store2 = CardStore(db_path=db_path)
    await store2.initialize()
    try:
        columns = await store2.list_columns()
        # Nothing was re-seeded: the renamed column kept its new label and the
        # deleted one did NOT come back.
        assert [c["slug"] for c in columns] == [
            "a_fazer", "em_andamento", "feito", "bloqueado",
        ]
        assert columns[0]["label"] == "Backlog"

        # The manual position survived: the backfill is guarded by
        # `board_position IS NULL`, not by "has this migration run before".
        async with store2._conn.execute(
            "SELECT board_position FROM cards WHERE id = 1"
        ) as cursor:
            (position,) = await cursor.fetchone()
        assert position == 2.5
    finally:
        await store2.close()


# -- QA: guard reads that sit OUTSIDE the transaction they guard -------------
#
# Every transactional method on CardStore takes `_tx_lock` around its explicit
# BEGIN block, but two of them read the state the whole decision hinges on
# BEFORE taking that lock. Between the read and the lock there is at least one
# `await`, so another request handler on the same event loop can run to
# completion in the window and invalidate the answer.
#
# The tests below inject that window deterministically instead of racing two
# coroutines and hoping for the right interleaving.


class _LockWithHook:
    """`asyncio.Lock` proxy that runs a ONE-SHOT callback immediately before the
    real lock is acquired — i.e. exactly in the window a CardStore method leaves
    open between its guard read and its transaction.

    The callback slot is cleared BEFORE the callback is awaited on purpose: the
    injected coroutine takes this very same lock, and leaving the slot armed
    would re-enter the hook forever."""

    def __init__(self, inner):
        self._inner = inner
        self._hook = None

    def arm(self, hook):
        self._hook = hook

    async def __aenter__(self):
        hook, self._hook = self._hook, None
        if hook is not None:
            await hook()
        return await self._inner.__aenter__()

    async def __aexit__(self, *exc_info):
        return await self._inner.__aexit__(*exc_info)


async def _race_delete_against_marking_the_same_column_done(store):
    """Drive the interleaving that used to strip the board of its done column.

    Board starts as the four seeded columns with 'feito' marked. A delete of
    'em_revisao' is issued; the done mark is moved ONTO 'em_revisao' in the
    window before the delete takes the lock; the delete then resumes.

    Returns the ColumnDeleteError the delete raised, or None if it went
    through. Now that the `is_done` guard reads inside the lock, the delete
    observes the mark that arrived in the window and refuses — so the expected
    return is the error, not None."""
    hooked = _LockWithHook(store._tx_lock)
    store._tx_lock = hooked
    hooked.arm(lambda: store.set_done_column("em_revisao"))

    try:
        await store.delete_column("em_revisao")
        return None
    except ColumnDeleteError as e:
        return e
    finally:
        # Restore the real lock even on the raising path, or every later
        # acquisition in this test would keep re-firing the hook wrapper.
        store._tx_lock = hooked._inner


@pytest.mark.asyncio
async def test_delete_column_keeps_a_done_column_under_concurrent_marking(store):
    """The partial unique index enforces AT MOST one done column. Nothing in
    the schema enforces AT LEAST one — this is the path that used to reach
    zero, and the guard that closes it now lives inside the lock."""
    error = await _race_delete_against_marking_the_same_column_done(store)

    # The delete is refused, not silently completed: it re-reads `is_done`
    # under the lock and sees the mark that landed in the window.
    assert error is not None
    assert error.reason == CardStore.DELETE_COLUMN_IS_DONE

    assert await store.get_done_slug() == "em_revisao"
    assert "em_revisao" in [c["slug"] for c in await store.list_columns()]


@pytest.mark.asyncio
async def test_set_done_column_keeps_a_done_column_under_concurrent_delete(store):
    """Same defect, second door: the guard read was in the right place
    logically but the wrong place transactionally. Reading it inside the lock
    means the column's disappearance is observed before the clear-UPDATE runs,
    so the board never loses its mark."""
    await store.create_column("Homologação")

    hooked = _LockWithHook(store._tx_lock)
    store._tx_lock = hooked
    hooked.arm(lambda: store.delete_column("homologacao"))

    try:
        with pytest.raises(ValueError):
            await store.set_done_column("homologacao")
    finally:
        store._tx_lock = hooked._inner

    # The clear-UPDATE never ran: the original mark is untouched, not merely
    # "some column is marked".
    assert await store.get_done_slug() == "feito"


@pytest.mark.asyncio
async def test_create_column_duplicate_check_holds_against_a_concurrent_create(store):
    """Regression pin for the race the Dev found while reworking: the duplicate
    check, the slug generation and the INSERT have to read the table under the
    SAME lock hold.

    Split apart, two simultaneous creates of one label both pass the duplicate
    check, both slugify against an identical `taken` set, and the second INSERT
    dies on the PRIMARY KEY — an IntegrityError (500) where the UI expects the
    readable refusal (409). Asserting ValueError specifically is what
    distinguishes the two: sqlite's IntegrityError is not a ValueError."""
    hooked = _LockWithHook(store._tx_lock)
    store._tx_lock = hooked
    hooked.arm(lambda: store.create_column("Homologação"))

    try:
        with pytest.raises(ValueError):
            await store.create_column("Homologação")
    finally:
        store._tx_lock = hooked._inner

    # Exactly one column was created, and the slug has no collision suffix.
    slugs = [c["slug"] for c in await store.list_columns()]
    assert slugs.count("homologacao") == 1
    assert "homologacao_2" not in slugs


@pytest.mark.asyncio
async def test_rename_duplicate_check_holds_against_a_concurrent_rename(store):
    """Same shape on the rename path: outside the lock, two renames to the same
    label both pass the check and the board ends up with two columns carrying
    it — exactly what the product rule forbids."""
    hooked = _LockWithHook(store._tx_lock)
    store._tx_lock = hooked
    hooked.arm(lambda: store.update_column_label("em_andamento", "Duplicado"))

    try:
        with pytest.raises(ValueError):
            await store.update_column_label("em_revisao", "Duplicado")
    finally:
        store._tx_lock = hooked._inner

    labels = [c["label"] for c in await store.list_columns()]
    assert labels.count("Duplicado") == 1


@pytest.mark.asyncio
async def test_delete_column_is_last_is_unreachable_through_the_public_api(store):
    """DELETE_COLUMN_IS_LAST is defensive, not dead — and it is NOT reachable
    through the API any more.

    The QA originally reached it by racing delete_column against
    set_done_column to strip the board of its done column; both races are
    fixed, so that door is closed. What keeps the branch unreachable is the
    "exactly one done column" invariant: the done check runs first, and the
    last surviving column always carries the mark.

    This test walks the deletion as far as the API allows and pins WHICH
    refusal stops it — if a future change lets the board reach one non-done
    column, this is the test that starts failing."""
    await store.set_done_column("a_fazer")
    for slug in ("em_andamento", "em_revisao", "feito"):
        await store.delete_column(slug)

    assert [c["slug"] for c in await store.list_columns()] == ["a_fazer"]

    # The survivor is the done column, so THAT is the refusal — IS_LAST never
    # gets a chance to fire.
    with pytest.raises(ColumnDeleteError) as excinfo:
        await store.delete_column("a_fazer")
    assert excinfo.value.reason == CardStore.DELETE_COLUMN_IS_DONE


@pytest.mark.asyncio
async def test_delete_column_is_last_fires_on_a_board_with_no_done_mark(store):
    """The one state that DOES reach DELETE_COLUMN_IS_LAST: a board whose done
    mark was cleared outside the API (a hand-edited database, a restore from a
    dump that predates the partial index). The branch exists for exactly this —
    it is the last thing standing between such a board and zero columns."""
    await store._conn.execute("UPDATE board_columns SET is_done = 0")
    await store._conn.commit()

    for slug in ("em_andamento", "em_revisao", "feito"):
        await store.delete_column(slug)

    with pytest.raises(ColumnDeleteError) as excinfo:
        await store.delete_column("a_fazer")
    assert excinfo.value.reason == CardStore.DELETE_COLUMN_IS_LAST


@pytest.mark.asyncio
async def test_an_open_transaction_survives_a_commit_from_another_writer(store):
    """`_tx_lock` now covers every WRITING method, not just the ones that open
    an explicit BEGIN — so an open transaction really is isolated from the
    commits of `create`/`update`/`soft_delete`/`add_image`/`delete_image`.

    Concretely, this is what makes delete_column's count-then-DELETE atomic
    against a card being created in the very column being deleted: without it
    the create's commit ends delete_column's transaction early, the DELETE runs
    in autocommit, and the `except -> rollback` is a no-op.

    The create runs in a separate TASK because the lock is not reentrant:
    awaiting it inline from a holder would deadlock, which is the point — it
    now has to wait its turn instead of barging into the transaction."""
    create_task = None
    async with store._tx_lock:
        await store._conn.execute("BEGIN")
        await store._conn.execute(
            "DELETE FROM board_columns WHERE slug = 'em_revisao'"
        )
        create_task = asyncio.create_task(
            _make_card(store, "Card criado durante a transação")
        )
        # Give the task every chance to reach the lock and block on it.
        await asyncio.sleep(0)
        assert not create_task.done()
        await store._conn.rollback()

    await create_task

    # The rollback undid the DELETE: the card's commit never reached inside it.
    assert "em_revisao" in [c["slug"] for c in await store.list_columns()]
    assert [c["titulo"] for c in await store.list_top_level()] == [
        "Card criado durante a transação"
    ]


# -- QA: reorder payloads the existing suite does not cover -------------------


@pytest.mark.asyncio
async def test_reorder_columns_rejects_an_empty_list(store):
    """An empty list is not "leave it as it is" — it is a client that read an
    empty board. Applying it would silently keep every stale position."""
    with pytest.raises(ValueError):
        await store.reorder_columns([])
    assert len(await store.list_columns()) == 4


@pytest.mark.asyncio
async def test_reorder_columns_rejects_a_superset(store):
    """One slug too many: a permutation of the current set plus a column that
    another tab has already deleted."""
    with pytest.raises(ValueError):
        await store.reorder_columns(
            ["a_fazer", "em_andamento", "em_revisao", "feito", "fantasma"]
        )
    assert [c["position"] for c in await store.list_columns()] == [1, 2, 3, 4]


@pytest.mark.asyncio
async def test_reorder_columns_rejects_a_duplicate_that_keeps_the_length(store):
    """Length matches the current count AND the set matches — but one slug is
    repeated and another is missing. Only the `len(set(...))` half of the guard
    catches this one."""
    with pytest.raises(ValueError):
        await store.reorder_columns(
            ["a_fazer", "a_fazer", "em_andamento", "em_revisao"]
        )
    assert [c["slug"] for c in await store.list_columns()] == [
        "a_fazer", "em_andamento", "em_revisao", "feito",
    ]


# -- QA: migration over a genuinely dirty legacy database ---------------------


def _build_legacy_db_with_dirty_statuses(db_path: str) -> None:
    """A legacy database whose `cards.status` values are not merely unknown but
    MALFORMED — the state a real board accumulates over years of hand-written
    agent payloads and half-finished features.

    Covers, on ACTIVE cards: empty string, whitespace-only, and a free-text
    status carrying spaces, accents and mixed case.

    A NULL status is deliberately NOT in the list: `cards.status` is declared
    NOT NULL on both the legacy and the current schema, so sqlite refuses the
    row. The `if s` guard's None branch in _seed_board_columns is therefore
    defensive only — no database can reach it."""
    import sqlite3

    now = 1_700_000_000.0
    dirty_statuses = ["", "   ", "Em Revisão Externa", "bloqueado"]
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(_LEGACY_CARDS_DDL)
        conn.execute(_LEGACY_CARD_IMAGES_DDL)
        for index, status in enumerate(dirty_statuses, start=1):
            conn.execute(
                f"INSERT INTO cards ({_LEGACY_CARD_COLUMNS}) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    index, f"Card sujo {index}", "acme/site", None, status,
                    "bruno", "bruno", None, None, now + index, now + index, None,
                ),
            )
        conn.commit()
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_migration_over_multiple_dirty_orphan_statuses(tmp_path):
    """Characterisation test: pins what the seeding actually does with dirty
    input, so any change to it is a deliberate one.

    Two results here are correct and worth protecting: "" is skipped
    (`if s` filters it), and the slug of an orphan column is the RAW status —
    it has to be, or the cards referencing it would be orphaned all over again.

    The whitespace-only LABEL was a QA finding and is now FIXED: the slug stays
    raw (it must), but the label falls back to a readable placeholder so the
    column can be seen and named in the UI.

    One finding remains reported rather than asserted as desired behaviour:
    `slugify_column_label` is never applied here, so these slugs violate the
    ASCII/lowercase/underscore contract board_columns.py documents for every
    slug the system creates through the normal path. Normalising them is not
    an option — the slug IS the cards' status, and rewriting it would orphan
    the very cards the column exists to render."""
    db_path = str(tmp_path / "legacy_dirty.db")
    _build_legacy_db_with_dirty_statuses(db_path)

    store = CardStore(db_path=db_path)
    await store.initialize()
    try:
        columns = await store.list_columns()
        slugs = [c["slug"] for c in columns]

        # "" never becomes a column.
        assert "" not in slugs

        # Every other ACTIVE status did, sorted, appended after the four seeds.
        assert slugs == [
            "a_fazer", "em_andamento", "em_revisao", "feito",
            "   ", "Em Revisão Externa", "bloqueado",
        ]
        assert [c["position"] for c in columns] == [1, 2, 3, 4, 5, 6, 7]

        # Exactly one done column survived the multi-orphan insert.
        assert [c["slug"] for c in columns if c["is_done"]] == ["feito"]

        by_slug = {c["slug"]: c for c in columns}
        # FIXED: the slug is still the raw status (it has to be), but the label
        # is readable — a header of pure whitespace is a column the user can
        # neither see nor refer to.
        assert by_slug["   "]["slug"] == "   "
        assert by_slug["   "]["label"] == "(sem nome)"
        assert by_slug["   "]["label"].strip()
        # A label that IS meaningful text is passed through untouched.
        assert by_slug["bloqueado"]["label"] == "bloqueado"
        # FINDING: a slug the slug contract would never have produced.
        assert by_slug["Em Revisão Externa"]["slug"] == "Em Revisão Externa"

        # The card whose status was "" is still invisible on the board — no
        # column renders it. That is pre-existing dirt, not something the
        # migration introduced, but nothing repairs it either.
        async with store._conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deleted_at IS NULL AND status = ''"
        ) as cursor:
            (unrenderable,) = await cursor.fetchone()
        assert unrenderable == 1
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_migration_preserves_list_top_level_ordering(tmp_path):
    """Equivalence check: the backfill (id * 1.0) plus the new
    `ORDER BY board_position ASC, id ASC` must produce the very same sequence
    the old `ORDER BY id ASC` did."""
    import sqlite3

    db_path = str(tmp_path / "legacy_order.db")
    _build_legacy_db_with_orphan_statuses(db_path)

    conn = sqlite3.connect(db_path)
    try:
        before = [
            row[0]
            for row in conn.execute(
                "SELECT id FROM cards "
                "WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY id ASC"
            )
        ]
    finally:
        conn.close()

    store = CardStore(db_path=db_path)
    await store.initialize()
    try:
        after = [c["id"] for c in await store.list_top_level()]
    finally:
        await store.close()

    assert after == before
