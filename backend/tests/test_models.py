# backend/tests/test_models.py
from app.models import Card, TaskGlobal


def test_card_with_nested_subcards_does_not_raise():
    """Card usa auto-referência `list["Card"]` sob `from __future__ import
    annotations` — sem o `Card.model_rebuild()` explícito em models.py, esta
    instanciação levantaria PydanticUndefinedAnnotation na primeira
    validação. Este teste pega esse esquecimento."""
    subcard = Card(
        id=2,
        titulo="y",
        projeto_id="p",
        parent_id=1,
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        criado_em=0.0,
        atualizado_em=0.0,
    )
    card = Card(
        id=1,
        titulo="x",
        projeto_id="p",
        parent_id=None,
        status="a_fazer",
        origem="bruno",
        ultima_atualizacao_por="bruno",
        criado_em=0.0,
        atualizado_em=0.0,
        subcards=[subcard],
    )
    assert card.subcards[0].id == 2
    assert card.subcards[0].subcards == []


def test_task_global_extends_task_fields():
    """TaskGlobal herda de Task (tarefas de validação por sessão) e adiciona
    o contexto de projeto/agente usado pela visão global de Tarefas."""
    tg = TaskGlobal(
        id=1,
        session_key="proj::claude",
        titulo="titulo",
        descricao_markdown="**md**",
        descricao_html=None,
        status="pending",
        created_at=0.0,
        completed_at=None,
        projeto_id="proj",
        agent_id="claude",
        session_display_name="Sessão 1",
    )
    assert tg.projeto_id == "proj"
    assert tg.agent_id == "claude"
    assert tg.session_display_name == "Sessão 1"
