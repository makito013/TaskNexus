import pytest
import pytest_asyncio
from app.card_store import CardStore


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

    pais_ids, subcards_ids = await store._selecionar_alvo_limpar("proj-a")

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
