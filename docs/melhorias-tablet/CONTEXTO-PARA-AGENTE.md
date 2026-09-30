# Contexto para o agente (leia primeiro numa janela nova)

> Este arquivo existe para que **qualquer agente, numa janela de contexto
> limpa**, entenda em poucos minutos o que já foi decidido e feito, e continue
> o trabalho sem precisar da conversa original. Se você é esse agente, leia
> este arquivo inteiro antes de qualquer outra coisa.

## 1. Quem pediu e como gosta de trabalhar

- **Usuário:** Bruno, dono do repositório `brunopodesubir/TaskNexus-adjustes`.
- **Idioma:** português do Brasil em tudo (docs, comentários, mensagens de commit).
- **Formato de documentação:** sempre **um `.md` e um `.html`** de cada
  documento. O HTML é gerado pelo `build_html.py` desta pasta.
- **Como ele usa o TaskNexus:** o backend roda no PC dele (Windows com
  `deploy.ps1`, e também macOS/Linux com `deploy.sh`), e ele acessa pelo
  **iPad** (Safari e PWA instalado), via Tailscale (`https://<host>.ts.net`).
- **Fluxo de trabalho combinado:** planejamento e documentação numa janela;
  desenvolvimento numa **janela de contexto limpa**. Quando ele pedir, o agente
  de planejamento entrega o **prompt de desenvolvimento** da fase. Não
  entregar nem executar a fase sem ele pedir.
- **Qualidade esperada:** trabalho de "equipe completa" (Design, UX, TL e
  Dev), documentação muito explicada, com imagens e diagramas, testes, e
  sem gambiarra.

## 2. O problema

O TaskNexus é um "escritório" web para conversar com agentes de IA (`claude`,
`codex`, `agy`, `cursor-agent`, shells) rodando no PC, mais Board (kanban) e
Tarefas. A conversa hoje é um **terminal real** (xterm.js ligado a um PTY por
WebSocket). No tablet isso é ruim:

- não dá para **clicar em links** nem em caminhos de arquivo;
- não dá para **selecionar e copiar** texto com o toque nativo (o xterm desenha em canvas);
- faltam Esc, Tab e Ctrl no teclado virtual;
- a tela se desorganiza ao girar o iPad;
- não há como **ver arquivos** `.md`/`.html`/código nem **baixá-los** para o tablet.

## 3. O que foi pedido

1. Visualizar arquivos `.html`, `.md` e de código, e baixá-los no tablet.
2. Trocar o terminal por um **chat estilo WhatsApp** (links, blocos de código,
   markdown como no GitHub).
3. Um layout mais amigável.
4. Outras melhorias que a equipe enxergar.
5. **Ajuste posterior (mais recente, tem prioridade):** como não dá para
   clicar em links no terminal, a primeira entrega é o **próprio agente fazer o
   arquivo aparecer na tela**. Cada abertura vira **uma aba nova**, num
   visualizador em **dropdown** com botão de **tela cheia** (modal na página
   com botão de fechar). Isso virou a **Fase V**.
6. **Ajuste seguinte:** uma aba **Artefatos**, "igual à do Claude", organizada
   **por cliente e projeto**, com os artefatos criados (`.md`, `.pdf`, `.html`).
   Tocar num artefato abre o **painel lateral de visualização**. **Sem mexer no
   layout:** tudo em cima do layout v2 atual. Isso virou a **Fase A**.
7. **Ajuste seguinte:** liberar espaço no desktop/tablet. Ao selecionar um
   cliente, **a própria lista de clientes da sidebar vira a lista de projetos**
   dele, com seta/botão para **voltar aos clientes**, sobrando o **lado
   direito** para o visualizador (o "dropdown"). Isso virou a **Fase N**.

## 4. Onde está cada coisa (esta pasta)

| Arquivo | Para quê |
|---------|----------|
| `README.md` | Índice |
| `00-visao-geral-e-diagnostico.md` | Arquitetura atual, causa raiz, decisões e alternativas descartadas |
| `01-visualizador-de-arquivos.md` | Visualizador. A seção 1.0 resume a Fase V; o resto é o navegador de arquivos completo (fase F1) |
| `02-chat-conversacional.md` | Chat estruturado via `claude -p --input-format stream-json --output-format stream-json`, aprovações por tool MCP, protocolo `/ws/chat`, banco `chat_events` |
| `03-layout-amigavel.md` | Tokens, layouts por largura, rotas reais, lista estilo WhatsApp, ⌘K, acessibilidade |
| `04-melhorias-adicionais.md` | 14 melhorias (4.1 autenticação é obrigatória antes do navegador completo) |
| `05-plano-de-execucao-e-prompts.md` | Fases FV, F0–F4 e prompts das fases F0–F4 |
| `06-planejamento-fase-v.md` | **Plano de desenvolvimento da Fase V (segunda a executar)** |
| `08-planejamento-navegacao-cliente-projeto.md` | **Plano da Fase N (sidebar clientes → projetos + espaço à direita), a primeira a executar** |
| `07-planejamento-artefatos.md` | **Plano de desenvolvimento da Fase A (aba Artefatos), logo depois da V** |
| `documentacao-completa.md` / `.html` | Todas as partes num arquivo só |
| `img/*.svg` | Diagramas e mockups (01–11) |
| `build_html.py` | Gera os HTML e o `documentacao-completa.md`: `pip install markdown pygments pymdown-extensions && python3 docs/melhorias-tablet/build_html.py` |

## 5. Decisões já tomadas (não reabrir sem o Bruno pedir)

| Tema | Decisão |
|------|---------|
| Ordem | **FN** (sidebar cliente → projeto) → **FV** (agente abre arquivo) → **FA** (aba Artefatos) → **F0** (auth + routers + restante dos quick wins) → **F1** (navegador de arquivos) e **F2** (chat claude) → **F3** (layout v3) → **F4** (codex + extras) |
| Como o agente mostra arquivo | Tool MCP `abrir_no_visualizador(caminho, titulo?, linha?)` num servidor novo `escritorio-visualizador`, registrado em `_escritorio_mcp_servers()` (vale para `claude` e `codex`) |
| Como a tela fica sabendo | Frame de controle `{"type":"viewer_open",…}` no WebSocket `/ws/pty/{session_key}` já existente, com abas persistidas na tabela `viewer_items` |
| "Aba nova" | Aba **dentro do visualizador** (não do navegador); o mesmo arquivo reaproveita a aba e recarrega (interpretação a confirmar com o Bruno; alternativa trivial documentada na Parte 6) |
| Tela cheia | Modal em portal (`document.body`), mesmo contrato do `CenteredModal.jsx`, com ✕ Fechar e Esc; no celular abre sempre em tela cheia |
| Segurança do visualizador | Rotas por `item_id` aleatório, `resolve_safe_path` (realpath + commonpath), denylist de segredos, HTML em `iframe sandbox` sem `allow-same-origin` + CSP `sandbox` |
| Artefatos | Tabela `artifacts` única por (projeto, caminho); tool `publicar_artefato` no servidor `escritorio-visualizador`; `abrir_no_visualizador` de `.md`/`.html`/`.pdf` publica automaticamente; remover da lista não apaga o arquivo; tela nova `artefatos` em `NAV_ITEMS` do `AppV2`, com `ClienteProjetoFilterBar`; o visualizador é o mesmo painel à direita do chat |
| Navegação | Drill-down no `ClienteList` (Clientes → Projetos → subprojetos, com **← voltar**); escopo global `useNavScope` (cliente + projeto, salvo em `localStorage`) filtra Chat, Board, Tarefas e Artefatos; cliente sem subprojetos só é selecionado; `ClienteProjetoFilterBar` **continua** no Board (principalmente em "Todos"), Tarefas e Artefatos, partindo da sidebar e agindo só na tela (decisão do Bruno) |
| Visualizador | Abre **à direita**: encaixado (`ViewerDock`) em ≥ 1100 px com a sidebar e a lista de chats recolhidas automaticamente **só enquanto aberto** (sem gravar a preferência; se o usuário expandir com o painel aberto, fica expandida; ao fechar, volta tudo como estava), por cima (`ViewerDrawer`) em 641–1099 px, tela cheia no celular. Onde as Partes 6/7 dizem "dropdown", é esse painel |
| Layout | **Não mexer no layout agora.** Fases V e A entram em cima do v2 atual; o layout v3 (Parte 3) fica para depois |
| Autenticação | Obrigatória antes do navegador de arquivos livre (F1); a FV pode vir antes por ter superfície limitada |
| Chat estruturado | Modo headless oficial do `claude` (flags verificadas na 2.1.x); aprovações por `--permission-prompt-tool` apontando para uma tool MCP nossa; **não** usar o SDK Python do Claude porque o backend roda em **Python 3.9.6** (SDK exige 3.10+) |
| Terminal | Continua existindo como "modo Terminal"; nunca rodar TUI e modo JSON ao mesmo tempo na mesma sessão |
| Stack | Sem TypeScript, sem biblioteca de UI/CSS, tokens `--v2-*` de `frontend/src/layouts/v2/theme.css`, fontes Figtree e IBM Plex Mono self-hosted |

## 6. Mapa do código que importa

| Área | Arquivo | Observação |
|------|---------|------------|
| Rotas, WebSocket do PTY, hooks, spawn dos CLIs | `backend/app/main.py` (~2.950 linhas) | `pty_endpoint`, `_active_connections`, `_ensure_pty`, `_escritorio_mcp_servers`, `_build_mcp_config_json`, `_build_codex_config_overrides`, `_hook_callback_base_url`, `_resolve_project_or_404`, hooks `/api/hooks/*` |
| Processo PTY | `backend/app/pty_manager.py` | `snapshot()`, `_schedule_reap` (SIGTERM → SIGKILL) |
| Id de conversa ↔ session_key | `backend/app/conversation_store.py` | `get_session_key_by_claude_id` |
| Modelo de adapter MCP | `backend/app/mcp_card_adapter.py`, `mcp_task_adapter.py` | stdio JSON-RPC, stdlib, Python 3.9 |
| Contenção de caminho existente | `backend/app/attachments.py` | `_is_within_directory` |
| Terminal no navegador | `frontend/src/components/TerminalPanel.jsx` | `CONTROL_FRAME_TYPES`, `isControlFrame`, `ws.onmessage` |
| Estado das sessões | `frontend/src/components/TerminalContext.jsx` | `TerminalProvider`, `useTerminal` |
| Casco do layout v2 | `frontend/src/layouts/v2/AppV2.jsx` | `NAV_ITEMS`, `SCREEN_TITLES`, `v2Screen`; topbar com `AttachmentsMenu` e `ResetLayoutButton` (guarda `!isMobile && v2Screen === 'chat'`) |
| Filtro cliente/projeto | `layouts/v2/useClienteProjetoFilter.js`, `ClienteProjetoFilterBar.jsx`, `utils/clientes.js` | usado por `BoardV2` e `TarefasV2`; subárvore por prefixo (`collectSubtreeIds`) |
| Drawer lateral existente | `frontend/src/components/TasksDrawer.jsx` | padrão para o `ViewerDrawer` da Fase A |
| Padrão de popover | `frontend/src/layouts/v2/AttachmentsMenu.jsx`, `TaskQuickCreatePopover.jsx` | scrim, Esc, clique fora |
| Padrão de modal | `frontend/src/layouts/v2/CenteredModal.jsx` | portal; invariante em `fixedPositioningInvariant.test.js` |
| Markdown | `frontend/src/utils/markdown.js` | `marked` + `DOMPurify` |
| Copiar | `frontend/src/utils/clipboard.js` | `copyTextToClipboard` |
| Testes | `backend/tests/` (pytest), `frontend/src/**/*.test.js(x)` (vitest) | `cd backend && .venv/bin/pytest`; `cd frontend && npm test` |

## 7. Estado atual

- **Branch de trabalho da documentação:** `claude/elegant-carson-ehd59f`
  (a pasta `docs/melhorias-tablet/` foi liberada no `.gitignore`, que ignora `docs/*` por padrão).
- **Código:** a **Fase N** foi implementada (frontend só) na branch
  `claude/elegant-carson-ehd59f`: drill-down cliente → projeto no `ClienteList`,
  escopo global `useNavScope`, filtro por projeto no Chat/Board/Tarefas e o
  recolhimento automático pronto em `useViewerDockCollapse` (com `viewerOpen`
  sempre `false` no `AppV2` até a Fase V ligar). O que divergiu do plano e os
  pontos de integração estão na seção **8.7** da Parte 8.
- **Próxima ação:** quando o Bruno pedir, entregar o prompt de desenvolvimento
  da **Fase V** (`06-planejamento-fase-v.md`) e depois o da **Fase A**
  (`07-planejamento-artefatos.md`), para ele usar numa janela limpa. A Fase V
  liga `setViewerOpen` no `AppV2` (ver 8.7). O desenvolvimento deve acontecer
  numa branch própria (a que a sessão de desenvolvimento indicar), com um PR
  para a fase.

## 8. Regras para quem for desenvolver

1. Ler este arquivo, o `README.md` do projeto, a parte da fase e o código citado antes de escrever qualquer coisa.
2. Python **3.9** no backend (sem `match`, sem `X | Y` fora de `from __future__ import annotations`).
3. Nunca `shell=True`. Todo caminho vindo de cliente ou agente passa por `resolve_safe_path`.
4. Testes para todo código novo; `pytest` e `npm test` verdes a cada commit.
5. Não quebrar: modo Terminal, Board, Tarefas, push, `deploy.sh`, `deploy.ps1`.
6. Comentários explicam o **porquê**, em português, no estilo do código existente.
7. Se o código real divergir da documentação, seguir o código e **atualizar a doc** no mesmo PR (e regenerar os HTML com `build_html.py`).
8. Commits pequenos, um PR por fase, com checklist de aceite manual no iPad.
