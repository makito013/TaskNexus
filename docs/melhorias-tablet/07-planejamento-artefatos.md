# Parte 7 — Planejamento da Fase A: aba Artefatos por cliente e projeto

> **O pedido:** uma aba **Artefatos**, como a galeria de artefatos do Claude,
> organizada **por cliente e projeto**, listando os artefatos criados
> (`.md`, `.pdf`, `.html`). Ao tocar num artefato, ele abre no **painel
> lateral de visualização de arquivo**. **Sem mexer no layout:** tudo em cima
> do layout v2 atual.
>
> **Depende da Fase V** ([Parte 6](06-planejamento-fase-v.md)): reaproveita o
> `file_access.py`, os renderers (Markdown, HTML, código, PDF, binário), o
> `ViewerContext` e o `ViewerPanel`. Pode ser o PR seguinte ao da Fase V.

![Tela Artefatos](img/12-mockup-artefatos.svg)

Legenda: **A** item novo **Artefatos** no menu que já existe (mesma lista
`NAV_ITEMS` de Chat, Board, Tarefas e Configuração) · **B** painel lateral
de visualização, por cima da tela e com abas, com os botões Baixar, Copiar,
Abrir no navegador, **Tela cheia** e **✕ Fechar**.

---

## 7.1 Requisitos

| # | Requisito | Origem |
|---|-----------|--------|
| A1 | Nova aba **Artefatos** no menu do layout atual | Bruno |
| A2 | Organizada por **cliente** e **projeto**, usando o mesmo filtro das telas Board e Tarefas | Bruno |
| A3 | Lista os artefatos criados: **`.md`, `.pdf`, `.html`** | Bruno |
| A4 | Tocar num artefato abre o **painel lateral de visualização** | Bruno |
| A5 | **Não mudar o layout**: nada de redesenho, só uma tela nova no casco v2 | Bruno |
| A6 | Artefato não some quando a conversa acaba: a lista é permanente por projeto | Equipe (é o que faz a galeria ser útil) |
| A7 | Remover da lista **não apaga** o arquivo do disco | Equipe (segurança) |

### Interpretações adotadas (confirmar)

| Ponto | Adotado | Alternativa |
|-------|---------|-------------|
| O que vira artefato | (1) O agente publica com a tool nova `publicar_artefato`. (2) Todo `.md`/`.html`/`.pdf` que o agente abre com `abrir_no_visualizador` entra **automaticamente**. (3) Você adiciona à mão ("Salvar em Artefatos" no visualizador ou "Importar do projeto") | Só a publicação explícita (desligar o item 2 com um parâmetro) |
| "Painel lateral" | O **mesmo painel à direita** do chat (Fase V + Fase N): encaixado em telas ≥ 1100 px (a sidebar vira trilho enquanto ele está aberto), por cima em 641–1099 px, tela cheia no celular | — (decidido com a Parte 8) |
| Tela cheia no painel lateral | Mantida: o botão ⤢ vira o mesmo modal de tela cheia da Fase V | — |
| Celular | Abre direto em tela cheia (não há largura para drawer) | — |
| Outros tipos (imagem, `.docx`, `.csv`) | Fora por enquanto; a tabela aceita qualquer `kind`, então dá para ampliar depois | Incluir imagens já |

---

## 7.2 Experiência de uso (UX)

### Onde fica

- Menu lateral (`SidebarV2`) e menu do celular (`MobileMenuScreen`) ganham
  o item **◧ Artefatos**, entre Tarefas e Configuração. É só uma entrada a mais
  em `NAV_ITEMS`; a sidebar, a topbar e a lista de clientes continuam iguais.
- Título da topbar: "Artefatos".
- **Cliente e projeto vêm da sidebar** (Fase N, [Parte 8](08-planejamento-navegacao-cliente-projeto.md)):
  a lista de clientes vira a lista de projetos do cliente, com **← Clientes**
  para voltar. A tela **mantém a barra de selects** (`ClienteProjetoFilterBar`,
  igual ao Board e a Tarefas), partindo da seleção da sidebar e agindo só na
  tela; ao lado dela ficam os chips de tipo e a busca (Parte 8, item 5 de 8.2.1).

### A tela

1. **Barra de filtro** (mesma linha do filtro de cliente/projeto): chips de
   tipo **Todos · MD · HTML · PDF**, campo **Buscar** (título, caminho e
   descrição) e ordenação **Recentes / Nome**.
2. **Lista agrupada:** um grupo por projeto com o rótulo
   `CLIENTE / PROJETO · N`. Com um projeto específico escolhido, os grupos somem
   e fica só a grade.
3. **Cartão do artefato** (mesma linguagem visual do Board, tokens `--v2-*`):
   - selo do tipo (MD verde, HTML índigo, PDF avermelhado);
   - título (do agente, ou o primeiro `# título` do `.md`, ou o `<title>` do
     HTML, ou o nome do arquivo);
   - caminho relativo ao projeto;
   - trecho de até 2 linhas (1º parágrafo do `.md`, `meta description` do HTML,
     "N páginas" do PDF quando der para ler, senão nada);
   - rodapé: quem criou (claude, codex, você) · quando · tamanho.
4. **Tocar no cartão** abre o painel lateral com o artefato numa aba (ou foca
   a aba, se já estiver aberto). Tocar em outro cartão abre **outra aba** no
   mesmo painel.
5. **Menu "⋯" do cartão** (ou toque longo): Abrir · Baixar · Copiar caminho ·
   **Citar no chat** (cola o caminho no terminal da conversa ativa, com o
   mesmo `POST /api/sessions/{sk}/paste` do "Usar no chat" dos Anexos) ·
   Renomear · **Remover da lista** (confirmação de 2 toques, como nos Anexos).
6. **Importar do projeto…** (fim da lista): abre um modal (`CenteredModal`)
   com os `.md`/`.html`/`.pdf` encontrados no projeto escolhido que ainda não
   são artefatos, com caixas de seleção. Serve para trazer o que já existe hoje.

### Estados

| Estado | O que aparece |
|--------|---------------|
| Nenhum artefato no filtro | "Nenhum artefato aqui ainda. Quando um agente criar um relatório, documento ou PDF, ele aparece nesta tela. Você também pode **Importar do projeto**." |
| Carregando | 6 cartões esqueleto |
| Arquivo apagado ou movido | Cartão com borda tracejada e selo "arquivo não encontrado"; abrir mostra o aviso; ações: Remover da lista |
| Arquivo alterado depois de publicado | Data "atualizado há X" (usa o `mtime` real) |
| Erro ao carregar | "Não consegui carregar os artefatos. Tentar de novo" |

### Painel lateral

- Painel à direita, igual ao do chat: **encaixado** em telas ≥ 1100 px (a
  grade de cartões encolhe e a sidebar vira trilho enquanto ele está aberto),
  **por cima** da lista em 641–1099 px, **tela cheia** no celular.
- Cabeçalho: abas dos artefatos abertos · **✕ Fechar**. Barra: caminho,
  tamanho, ⤓ Baixar, ⧉ Copiar, ↗ Abrir no navegador, **⤢ Tela cheia**.
- Fecha com ✕, com Esc ou tocando na faixa escurecida. As abas continuam
  guardadas para quando reabrir.
- Conteúdo: o mesmo `ViewerPanel` da Fase V (Markdown como no GitHub, HTML em
  `iframe` sandbox, PDF, código).

---

## 7.3 Arquitetura (TL)

| Decisão | Escolha | Por quê |
|---------|---------|---------|
| Onde guardar | Tabela nova `artifacts` no `sessions.db`, **um registro por (projeto, caminho)** | A galeria é permanente e por projeto; não pode depender da sessão nem do limite de 15 abas do visualizador |
| Como o agente publica | Tool `publicar_artefato` no **mesmo servidor MCP** `escritorio-visualizador` da Fase V | Um processo a menos, e a mesma rota de callback |
| Publicação automática | `abrir_no_visualizador` de `.md`/`.html`/`.pdf` faz upsert em `artifacts` | É exatamente o que o agente mostra como entregável; evita depender do agente lembrar de duas tools |
| Como servir o arquivo | Rotas por `artifact_id` (`/api/artifacts/{id}/content` e `/f/{caminho}`) sobre um módulo comum `file_serving.py`, **o mesmo** usado pelas rotas `/api/viewer/{item_id}/…` | Uma única implementação de CSP, download, limite de 1 MB e denylist |
| Visualizador no front | `ViewerContext` ganha **escopos**: `session:<session_key>` (chat, Fase V) e `artefatos` (esta tela). Cada item diz sua **origem** (`viewer` ou `artifact`), e o `viewerApi` monta a URL certa | O `ViewerPanel` e os renderers ficam iguais; só muda de onde vem o arquivo |
| Contêiner lateral | Os mesmos `ViewerDock`/`ViewerDrawer`/`ViewerFullscreen` da Fase V, escolhidos pela largura | Um único comportamento de visualizador no app inteiro |
| Segurança | Mesmas regras da Fase V: `resolve_safe_path`, denylist, `iframe` sem `allow-same-origin`, CSP `sandbox`, ids aleatórios | A galeria não amplia o que pode ser lido: só arquivos registrados + vizinhos do mesmo projeto |

**Ajuste na Fase V:** as funções de servir conteúdo (`content` e `f/`) devem nascer num módulo
`backend/app/file_serving.py` recebendo `(project_root, rel_path, download)`,
para esta fase reaproveitar sem copiar. A Parte 6 foi atualizada com essa nota.

---

## 7.4 Backend (Dev)

### 7.4.1 Arquivos

```
backend/app/artifact_store.py          # NOVO: ArtifactStore (tabela artifacts)
backend/app/artifacts_api.py           # NOVO: APIRouter das rotas 7.4.3
backend/app/artifact_meta.py           # NOVO: título, trecho e páginas (md/html/pdf), só stdlib
backend/app/file_serving.py            # criado na Fase V; aqui só é reaproveitado
backend/app/mcp_viewer_adapter.py      # ALTERAR: + tool publicar_artefato
backend/app/viewer_api.py              # ALTERAR: abrir_no_visualizador faz upsert em artifacts (md/html/pdf)
backend/app/main.py                    # ALTERAR: iniciar ArtifactStore no lifespan, include_router,
                                       #          + env ESCRITORIO_HOOK_ARTIFACT_PUBLISH_URL no servidor MCP
backend/tests/test_artifact_store.py
backend/tests/test_artifacts_endpoints.py
backend/tests/test_artifact_meta.py
backend/tests/test_mcp_viewer_adapter.py   # ALTERAR: casos da tool nova
```

### 7.4.2 Tabela

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id  TEXT PRIMARY KEY,          -- "af_" + token_urlsafe(16)
  project_id   TEXT NOT NULL,             -- ex.: "podesubir/site-institucional"
  cliente_id   TEXT NOT NULL,             -- 1º segmento do project_id (mesma regra de agent_discovery)
  path         TEXT NOT NULL,             -- relativo à raiz do projeto, com "/"
  kind         TEXT NOT NULL,             -- markdown | html | pdf
  title        TEXT NOT NULL,
  description  TEXT,
  excerpt      TEXT,                      -- até 200 caracteres
  size         INTEGER,
  mtime        REAL,
  created_by   TEXT NOT NULL,             -- 'agent' | 'user'
  agent_label  TEXT,                      -- "claude", "codex"… (do agente da sessão)
  session_key  TEXT,                      -- sessão que criou (pode ficar órfã; é só informativo)
  created_at   REAL NOT NULL,
  updated_at   REAL NOT NULL,
  UNIQUE(project_id, path)
);
CREATE INDEX IF NOT EXISTS ix_artifacts_cliente ON artifacts(cliente_id, updated_at);
```

Mesmo padrão de store dos outros: `aiosqlite`, WAL, `busy_timeout=5000`.
**Upsert** por `(project_id, path)`: publicar de novo o mesmo arquivo atualiza
título (se veio), descrição, trecho, tamanho, `mtime` e `updated_at`, e mantém o `artifact_id`.

### 7.4.3 Rotas

| Rota | Uso | Resposta |
|------|-----|----------|
| `GET /api/artifacts?cliente_id=&projeto_id=&tipo=&q=&ordem=recentes` | lista da tela | `{"artifacts":[Artifact…]}`; `projeto_id` inclui a subárvore (prefixo `projeto_id/`, mesma regra do `collectSubtreeIds` do front); cada item traz `exists` e `mtime` atuais (checagem em lote com `os.stat` em thread) |
| `GET /api/artifacts/{id}` | um artefato | `Artifact` |
| `POST /api/artifacts` | você adiciona | corpo `{"project_id","caminho","titulo"?,"descricao"?}` → `Artifact` (201) ou 400/403/404 com mensagem |
| `POST /api/artifacts/import` | "Importar do projeto" | corpo `{"project_id","caminhos":[…]}` → `{"created":n,"artifacts":[…],"errors":[{caminho,erro}]}` |
| `GET /api/projects/{project_id:path}/artifact-candidates` | lista do modal de importação | `{"candidates":[{"path","kind","size","mtime"}],"truncated":bool}`: até 300 arquivos `.md`/`.html`/`.htm`/`.pdf`, ignorando as mesmas pastas da Parte 1 (`.git`, `node_modules`, `.venv*`, `dist`, `build`, `.escritorio`…) e os que já são artefatos |
| `PATCH /api/artifacts/{id}` | renomear / descrição | `{"titulo"?,"descricao"?}` → `Artifact` |
| `DELETE /api/artifacts/{id}` | remover da lista | `{"status":"removed"}`; **não** apaga o arquivo |
| `GET /api/artifacts/{id}/content` | conteúdo para o painel | igual ao `/api/viewer/{item_id}/content` (via `file_serving`) |
| `GET /api/artifacts/{id}/f/{file_path:path}[?download=1]` | HTML, PDF, assets relativos, download | igual ao `/api/viewer/{item_id}/f/…` (via `file_serving`) |
| `POST /api/hooks/artifacts/publish` | só o adapter MCP (loopback) | corpo `{"claude_session_id","caminho","titulo"?,"descricao"?,"abrir"?}` → `{"success":true,"artifact":{…},"opened":bool}` ou `{"success":false,"error":"…"}` |

Formato de `Artifact`:

```json
{
  "artifact_id": "af_Qm1Y0oHq3a1bXw5Jc2k0q8",
  "project_id": "podesubir/site-institucional",
  "cliente_id": "podesubir",
  "path": "docs/relatorio.html",
  "kind": "html",
  "title": "Relatório de testes",
  "description": null,
  "excerpt": "58 passaram, 2 falharam…",
  "size": 18432,
  "mtime": 1727650000.1,
  "exists": true,
  "created_by": "agent",
  "agent_label": "claude",
  "created_at": 1727650000.2,
  "updated_at": 1727650000.2
}
```

Regras:

- Tipos aceitos: `.md`, `.markdown`, `.html`, `.htm`, `.pdf`. Outro tipo → erro
  legível ("Artefatos aceitam .md, .html e .pdf").
- `caminho` passa por `resolve_safe_path` (Fase V) e pela denylist.
- `publicar_artefato` com `abrir=true` (padrão) também cria/foca a aba no
  visualizador da sessão, reaproveitando a lógica do `abrir_no_visualizador`
  (inclui o frame `viewer_open`).
- `agent_label`: do agente resolvido pela `session_key` (`agent.ia` ou nome
  do cadastro); para `created_by='user'`, `null`.

### 7.4.4 `artifact_meta.py` (só biblioteca padrão)

- **Markdown:** título = primeira linha `# …`; trecho = primeiro parágrafo
  de texto (sem markdown básico: `*`, `_`, `` ` ``, links `[x](y)` → `x`), até 200 caracteres.
- **HTML:** título = conteúdo de `<title>`; trecho = `<meta name="description">`
  ou o texto do primeiro `<p>` (`html.parser` da stdlib), sem executar nada.
- **PDF:** título = nome do arquivo; "N páginas" contando `/Type /Page` (não
  `/Pages`) nos bytes, **só se** o arquivo tiver até 20 MB; senão, sem trecho.
  É heurística: se falhar, fica sem trecho, nunca dá erro.
- Ler no máximo 256 KB de cada arquivo para extrair metadados.

### 7.4.5 Tool MCP `publicar_artefato`

```json
{
  "name": "publicar_artefato",
  "description": "Publica um arquivo como ARTEFATO do projeto na aba Artefatos do TaskNexus (organizada por cliente e projeto) e, por padrão, abre no visualizador do usuário. Use ao terminar um entregável que o usuário vai querer reencontrar depois: relatórios e páginas .html, documentos, planos e especificações .md, e arquivos .pdf. Se o arquivo já foi publicado, as informações são atualizadas. Arquivos .md, .html e .pdf abertos com abrir_no_visualizador também são publicados automaticamente.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "caminho":   {"type": "string", "description": "Caminho do arquivo .md, .html ou .pdf, relativo à raiz do projeto ou absoluto dentro dele."},
      "titulo":    {"type": "string", "description": "Opcional. Título do artefato. Padrão: título do documento ou nome do arquivo."},
      "descricao": {"type": "string", "description": "Opcional. Uma frase dizendo o que é o artefato."},
      "abrir":     {"type": "boolean", "description": "Opcional. Abre no visualizador do usuário. Padrão: true."}
    },
    "required": ["caminho"]
  }
}
```

Respostas em texto para o agente: `Artefato publicado em Artefatos › podesubir / site-institucional: "Relatório de testes" (docs/relatorio.html).`,
`… (já existia, foi atualizado).` ou a mensagem de erro do backend.

---

## 7.5 Frontend (Dev)

### 7.5.1 Arquivos

```
frontend/src/features/artifacts/
  ArtefatosV2.jsx          # a tela: filtro cliente/projeto + chips + busca + grade/grupos + importar
  ArtifactCard.jsx         # cartão (selo de tipo, título, caminho, trecho, rodapé, menu ⋯)
  ArtifactActionsMenu.jsx  # Abrir, Baixar, Copiar caminho, Citar no chat, Renomear, Remover (2 toques)
  ImportArtifactsModal.jsx # CenteredModal com a lista de candidatos e caixas de seleção
  useArtifacts.js          # busca, filtros, recarga ao focar a tela e ao chegar viewer_open de md/html/pdf
  artifactsApi.js
frontend/src/features/viewer/
  ViewerDock.jsx / ViewerDrawer.jsx   # já existem (Fase V); aqui só recebem scope="artefatos"
  ViewerContext.jsx        # ALTERAR: escopos (session:<sk> e 'artefatos') e item.source ('viewer'|'artifact')
  viewerApi.js             # ALTERAR: URLs por origem
  ViewerToolbar.jsx        # ALTERAR: "☆ Salvar em Artefatos" quando o item veio do chat e ainda não é artefato
frontend/src/layouts/v2/AppV2.jsx   # ALTERAR: NAV_ITEMS + SCREEN_TITLES + render de ArtefatosV2
```

### 7.5.2 Integração no `AppV2` (só isto muda no casco)

```js
const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'board', label: 'Board', icon: '▦' },
  { id: 'tarefas', label: 'Tarefas', icon: '✓' },
  { id: 'artefatos', label: 'Artefatos', icon: '◧' },   // novo
  { id: 'agentes', label: 'Configuração', icon: '◈' },
];
const SCREEN_TITLES = { chat: 'Chat', board: 'Board', tarefas: 'Tarefas', artefatos: 'Artefatos', agentes: 'Configuração' };

{v2Screen === 'artefatos' && (
  <ArtefatosV2 projects={projects} selectedClienteId={selectedClienteId} activeSessionKey={activeSessionKey} />
)}
```

Mesmas props que `BoardV2` e `TarefasV2` recebem. `MobileMenuScreen` já
recebe `NAV_ITEMS`, então o item aparece no celular sem mudança extra.
Conferir testes que contam itens de navegação (`AppV2.test.jsx`,
`SidebarV2.test.jsx`, `MobileMenuScreen.test.jsx`, `NavTabs`) e atualizar.

### 7.5.3 Filtro

Usar `useClienteProjetoFilter(projects, selectedClienteId, selectedProjetoId)` e
`ClienteProjetoFilterBar` exatamente como `BoardV2`/`TarefasV2` depois da Fase N. A filtragem
por subárvore do projeto pode ser feita no backend (`projeto_id`) ou no front
com `collectSubtreeIds`; escolher **uma** e testar o caso de 3 níveis
(`cliente/projeto/sub`), que já quebrou no Board.

### 7.5.4 Painel lateral

- Mesmo painel da Fase V, escolhido pela largura: `ViewerDock` (≥ 1100 px,
  com recolhimento forçado da sidebar, Parte 8), `ViewerDrawer` (641–1099 px)
  ou `ViewerFullscreen` (celular), sempre com `scope="artefatos"`.
- **⤢ Tela cheia** usa o `ViewerFullscreen`; **✕ Fechar** e Esc fecham o painel.
- Tocar num cartão: `openArtifact(artifact)` → adiciona/foca a aba no escopo
  `artefatos` e abre o painel.
- As abas do escopo `artefatos` ficam **só no front** (não precisam de
  tabela): até 15, guardadas em `sessionStorage` para sobreviver a recarregar
  a página.

### 7.5.5 Atualização da lista

- Ao entrar na tela e ao voltar o foco para a aba do navegador.
- Quando chegar um frame `viewer_open` de `.md`/`.html`/`.pdf` (qualquer
  sessão): marca a lista como "desatualizada" e recarrega se a tela estiver aberta.
- Sem polling contínuo.

---

## 7.6 Ordem de execução (um commit por passo)

| Passo | Entrega | Verificação |
|-------|---------|-------------|
| 1 | `artifact_meta.py` + testes | `pytest tests/test_artifact_meta.py` |
| 2 | `ArtifactStore` + rotas de lista, criação, edição, remoção, conteúdo e arquivo (via `file_serving`) | `pytest tests/test_artifact_store.py tests/test_artifacts_endpoints.py` |
| 3 | Candidatos + importação | testes de endpoint |
| 4 | Tool `publicar_artefato` + publicação automática no `abrir_no_visualizador` | `pytest tests/test_mcp_viewer_adapter.py tests/test_viewer_endpoints.py` |
| 5 | `ViewerContext` com escopos; painel com `scope="artefatos"` | vitest |
| 6 | `ArtefatosV2` + cartão + filtros + estados + item de menu | vitest + testes de navegação atualizados |
| 7 | Menu do cartão (baixar, copiar, citar no chat, renomear, remover) e "Salvar em Artefatos" no visualizador | vitest |
| 8 | Modal "Importar do projeto" | vitest |
| 9 | Aceite manual no iPad e atualização da doc | checklist 7.7 |

---

## 7.7 Testes e aceite

### Backend

- Upsert por `(project_id, path)` mantém o `artifact_id` e atualiza os campos.
- Filtros: `cliente_id`; `projeto_id` com subárvore de 3 níveis; `tipo`; `q`
  em título, caminho e descrição; ordem.
- `exists:false` quando o arquivo some; `DELETE` não apaga o arquivo.
- Tipos não aceitos, caminho fora do projeto e denylist → erro legível.
- Candidatos ignoram `node_modules`/`.git`/etc., os já publicados, e cortam em 300.
- `publicar_artefato` via hook: sessão inexistente, sucesso com `abrir=true`
  (gera frame `viewer_open`) e `abrir=false`.
- `abrir_no_visualizador` de `.md` cria artefato; de `.py` não cria.
- `artifact_meta`: título e trecho de `.md` e `.html`; PDF com e sem contagem de páginas.

### Frontend

- `ArtefatosV2`: agrupa por projeto com "Todos os projetos"; mostra grade
  simples com projeto escolhido; chips de tipo filtram; busca filtra; estado vazio.
- Cartão com `exists:false` mostra o selo e a borda tracejada.
- Tocar no cartão abre o painel à direita com a aba; tocar em outro abre a segunda aba.
- Remover exige 2 toques e chama `DELETE`.
- Item "Artefatos" aparece na sidebar e no menu do celular.

### Aceite manual (iPad)

1. Pedir ao claude: "gere um relatório HTML dos testes e publique como artefato".
   Ele aparece em Artefatos › cliente › projeto e abre no visualizador.
2. Escolher outro cliente na sidebar: a lista muda. Entrar no cliente e escolher
   um projeto na sidebar: só aquele projeto (e subprojetos).
3. Tocar em dois cartões: painel lateral com duas abas; ⤢ Tela cheia e ✕ Fechar funcionam.
4. Abrir um PDF: aparece no painel (ou, se o Safari do iPad não renderizar
   bem dentro do painel, o botão ↗ abre no leitor nativo e ⤓ baixa. Registrar o resultado no PR).
5. "Importar do projeto…" traz um `.md` antigo.
6. Apagar o arquivo no disco: o cartão mostra "arquivo não encontrado".
7. "Citar no chat" cola o caminho no terminal da conversa ativa sem enviar.
8. No celular: item no menu, lista em uma coluna, abrir vai para tela cheia.

---

## 7.8 Riscos

| Risco | Mitigação |
|-------|-----------|
| Lista poluída por arquivos que o agente só abriu para mostrar (ex.: `README.md`) | "Remover da lista" com 2 toques; se incomodar, desligar a publicação automática e deixar só `publicar_artefato` |
| PDF dentro de `iframe` no Safari do iPad às vezes mostra só a primeira página | Botões ↗ (leitor nativo) e ⤓ sempre visíveis; se necessário, usar pdf.js numa fase futura |
| Muitos artefatos (centenas) | Paginação simples no endpoint (`limit`/`offset`, 100 por página) se passar de 300 |
| Sem autenticação ainda | Mesma superfície da Fase V (arquivos registrados + vizinhos do projeto, com denylist); a F0 fecha o resto |

---

## 7.9 Definição de pronto

- [ ] `pytest` e `npm test` verdes, com os testes novos.
- [ ] Nenhuma mudança visual fora da tela nova, do item de menu e do painel lateral.
- [ ] Aceite manual 7.7 conferido (itens de aparelho marcados como "verificar" se o agente não tiver iPad).
- [ ] README do projeto com uma seção curta "Artefatos".
- [ ] Documentação atualizada se a implementação divergir.
