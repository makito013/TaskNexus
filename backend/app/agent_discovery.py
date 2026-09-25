"""Agent discovery module for scanning projects and their configurations."""

from __future__ import annotations

import os
from pathlib import Path
from app.models import Agent, Project


_EXCLUDED = {
    "node_modules", ".git", "keys", ".DS_Store",
    "__pycache__", ".venv", "dist", "build"
}


def cliente_id_from_projeto_id(projeto_id: str) -> str:
    """Deriva o cliente_id de um projeto_id — sempre o primeiro segmento
    antes da 1ª "/". Cobre os 3 formatos de projeto_id que existem hoje:
    cliente com múltiplos projetos ("cliente_projeto_1/subprojeto_1" ->
    "cliente_projeto_1"), cliente-como-projeto sem subpasta ("podesubir" ->
    "podesubir", já não tem "/" então o próprio id já é o cliente) e projeto
    solto na raiz ("projeto_2" -> "projeto_2", mesmo caso do anterior).
    Função pura, sem I/O — reaproveitada por CardStore.create()
    via card_store, e espelhada no frontend em utils/clientes.js.

    NOTA (design, não bug): derivar o cliente do 1º segmento do path é uma
    CONSTRAINT aceita e confirmada, não uma heurística frágil. A estrutura
    real de PROJECTS_ROOT foi validada em 2026-07-20 (ver CONTEXTO.md, seção
    "Estrutura real de PROJECTS_ROOT"): pastas de 1º nível = cliente,
    subpastas = projeto, com os dois casos degenerados (cliente-como-projeto
    e projeto solto na raiz) cobertos pelos exemplos acima. A regra de
    segurança "mesmo cliente" (resolve_projeto_alvo / hook_cards_create)
    depende dessa premissa de propósito."""
    return projeto_id.split("/")[0]


def resolve_projeto_alvo(
    own_projeto_id: str,
    projeto_id_pedido: str | None,
    projects: list[Project],
) -> str:
    """Resolve o projeto-alvo de uma criação (tarefa/card) feita por um agente
    que pode opcionalmente pedir um projeto diferente do da conversa atual.

    Regra de segurança (05-ARQUITETO.md / BDD): um agente só pode criar em
    outro projeto se for do MESMO cliente. Função pura, sem I/O — recebe a
    lista de `projects` já resolvida (scan_projects) pelo chamador em
    main.py. Vive aqui, ao lado de cliente_id_from_projeto_id, para NÃO
    precisar ser importada pelos adaptadores MCP (stdlib puro, sem acesso a
    app/); a validação roda só no backend FastAPI.

    - projeto_id_pedido vazio/None -> usa o projeto da conversa atual.
    - projeto_id_pedido inexistente -> ValueError.
    - projeto_id_pedido de outro cliente -> ValueError.
    - caso contrário -> retorna projeto_id_pedido.
    """
    if not projeto_id_pedido:
        return own_projeto_id
    existe = any(p.id == projeto_id_pedido for p in projects)
    if not existe:
        raise ValueError(f"Projeto '{projeto_id_pedido}' não existe")
    if cliente_id_from_projeto_id(projeto_id_pedido) != cliente_id_from_projeto_id(own_projeto_id):
        raise ValueError(f"Projeto '{projeto_id_pedido}' pertence a outro cliente")
    return projeto_id_pedido


def scan_projects(root: str, global_agents: list[Agent] | None = None) -> list[Project]:
    """
    Scan a directory tree and discover all projects, assigning the global
    agent list to every eligible one.

    A project is eligible (and thus gets `global_agents` attached as its
    `agentes`) when it has a .claude/, .gemini/ or .codex/ subdirectory — no
    more per-project agent configuration via .escritorio/agents.yaml, and no
    more auto-detected synthetic Claude/Gemini agents. The list of agents a user
    can start a chat with is managed exclusively via the Global Agent
    Registry (GlobalAgentStore, "criar agentes" tab) and applied uniformly to
    every eligible project.

    Args:
        root: Root directory path to scan
        global_agents: Agents from the Global Agent Registry, assigned as-is
            to every eligible project.

    Returns:
        List of Project objects sorted by ID
    """
    root_path = Path(root)
    global_agents = global_agents or []
    projects: dict[str, Project] = {}

    for dirpath, dirnames, filenames in os.walk(root_path):
        # Prune excluded dirs in-place (modifica dirnames para evitar descida)
        dirnames[:] = [d for d in dirnames if d not in _EXCLUDED and not d.startswith(".")]

        current = Path(dirpath)
        # Get relative path from root
        rel = current.relative_to(root_path)
        parts = rel.parts

        if len(parts) == 0:
            continue  # é o próprio root, não adiciona

        project_id = str(rel).replace(os.sep, "/")

        # Create project entry
        proj = Project(
            id=project_id,
            nome=current.name,
            path=str(current),
            cliente_id=cliente_id_from_projeto_id(project_id),
        )

        claude_path = current / ".claude"
        gemini_path = current / ".gemini"
        codex_path = current / ".codex"

        elegivel = claude_path.is_dir() or gemini_path.is_dir() or codex_path.is_dir()
        proj.elegivel = elegivel
        if elegivel:
            proj.agentes = list(global_agents)
            projects[project_id] = proj

    # Ensure all parent projects exist (even if they have no agents) to preserve directory tree hierarchy
    missing_parents = {}
    for pid in list(projects.keys()):
        parts = pid.split("/")
        for i in range(1, len(parts)):
            parent_id = "/".join(parts[:i])
            if parent_id not in projects and parent_id not in missing_parents:
                parent_path = root_path / parent_id
                missing_parents[parent_id] = Project(
                    id=parent_id,
                    nome=parent_path.name,
                    path=str(parent_path),
                    agentes=[],
                    sub_projetos=[],
                    cliente_id=cliente_id_from_projeto_id(parent_id),
                )
    projects.update(missing_parents)

    # Build sub_projetos relationships
    for pid, proj in projects.items():
        # Get parent project ID by removing the last component
        parts = pid.split("/")
        if len(parts) > 1:
            parent_id = "/".join(parts[:-1])
            if parent_id in projects:
                if pid not in projects[parent_id].sub_projetos:
                    projects[parent_id].sub_projetos.append(pid)

    return sorted(projects.values(), key=lambda p: p.id)
