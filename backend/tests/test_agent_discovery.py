"""Tests for agent discovery functionality."""

import pytest
import os
from pathlib import Path
from app.agent_discovery import (
    scan_projects,
    cliente_id_from_projeto_id,
    resolve_projeto_alvo,
)
from app.models import Agent, Project


@pytest.fixture
def fake_projects(tmp_path):
    """Cria estrutura de projetos falsa para testes."""
    # projeto com .claude/ (auto-detect)
    (tmp_path / "projeto-claude" / ".claude").mkdir(parents=True)
    # projeto com .gemini/ (auto-detect Gemini)
    (tmp_path / "projeto-gemini" / ".gemini").mkdir(parents=True)
    # projeto com ambos .claude/ e .gemini/
    (tmp_path / "projeto-ambos" / ".claude").mkdir(parents=True)
    (tmp_path / "projeto-ambos" / ".gemini").mkdir(parents=True)
    # sub-projeto: pasta com .claude/ aninhada sob outra pasta elegível
    (tmp_path / "projeto-claude" / "sub" / ".claude").mkdir(parents=True)
    # projeto sem nada (não deve aparecer)
    (tmp_path / "sem-nada").mkdir()
    # pasta excluída
    (tmp_path / "node_modules").mkdir()
    return tmp_path


def test_finds_projects_with_agents(fake_projects):
    """Should find eligible projects (.claude/ or .gemini/ present)."""
    projects = scan_projects(str(fake_projects))
    ids = [p.id for p in projects]
    assert "projeto-claude" in ids


def test_finds_sub_projects(fake_projects):
    """Should find sub-projects under parent projects."""
    projects = scan_projects(str(fake_projects))
    ids = [p.id for p in projects]
    assert "projeto-claude/sub" in ids


def test_excludes_projects_without_config(fake_projects):
    """Should exclude projects with neither .claude/ nor .gemini/."""
    projects = scan_projects(str(fake_projects))
    ids = [p.id for p in projects]
    assert "sem-nada" not in ids


def test_autodetect_claude_folder(fake_projects):
    """A project with .claude/ is eligible; its agent list comes from
    global_agents (empty here — no auto-detected synthetic agent anymore)."""
    projects = scan_projects(str(fake_projects))
    proj = next((p for p in projects if p.id == "projeto-claude"), None)
    assert proj is not None
    assert proj.agentes == []


def test_excludes_node_modules(fake_projects):
    """Should exclude node_modules from scan."""
    projects = scan_projects(str(fake_projects))
    ids = [p.id for p in projects]
    assert "node_modules" not in ids


def test_path_is_absolute(fake_projects):
    """Should store absolute paths for all projects."""
    projects = scan_projects(str(fake_projects))
    for p in projects:
        assert os.path.isabs(p.path)


def test_sub_projetos_relationship(fake_projects):
    """Should correctly build sub_projetos relationship between parent and child projects."""
    projects = scan_projects(str(fake_projects))
    projeto_claude = next(p for p in projects if p.id == "projeto-claude")
    assert "projeto-claude/sub" in projeto_claude.sub_projetos


def test_creates_placeholder_parent_projects(tmp_path):
    """When a sub-project exists but its parent folder has no agent config, a placeholder project must be created for the parent."""
    # Create pessoal/estatistica with .claude folder
    p = tmp_path / "pessoal" / "estatistica" / ".claude"
    p.mkdir(parents=True)

    projects = scan_projects(str(tmp_path))
    ids = [p.id for p in projects]
    # 'pessoal' must be created as a parent placeholder, and 'pessoal/estatistica' must also exist
    assert "pessoal" in ids
    assert "pessoal/estatistica" in ids

    # 'pessoal' should have no agents
    pessoal_proj = next(p for p in projects if p.id == "pessoal")
    assert len(pessoal_proj.agentes) == 0
    assert "pessoal/estatistica" in pessoal_proj.sub_projetos


def test_scan_projects_sets_elegivel_true_for_project_with_claude_folder(fake_projects):
    """A project with a .claude/ folder must be marked elegivel=True."""
    projects = scan_projects(str(fake_projects))
    proj = next(p for p in projects if p.id == "projeto-claude")
    assert proj.elegivel is True


def test_scan_projects_sets_elegivel_true_for_project_with_gemini_folder(fake_projects):
    """A project with a .gemini/ folder must be marked elegivel=True, same
    as .claude/."""
    projects = scan_projects(str(fake_projects))
    proj = next(p for p in projects if p.id == "projeto-gemini")
    assert proj.elegivel is True


def test_scan_projects_sets_elegivel_false_for_placeholder_parent_project(tmp_path):
    """A synthesized placeholder parent (no .claude/ nor .gemini/ of its own)
    must stay elegivel=False, even though it has an eligible descendant."""
    (tmp_path / "pessoal" / "estatistica" / ".claude").mkdir(parents=True)

    projects = scan_projects(str(tmp_path))
    pessoal_proj = next(p for p in projects if p.id == "pessoal")
    assert pessoal_proj.elegivel is False


def test_autodetect_gemini_folder(fake_projects):
    """A project with .gemini/ is eligible, same as .claude/."""
    projects = scan_projects(str(fake_projects))
    proj = next((p for p in projects if p.id == "projeto-gemini"), None)
    assert proj is not None
    assert proj.agentes == []


def test_autodetect_both_claude_and_gemini(fake_projects):
    """A project with both .claude/ and .gemini/ is eligible exactly once
    (not duplicated), same as either folder alone."""
    projects = scan_projects(str(fake_projects))
    proj = next((p for p in projects if p.id == "projeto-ambos"), None)
    assert proj is not None
    assert proj.agentes == []


def test_default_agent_flag():
    """Global agents assigned to a project are used as-is — `default` is
    whatever GlobalAgentStore set (never True in practice, since it never
    writes that field). No project-side logic forces a default anymore."""
    agent = Agent(id="claude-work", nome="Claude (Work)", papel="Assistente", ia="claude", cmd=["claude"])
    assert agent.default is False


def test_scan_projects_without_global_agents_param_unchanged(fake_projects):
    """Backward compatibility: omitting global_agents must not error and
    must leave eligible projects with an empty agent list."""
    projects = scan_projects(str(fake_projects))
    proj = next(p for p in projects if p.id == "projeto-claude")
    assert proj.agentes == []


def test_scan_projects_merges_global_agents_into_autodetect_project(fake_projects):
    """Eligible projects get the global_agents list assigned directly (no
    merge/dedup needed anymore — there's no per-project list to merge into)."""
    global_agents = [Agent(id="claude-work", nome="Claude (Work)", papel="Assistente", ia="claude", cmd=["claude", "--settings", "~/.claude-work"])]
    projects = scan_projects(str(fake_projects), global_agents=global_agents)
    proj = next(p for p in projects if p.id == "projeto-claude")
    ids = {a.id for a in proj.agentes}
    assert ids == {"claude-work"}


def test_scan_projects_global_agents_do_not_add_ineligible_projects(fake_projects):
    """A folder with neither .claude/ nor .gemini/ must stay excluded
    even when the global registry is non-empty (global agents augment
    eligible projects' agent lists, they don't make new folders eligible)."""
    global_agents = [Agent(id="claude-work", nome="Claude (Work)", papel="Assistente", ia="claude", cmd=["claude"])]
    projects = scan_projects(str(fake_projects), global_agents=global_agents)
    ids = [p.id for p in projects]
    assert "sem-nada" not in ids


# -- cliente_id (Grupo B da feature Cliente/Projeto) -------------------------


def test_cliente_id_from_projeto_id_flat():
    """Projeto solto na raiz (sem "/"): cliente_id == o próprio id."""
    assert cliente_id_from_projeto_id("projeto_2") == "projeto_2"


def test_cliente_id_from_projeto_id_one_level():
    """Cliente-como-projeto sem subpasta, mesmo raciocínio do caso flat —
    coberto separadamente porque é o caso citado explicitamente no plano
    (ex: "podesubir")."""
    assert cliente_id_from_projeto_id("podesubir") == "podesubir"


def test_cliente_id_from_projeto_id_multi_level():
    """Cliente com múltiplos projetos: cliente_id é sempre o primeiro
    segmento, mesmo com mais de um nível de aninhamento."""
    assert cliente_id_from_projeto_id("cliente_projeto_1/subprojeto_1") == "cliente_projeto_1"
    assert cliente_id_from_projeto_id("cliente_projeto_1/subprojeto_1/sub") == "cliente_projeto_1"


def test_scan_projects_populates_cliente_id_for_client_with_multiple_projects(tmp_path):
    """cliente_projeto_1/subprojeto_1 -> cliente_id "cliente_projeto_1", tanto
    no filho quanto no placeholder de pai sintetizado."""
    (tmp_path / "cliente_projeto_1" / "subprojeto_1" / ".claude").mkdir(parents=True)

    projects = scan_projects(str(tmp_path))
    subprojeto = next(p for p in projects if p.id == "cliente_projeto_1/subprojeto_1")
    cliente = next(p for p in projects if p.id == "cliente_projeto_1")
    assert subprojeto.cliente_id == "cliente_projeto_1"
    assert cliente.cliente_id == "cliente_projeto_1"


def test_scan_projects_populates_cliente_id_for_client_as_project(fake_projects):
    """projeto-claude (cliente-como-projeto, sem "/"): cliente_id ==
    "projeto-claude"."""
    projects = scan_projects(str(fake_projects))
    proj = next(p for p in projects if p.id == "projeto-claude")
    assert proj.cliente_id == "projeto-claude"


def test_scan_projects_populates_cliente_id_for_loose_root_project(tmp_path):
    """projeto_2 (projeto solto na raiz, sem "/"):
    cliente_id == "projeto_2"."""
    (tmp_path / "projeto_2" / ".claude").mkdir(parents=True)

    projects = scan_projects(str(tmp_path))
    proj = next(p for p in projects if p.id == "projeto_2")
    assert proj.cliente_id == "projeto_2"


# -- resolve_projeto_alvo (Tarefa 3: validação "mesmo cliente") --------------


def _proj(pid: str) -> Project:
    return Project(id=pid, nome=pid, path="/x/" + pid, cliente_id=cliente_id_from_projeto_id(pid))


_PROJECTS_FIXTURE = [
    _proj("cliente_projeto_1/subprojeto_1"),
    _proj("cliente_projeto_1/outro"),
    _proj("podesubir"),
]


def test_resolve_projeto_alvo_empty_returns_own():
    """projeto_id_pedido vazio/None -> projeto da conversa atual, sem consultar
    a lista de projetos."""
    assert resolve_projeto_alvo("cliente_projeto_1/subprojeto_1", None, _PROJECTS_FIXTURE) == "cliente_projeto_1/subprojeto_1"
    assert resolve_projeto_alvo("cliente_projeto_1/subprojeto_1", "", _PROJECTS_FIXTURE) == "cliente_projeto_1/subprojeto_1"


def test_resolve_projeto_alvo_same_cliente_returns_pedido():
    """Sub-projeto existente do MESMO cliente -> permitido."""
    assert resolve_projeto_alvo("cliente_projeto_1/subprojeto_1", "cliente_projeto_1/outro", _PROJECTS_FIXTURE) == "cliente_projeto_1/outro"


def test_resolve_projeto_alvo_nonexistent_raises():
    with pytest.raises(ValueError, match="não existe"):
        resolve_projeto_alvo("cliente_projeto_1/subprojeto_1", "cliente_projeto_1/fantasma", _PROJECTS_FIXTURE)


def test_resolve_projeto_alvo_other_cliente_raises():
    """Projeto existe mas é de outro cliente -> bloqueado (regra de segurança
    inegociável)."""
    with pytest.raises(ValueError, match="outro cliente"):
        resolve_projeto_alvo("cliente_projeto_1/subprojeto_1", "podesubir", _PROJECTS_FIXTURE)
