# Parte 6 — Planejamento da Fase V: o agente abre o arquivo na tela

> **Por que esta fase vem primeiro:** hoje o chat é um terminal e **não dá
> para clicar em links**. Então, antes do navegador de arquivos completo
> (Parte 1) e do chat estruturado (Parte 2), a entrega mais útil é o
> **próprio agente fazer o arquivo aparecer na tela**. Ele chama uma
> ferramenta, e o arquivo abre numa aba nova de um visualizador que fica no
> cabeçalho do chat, com botão de tela cheia.
>
> Este documento é o **plano de desenvolvimento**: o que vai ser feito, em
> que ordem, com quais arquivos, contratos, testes e critérios de pronto.
> Ele foi escrito para ser executado por um agente numa janela de contexto
> limpa, lendo só esta pasta e o código.

![Dropdown e tela cheia](img/10-mockup-visualizador-dropdown.svg)

Legenda: **A** botão **Visualizador** no cabeçalho do chat, com contador de
abas · **B** dropdown com uma aba por arquivo aberto · **C** barra do
arquivo com Baixar (⤓), Copiar (⧉), Abrir no navegador (↗) e **Tela cheia** ·
**D** o mesmo conteúdo em modal de tela cheia, com **✕ Fechar**.

> **Atualização (Fase N, [Parte 8](08-planejamento-navegacao-cliente-projeto.md)):**
> o "dropdown" do visualizador passa a abrir como **painel à direita**. Ele
> continua saindo do botão **Visualizador** do cabeçalho, com as mesmas abas,
> barra, **⤢ Tela cheia** e **✕ Fechar**. A forma de abrir depende da largura
> da tela:
>
> - **≥ 1100 px** (iPad deitado, desktop): painel **encaixado** à direita
>   (`ViewerDock`, largura `clamp(420px, 42vw, 780px)`); a sidebar e a lista de
>   chats viram trilhos de 68 px enquanto ele estiver aberto.
> - **641–1099 px:** painel **por cima** (`ViewerDrawer`).
> - **≤ 640 px:** tela cheia.
>
> Neste documento, onde estiver escrito "dropdown", leia **esse painel**. O
> conteúdo (`ViewerPanel`, abas, renderers) não muda. O mockup
> [13](img/13-mockup-sidebar-cliente-projeto.svg) mostra a posição nova; o
> mockup acima continua valendo para o conteúdo do painel e para a tela cheia.

---

## 6.1 Requisitos

### O que foi pedido (palavras do Bruno, organizadas)

| # | Requisito |
|---|-----------|
| R1 | O **próprio agente** consegue fazer um arquivo `.md`, `.html` ou de código **aparecer na tela**. |
| R2 | **Toda vez** que o agente manda abrir, abre **uma aba nova** no visualizador. |
| R3 | Botão **Tela cheia**: o dropdown vira um **modal de tela cheia na própria página**, com botão de **fechar**. |
| R4 | Continua valendo o pedido original: ver `.md` como no GitHub, `.html` renderizado e código destacado, e **baixar** o arquivo no tablet. |

### Como cada ponto foi interpretado (confirmar antes de codar)

| Ponto | Interpretação adotada | Alternativa, se o Bruno preferir |
|-------|-----------------------|-----------------------------------|
| "Aba nova" | Aba **dentro do visualizador** do TaskNexus, não aba do navegador. Um botão ↗ abre o arquivo numa aba do navegador quando for útil (ex.: HTML) | Abrir sempre em aba do navegador. Não recomendado: no iPad isso tira você do app e o PWA instalado abre o Safari |
| O mesmo arquivo pedido de novo | **Reaproveita** a aba existente, recarrega o conteúdo (o agente pode ter alterado) e a coloca em foco | Criar uma aba duplicada toda vez (é só trocar uma flag no backend: `reuse=false`) |
| Abrir sozinho | Se a conversa do agente estiver **visível**, o dropdown **abre sozinho** na aba nova. Se não estiver, o botão mostra o contador e aparece um aviso "claude abriu `plano.md` · Ver" | Nunca abrir sozinho, só contador |
| Celular (≤ 640 px) | Não há espaço para dropdown: o visualizador abre **direto em tela cheia**, por um botão flutuante ao lado do "☰ Menu" | — |
| Abas por conversa | Cada conversa tem as **suas** abas; trocar de conversa troca as abas | Um conjunto global de abas |
| Limite | Até **15 abas** por conversa; ao passar disso, a mais antiga fecha | — |

---

## 6.2 Experiência de uso (UX)

### Fluxo principal

1. Você pede ao agente, no terminal: "gera o relatório em HTML e me mostra".
2. O agente cria o arquivo e chama a ferramenta `abrir_no_visualizador` com
   `docs/relatorio.html`. No terminal aparece a chamada da ferramenta e o
   retorno "Aberto no visualizador do usuário (aba 3)".
3. No iPad, o dropdown do **Visualizador** abre sozinho abaixo do botão,
   com a aba `relatorio.html` ativa, mostrando o HTML renderizado.
4. Toque em **⤢ Tela cheia**: o conteúdo passa a ocupar a página inteira
   (modal), com as mesmas abas no topo e **✕ Fechar** à direita.
5. **✕ Fechar** (ou Esc) volta para o dropdown. Tocar fora do dropdown ou
   Esc no dropdown fecha o visualizador. As abas **continuam lá** para
   reabrir pelo botão.
6. **⤓ Baixar** salva o arquivo no iPad (Arquivos › Downloads).

### Outros pontos de entrada

- **Você pede sem o agente:** clicar num caminho de arquivo que aparece no
  terminal também abre no visualizador (6.5.6). Se o toque em link do
  terminal não funcionar no iPad, basta pedir ao agente "abre X no visualizador".
- **Links dentro de um markdown aberto:** link para outro arquivo do projeto
  (`[plano](../plano.md)`) abre **outra aba** no visualizador; link `https://`
  abre no navegador.

### Estados

| Estado | O que aparece |
|--------|---------------|
| Nenhuma aba | Botão "Visualizador" sem contador; ao abrir: "Nenhum arquivo aberto ainda. Peça ao agente: *abre o README no visualizador*." |
| Carregando | Esqueleto (barras cinza) no corpo da aba |
| Markdown | Renderizado como no GitHub (títulos, tabelas, checklists, código com botão Copiar) |
| HTML | `iframe` isolado; alternância **Preview · Código** |
| Código/texto | Destaque de sintaxe, números de linha, rola até `linha` se informada e a destaca por 2 s |
| Imagem / PDF | `<img>` com zoom por pinça / `<iframe>` do PDF (Safari tem leitor nativo) |
| Binário ou > 1 MB | Nome, tipo, tamanho e botão **Baixar** em destaque (sem preview) |
| Arquivo apagado depois de aberto | "Este arquivo não existe mais. O agente pode ter movido ou apagado." + botão Fechar aba |
| Erro de rede | "Não consegui carregar o arquivo. Tentar de novo" |

### Teclado e toque

- Esc: fecha a tela cheia; se não estiver em tela cheia, fecha o dropdown.
- Abas: toque troca; **×** fecha; rolagem horizontal quando não couberem.
  "Fechar todas" no menu "⋯" da barra.
- Alvos de toque com no mínimo 44 px no iPad (as abas têm 36 px de altura
  visual, mas a área tocável é 44 px com padding).

---

## 6.3 Arquitetura (TL)

![Fluxo da Fase V](img/11-fluxo-agente-abre-arquivo.svg)

### Decisões

| Decisão | Escolha | Por quê |
|---------|---------|---------|
| Como o agente "manda abrir" | **Nova ferramenta MCP** `abrir_no_visualizador`, num servidor MCP novo `escritorio-visualizador` | É o mesmo mecanismo das ferramentas de card e tarefa que já existem. O `_escritorio_mcp_servers()` registra para o `claude` **e** para o `codex` automaticamente |
| Como o backend avisa a tela | **Frame de controle** `viewer_open` no WebSocket do terminal que já está aberto (`/ws/pty/{session_key}`) | O canal já existe e o frontend já distingue frames de controle (`resume_failed`, `spawn_failed`) de saída do terminal. Nenhuma conexão nova |
| E se a tela estiver fechada? | A aba é **gravada no banco** (`viewer_items`). Ao abrir a conversa, o frontend busca as abas | O aviso ao vivo é só conveniência; nada se perde |
| Como servir o arquivo | Rotas **por aba** (`/api/viewer/{item_id}/…`), onde `item_id` é aleatório | Só arquivos que o agente (ou você) abriu ficam acessíveis, o que é bem menos exposição que um navegador de arquivos livre. Isso permite entregar esta fase **antes** da autenticação (F0) |
| HTML com CSS/imagens relativos | URL com o **caminho do arquivo no fim**: `/api/viewer/{item_id}/f/docs/relatorio.html` | O navegador resolve `style.css` para `/api/viewer/{item_id}/f/docs/style.css`, e o backend serve o vizinho dentro do mesmo projeto |
| Isolamento do HTML | `iframe sandbox="allow-scripts allow-popups"` **sem** `allow-same-origin` + cabeçalho `Content-Security-Policy: sandbox …` | O HTML roda numa origem opaca e não consegue chamar a API do TaskNexus |
| Onde o painel abre | À direita: encaixado (≥ 1100 px, com as colunas recolhidas enquanto aberto), por cima (641–1099 px) ou tela cheia (celular) | Pedido do Bruno: liberar o lado direito para o visualizador (Parte 8) |
| Tela cheia | Portal para `document.body`, mesmo contrato do `CenteredModal.jsx` (fora do wrapper que recebe `inert`, sem `transform` em ancestral de `position: fixed`) | Respeita a invariante já testada em `fixedPositioningInvariant.test.js` |

### Ligação com a aba Artefatos (Fase A, Parte 7)

A fase seguinte cria a aba **Artefatos** por cliente e projeto
([Parte 7](07-planejamento-artefatos.md)). Para ela reaproveitar esta fase sem
copiar código: (1) servir conteúdo e arquivos a partir de um módulo
`file_serving.py` que recebe `(project_root, rel_path, download)`; (2) o
`ViewerPanel` e os renderers não podem depender de `session_key`, só do item
(que terá uma origem: `viewer` ou `artifact`); (3) na Fase A, o
`abrir_no_visualizador` passa a publicar automaticamente `.md`/`.html`/`.pdf` como artefato.

### O que fica para depois (não entra nesta fase)

Árvore de pastas, busca ⌘P, diff do git, zip de pasta, preview-url assinada
e autenticação. Estão nas Partes 1 e 4 e nas fases F0/F1. O código desta
fase deve ser **reaproveitado** lá (`file_access.py` e os renderers).

---

## 6.4 Backend (Dev)

### 6.4.1 Arquivos

```
backend/app/file_access.py            # NOVO: resolve_safe_path, is_denied, detect_kind, language_for
backend/app/viewer_store.py           # NOVO: ViewerStore (tabela viewer_items no sessions.db)
backend/app/file_serving.py           # NOVO: content/f/download a partir de (project_root, rel_path);
                                      #       reaproveitado pela aba Artefatos (Parte 7)
backend/app/viewer_api.py             # NOVO: APIRouter com as rotas 6.4.3 (usa file_serving)
backend/app/mcp_viewer_adapter.py     # NOVO: servidor MCP stdio com a tool abrir_no_visualizador
backend/app/main.py                   # ALTERAR: registrar router, iniciar ViewerStore no lifespan,
                                      #          incluir "escritorio-visualizador" em _escritorio_mcp_servers,
                                      #          função notify_viewer_open(session_key, item)
backend/tests/test_file_access.py
backend/tests/test_viewer_store.py
backend/tests/test_viewer_endpoints.py
backend/tests/test_mcp_viewer_adapter.py
backend/tests/test_websocket.py       # ALTERAR: caso do frame viewer_open
```

Se a refatoração de routers (4.3) ainda não tiver acontecido, **não** a faça
nesta fase: só crie o `viewer_api.py` como `APIRouter` e registre com
`app.include_router(...)`. O `main.py` ganha poucas linhas.

### 6.4.2 `file_access.py`

```python
def resolve_safe_path(project_root: str, caminho: str) -> str:
    """Aceita caminho relativo à raiz do projeto ou absoluto DENTRO dela.
    Devolve o caminho real (realpath). Levanta:
      PermissionError  -> fora do projeto, caractere proibido, ou denylist
      FileNotFoundError -> não existe
      IsADirectoryError -> é pasta
    """
```

- Rejeitar `\x00`. Aceitar `\` só no Windows, normalizando (o middleware
  `RejectBackslashPathMiddleware` atua na URL, não no corpo JSON da tool).
- Relativo: `os.path.join(root, caminho)`. Absoluto: usar como está.
  Depois `realpath` nos dois lados e `commonpath` (reaproveitar a lógica de
  `_is_within_directory` de `attachments.py`, que já trata drive diferente no
  Windows; extrair para cá e fazer `attachments.py` importar daqui).
- **Denylist** (`is_denied(rel_path)`): `.env` e `.env.*` (exceto
  `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`,
  `id_ed25519*`, `*.kdbx`, qualquer coisa dentro de `.git/`, `.npmrc`,
  `.pypirc`, `credentials*.json`, `*.db`, `*.db-wal`, `*.db-shm`.
- `detect_kind(path, head_bytes)` → `markdown | html | code | image | pdf | video | binary`
  (pela extensão; `binary` se houver `\x00` nos primeiros 8 KB).
- `language_for(path)` → id de linguagem para o destaque de sintaxe
  (`.py→python`, `.js/.mjs→javascript`, `.jsx→jsx`, `.ts→typescript`,
  `.tsx→tsx`, `.json→json`, `.css→css`, `.html→html`, `.sh→bash`,
  `.ps1→powershell`, `.yml/.yaml→yaml`, `.toml→toml`, `.sql→sql`,
  `.md→markdown`, `Dockerfile→docker`, senão `text`).

### 6.4.3 Rotas

| Rota | Quem chama | Corpo / resposta |
|------|-----------|------------------|
| `POST /api/hooks/viewer/open` | só o adapter MCP (loopback) | corpo `{"claude_session_id","caminho","titulo"?,"linha"?}` → `{"success":true,"item":{…},"reused":false,"delivered":true}` ou `{"success":false,"error":"<mensagem para o agente>"}` |
| `POST /api/sessions/{session_key}/viewer` | frontend (clique em caminho no terminal, link num markdown) | `{"caminho","linha"?,"relativo_a"?}` → mesmo formato. `relativo_a` = caminho do arquivo onde o link estava, para resolver `../x.md` |
| `GET /api/sessions/{session_key}/viewer` | frontend ao montar/trocar de conversa | `{"items":[…]}` na ordem de criação |
| `DELETE /api/sessions/{session_key}/viewer/{item_id}` | fechar aba | `{"status":"closed"}` |
| `DELETE /api/sessions/{session_key}/viewer` | fechar todas | `{"status":"closed","count":n}` |
| `GET /api/viewer/{item_id}/content` | corpo da aba (markdown, código, texto) | `{"item_id","path","size","mtime","kind","language","is_text","text"?,"truncated"}` (texto até 1 MB) |
| `GET /api/viewer/{item_id}/f/{file_path:path}` | HTML no iframe, imagens, PDF, assets relativos | `FileResponse`; `file_path` é relativo à raiz do projeto do item e passa por `resolve_safe_path` + denylist |
| `GET /api/viewer/{item_id}/f/{file_path:path}?download=1` | botão Baixar | igual + `Content-Disposition: attachment; filename*=UTF-8''<nome>` |

Formato de `item`:

```json
{
  "item_id": "vw_5Jc2k0q8Qm1Y0oHq3a1bXw",
  "session_key": "podesubir/tasknexus::claude",
  "project_id": "podesubir/tasknexus",
  "path": "docs/relatorio.html",
  "title": "relatorio.html",
  "line": null,
  "kind": "html",
  "language": "html",
  "opened_by": "agent",
  "created_at": 1727650000.12,
  "updated_at": 1727650000.12
}
```

Regras:

- `session_key` → `project_id` = `session_key.partition("::")[0]` (mesma
  regra usada em `continue_session`) → `_resolve_project_or_404` → `project.path`.
- Hook: `claude_session_id` → `store.get_session_key_by_claude_id` (igual
  aos hooks de card). Sem sessão: `{"success":false,"error":"Sessão do TaskNexus não encontrada"}`.
- **Reaproveitar aba:** se já existir item aberto na mesma sessão com o mesmo
  `path`, atualiza `line`, `title` e `updated_at`, e devolve `reused:true`.
- **Limite de 15** abas por sessão: ao criar a 16ª, apaga a de `updated_at`
  mais antigo.
- Cabeçalhos da rota `f/` para `text/html`, `image/svg+xml`, `application/xhtml+xml`, `text/xml`:
  `Content-Security-Policy: sandbox allow-scripts allow-popups; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'`,
  `X-Content-Type-Options: nosniff`. Para todos: `Cache-Control: no-store`
  (o agente reescreve arquivos).
- Rotas `/api/hooks/viewer/*` aceitam só cliente loopback (`127.0.0.1`/`::1`).
  O `_hook_callback_base_url()` já aponta os adaptadores para `http://127.0.0.1:<porta>`;
  a exceção é quando `HOOK_CALLBACK_BASE_URL` está definida (backend atrás de
  proxy/container): nesse caso **não** aplicar a checagem por IP, senão o hook
  para de funcionar. Não mexer nos hooks existentes nesta fase.
- Todo acesso a disco com `asyncio.to_thread`.

### 6.4.4 Aviso ao vivo (frame `viewer_open`)

Nova função no `main.py`, chamada pelas duas rotas `POST` depois de gravar:

```python
async def notify_viewer_open(session_key: str, item: dict, reused: bool) -> bool:
    ws = _active_connections.get(session_key)
    if ws is None:
        return False
    try:
        await ws.send_text(json.dumps({"type": "viewer_open", "item": item, "reused": reused}))
        return True
    except Exception:          # socket fechando: a aba já está no banco, o front busca depois
        return False
```

`send_text` já é o canal dos frames de controle neste WebSocket (a saída do
PTY vai sempre como bytes), então não há mistura com o terminal.

### 6.4.5 `ViewerStore`

Mesmo padrão dos stores atuais: conexão `aiosqlite` própria no `sessions.db`,
`PRAGMA journal_mode=WAL`, `busy_timeout=5000`, `initialize()` no `lifespan`.

```sql
CREATE TABLE IF NOT EXISTS viewer_items (
  item_id     TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  title       TEXT NOT NULL,
  line        INTEGER,
  kind        TEXT NOT NULL,
  language    TEXT,
  opened_by   TEXT NOT NULL,          -- 'agent' | 'user'
  created_at  REAL NOT NULL,
  updated_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_viewer_items_session ON viewer_items(session_key, updated_at);
```

Ao encerrar uma sessão (`POST /api/sessions/{sk}/terminate`), apagar as
abas dela.

### 6.4.6 Adapter MCP `mcp_viewer_adapter.py`

Copie o esqueleto de `mcp_card_adapter.py` (JSON-RPC 2.0 por linha no stdio,
stdlib pura, Python 3.9, TLS de loopback sem verificação, `PYTHONUTF8=1`).
Uma única tool:

```json
{
  "name": "abrir_no_visualizador",
  "description": "Abre um arquivo do projeto no visualizador do TaskNexus, na tela do usuário (inclusive no iPad), numa aba nova. Use SEMPRE que criar ou alterar um arquivo que o usuário deva ler ou conferir (relatórios .html, documentos .md, planos, diagramas, trechos de código importantes) e sempre que o usuário pedir para ver, abrir ou mostrar um arquivo. O usuário não consegue clicar em links no terminal, então esta é a forma de mostrar arquivos a ele. Markdown aparece renderizado, HTML aparece como página, código aparece com destaque de sintaxe, e o usuário pode baixar o arquivo.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "caminho": {"type": "string", "description": "Caminho do arquivo, relativo à raiz do projeto (ex.: docs/plano.md) ou absoluto dentro do projeto."},
      "titulo":  {"type": "string", "description": "Opcional. Nome curto da aba. Padrão: nome do arquivo."},
      "linha":   {"type": "integer", "description": "Opcional. Linha para rolar e destacar (arquivos de código)."}
    },
    "required": ["caminho"]
  }
}
```

- Env vars: `ESCRITORIO_CLAUDE_SESSION_ID` e `ESCRITORIO_HOOK_VIEWER_OPEN_URL`
  (`{base_url}/api/hooks/viewer/open`).
- Respostas da tool (texto, para o agente ler):
  - sucesso, entregue: `Aberto no visualizador do usuário: docs/relatorio.html (aba nova).`
  - sucesso, aba reaproveitada: `…: docs/relatorio.html (aba já existia, foi atualizada).`
  - sucesso, tela fechada: `Registrado no visualizador: docs/relatorio.html. O usuário verá ao abrir o TaskNexus.`
  - erro do backend: o texto de `error` (ex.: `Arquivo não encontrado: docs/x.md`,
    `Caminho fora do projeto`, `Arquivo protegido (segredos não são exibidos)`).
  - backend fora do ar: `Não foi possível falar com o TaskNexus agora.` (sem travar, sem retry).
- Registro: nova entrada `"escritorio-visualizador"` em `_escritorio_mcp_servers()`.
  Com isso o `claude` recebe pelo `--mcp-config` e o `codex` pelos
  `-c mcp_servers.*`, sem outra mudança. Conferir que os testes de contrato do
  spawn (`test_pty_manager*`, testes do codex) continuam passando e atualizar o
  que listar os servidores esperados.

---

## 6.5 Frontend (Dev)

### 6.5.1 Arquivos

```
frontend/src/features/viewer/
  ViewerContext.jsx        # estado das abas por sessão + ações; Provider junto do TerminalProvider
  viewerApi.js             # fetch das rotas 6.4.3
  ViewerButton.jsx         # botão "Visualizador" com contador (cabeçalho do chat, iPad/PC)
  ViewerMobileButton.jsx   # botão flutuante ao lado do "☰ Menu" (celular)
  ViewerDock.jsx           # painel encaixado à direita (≥ 1100 px) — ver Parte 8
  ViewerDrawer.jsx         # mesmo painel por cima do conteúdo (641–1099 px), padrão do TasksDrawer
  ViewerFullscreen.jsx     # modal de tela cheia (portal, contrato do CenteredModal)
  ViewerPanel.jsx          # abas + barra de ações + corpo (usado pelos dois contêineres)
  ViewerTabs.jsx
  ViewerToolbar.jsx        # Baixar, Copiar, Abrir no navegador, Tela cheia/Fechar, ⋯ (Fechar todas)
  useViewerContent.js      # busca /content com cache por item_id+updated_at
  renderers/
    MarkdownView.jsx       # utils/markdown.js ampliado + destaque + botão Copiar nos blocos
    HtmlView.jsx           # iframe sandbox + Preview/Código
    CodeView.jsx           # destaque de sintaxe, números de linha, rolar até a linha
    ImageView.jsx
    PdfView.jsx
    BinaryView.jsx
frontend/src/utils/markdown.js                  # ALTERAR: GFM, links, imagens relativas (6.5.4)
frontend/src/components/TerminalPanel.jsx       # ALTERAR: frame viewer_open (+ links 6.5.6)
frontend/src/layouts/v2/AppV2.jsx               # ALTERAR: ViewerButton no cabeçalho; botão mobile
frontend/src/App.jsx (ou main.jsx)              # ALTERAR: ViewerProvider
package.json                                    # + shiki, + @xterm/addon-web-links
```

### 6.5.2 `ViewerContext`

```js
// estado
{
  bySession: { [sessionKey]: { items: Item[], activeId: string|null, loaded: boolean } },
  open: false,            // dropdown aberto
  fullscreen: false,      // modal de tela cheia
  unseen: { [sessionKey]: number }   // contador para abas abertas com a conversa fora de vista
}
// ações
loadItems(sessionKey)                 // GET, ao montar/trocar de conversa (se !loaded)
receiveOpen(sessionKey, item, reused) // chamado pelo frame viewer_open
openByPath(sessionKey, caminho, {linha, relativoA})  // POST (links clicados pelo usuário)
closeItem(sessionKey, itemId) / closeAll(sessionKey)
setActive(sessionKey, itemId)
setOpen(bool) / setFullscreen(bool)
```

`receiveOpen`: adiciona ou atualiza o item e o torna ativo. Se
`sessionKey === activeSessionKey` e a tela de chat estiver visível: `open=true`
(no celular, `fullscreen=true`). Senão: `unseen[sessionKey]++` e aviso curto
(toast) "claude abriu `relatorio.html` · Ver".

O `TerminalPanel` é montado também em testes isolados, sem Provider: use
`useContext` com fallback nulo e só chame `receiveOpen` se o contexto existir.

### 6.5.3 Painel à direita ("dropdown") e tela cheia

- **Painel à direita**, escolhido pela largura (Parte 8, seção 8.2.2):
  - `ViewerDock` (≥ 1100 px, `WIDE_VIEWPORT_QUERY`): irmão flex do conteúdo
    do `ChatV2`, largura `clamp(420px, 42vw, 780px)`, borda esquerda
    `--v2-border`. Ao abrir/fechar, liga o **recolhimento forçado** das colunas
    (Parte 8, 8.3.3) e dispara `escritorio:sidebar-toggled` para o xterm se reajustar.
  - `ViewerDrawer` (641–1099 px): overlay à direita no padrão do
    `TasksDrawer.jsx`, largura `min(560px, 92vw)`, faixa `--v2-scrim` leve;
    fecha com Esc, ✕ ou toque fora.
  - Fecha também quando a sessão ativa muda? **Não**: as abas são por sessão,
    então o painel troca para as abas da nova sessão (ou mostra o estado vazio).
- Se a Fase N ainda não tiver sido feita, o `ViewerDock` funciona do mesmo
  jeito, só que sem o recolhimento automático (o usuário recolhe à mão).
- **Tela cheia:** `ViewerFullscreen` renderiza o `ViewerPanel` num portal em
  `document.body`, `position: fixed; inset: 0`, respeitando
  `--v2-safe-*`. Barra superior: abas à esquerda, **✕ Fechar** à direita
  (44 px). Esc ou Fechar → `fullscreen=false` (volta ao painel à direita no iPad/PC;
  no celular fecha tudo).
- **Um só painel por vez:** quando `fullscreen` é verdadeiro, o painel à direita não
  renderiza. A aba ativa é a mesma nos dois (estado no contexto). O `iframe` do
  HTML recarrega ao trocar de contêiner, o que é aceitável.
- Botão no cabeçalho: ao lado de `AttachmentsMenu` na topbar do `AppV2`
  (mesma guarda `!isMobile && v2Screen === 'chat'`). Rótulo "Visualizador" e
  selo com o número de abas; selo destacado quando `unseen > 0`.
- Celular: `ViewerMobileButton` flutuante perto do "☰ Menu" quando
  `mobileView === 'content'`, abrindo direto em tela cheia.

### 6.5.4 Renderização

- **Markdown:** ampliar `renderMarkdown` com `marked` em modo GFM; manter
  `DOMPurify`. Depois de montar, os `<pre><code class="language-x">` recebem
  destaque (6.5.5) e um cabeçalho com linguagem e **Copiar**
  (`utils/clipboard.js`). Links:
  - `http(s)://` → nova aba do navegador (`target="_blank" rel="noopener noreferrer"`);
  - relativos que apontam para arquivo (`../plano.md`, `src/app.py#L10`) →
    interceptar o clique e chamar `openByPath(sessionKey, href, {relativoA: item.path})`,
    abrindo **outra aba** do visualizador;
  - âncoras `#secao` → rolar dentro do painel.
  Imagens relativas → `src` reescrito para `/api/viewer/{item_id}/f/<caminho resolvido>`.
- **HTML:** `<iframe src="/api/viewer/{item_id}/f/{path}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer">`
  ocupando o corpo inteiro; alternância **Preview · Código** (Código usa o `CodeView`).
- **Código:** números de linha, quebra de linha opcional, rolar até `line` e
  destacar por 2 s. Seleção de texto nativa.
- **Arquivos grandes/binários:** `BinaryView` com Baixar.

### 6.5.5 Destaque de sintaxe

Usar **Shiki** com carregamento sob demanda (import dinâmico do núcleo e de
cada linguagem só quando aparecer), temas `github-light`/`github-dark`
conforme `data-theme`. Se o custo de bundle ficar alto para o iPad (medir com
`npm run build`), a alternativa aceita é `highlight.js` com linguagens
registradas sob demanda; registrar a decisão no PR.

### 6.5.6 Links clicáveis no terminal (resolve o problema de origem)

- `@xterm/addon-web-links`: URLs `https://…` viram links e abrem em nova aba
  do navegador.
- `term.registerLinkProvider` para **caminhos de arquivo** (`docs/plano.md`,
  `src/app.py:42`, `./README.md`, absolutos dentro do projeto): ao ativar,
  chama `openByPath(sessionKey, caminho, {linha})`.
- **Verificação obrigatória no iPad:** o xterm ativa links por clique; no
  toque do iPad isso deve funcionar, mas precisa ser testado. Se não
  funcionar, registrar no PR. O caminho garantido continua sendo o agente
  chamar a tool.

---

## 6.6 Ordem de execução (um commit por passo, testes verdes em cada um)

| Passo | Entrega | Verificação |
|-------|---------|-------------|
| 1 | `file_access.py` + testes; `attachments.py` passa a importar a contenção daqui | `pytest tests/test_file_access.py tests/test_attachments*.py` |
| 2 | `ViewerStore` + rotas 6.4.3 (sem MCP, sem WS) | `pytest tests/test_viewer_store.py tests/test_viewer_endpoints.py` |
| 3 | `mcp_viewer_adapter.py` + registro em `_escritorio_mcp_servers` | `pytest tests/test_mcp_viewer_adapter.py` + suíte do spawn/codex |
| 4 | `notify_viewer_open` + frame no WS | caso novo em `test_websocket.py` |
| 5 | `ViewerContext` + tratamento do frame no `TerminalPanel` | vitest do contexto e do `isControlFrame` |
| 6 | Dropdown, abas, barra, renderers Markdown/Código/Binário | vitest |
| 7 | HTML (iframe), imagem, PDF, download | vitest + manual |
| 8 | Tela cheia + botão mobile | vitest + manual |
| 9 | Links no terminal (6.5.6) | manual no iPad |
| 10 | Atualizar README do projeto (seção de uso) e esta doc se algo mudou | revisão |

---

## 6.7 Testes

### Backend

- `resolve_safe_path`: relativo ok; absoluto dentro ok; `../fora`,
  absoluto fora, symlink para fora, `\x00`, pasta, inexistente, cada item da
  denylist. No Windows: drive diferente → recusa.
- Rotas: criar item pelo hook com `claude_session_id` válido e inválido;
  reaproveitar aba do mesmo caminho (`reused:true`); limite de 15; listar em
  ordem; fechar uma e todas; `content` de markdown, de binário (`is_text:false`)
  e de arquivo > 1 MB (`truncated:true`); `f/` com HTML tem CSP `sandbox`;
  `f/` servindo `style.css` vizinho; `f/` recusando `.env` e `../../`;
  `download=1` com nome acentuado; hook vindo de IP não-loopback → 403.
- Adapter MCP: `initialize`, `tools/list` com a tool, `tools/call` com sucesso,
  com erro do backend e com backend fora do ar (mesmo estilo de
  `test_mcp_card_adapter.py`).
- WebSocket: com cliente conectado na sessão, o POST gera um frame de texto
  `viewer_open`; sem cliente, `delivered:false` e nada quebra.

### Frontend

- `isControlFrame` reconhece `viewer_open`.
- `ViewerContext`: `receiveOpen` com conversa visível abre o dropdown; com
  conversa oculta incrementa `unseen`; aba reaproveitada não duplica; fechar
  a última aba fecha o dropdown.
- `MarkdownView`: link externo com `rel="noopener noreferrer"`; link relativo
  chama `openByPath` com `relativoA`; imagem relativa reescrita para `/api/viewer/…/f/…`.
- `HtmlView`: iframe **sem** `allow-same-origin`.
- `ViewerFullscreen`: Esc chama `setFullscreen(false)`; renderiza em portal.
- Manter `fixedPositioningInvariant.test.js` passando.

### Aceite manual (iPad, Safari e PWA instalado)

1. Pedir ao claude: "crie `docs/teste-visualizador.md` com uma tabela, uma
   checklist e um bloco de Python, e abra no visualizador". O dropdown abre
   sozinho com a aba renderizada.
2. Pedir outro arquivo: abre **aba nova**; pedir o primeiro de novo: foca a
   aba existente com o conteúdo atualizado.
3. Pedir um `.html` com CSS e imagem em arquivos separados: aparece com estilo e imagem.
4. **⤢ Tela cheia** → modal ocupando a página; **✕ Fechar** volta ao dropdown; Esc também.
5. **⤓ Baixar** num `.md`: arquivo em Arquivos › Downloads.
6. Selecionar três linhas de um bloco de código com o dedo e colar no Notas.
7. Estar em outra conversa quando o agente abre um arquivo: contador no botão
   e aviso; ao trocar para a conversa, as abas estão lá.
8. Recarregar a página: as abas continuam.
9. No celular: botão flutuante abre direto em tela cheia.
10. Pedir ao agente para abrir `.env`: ele recebe "Arquivo protegido" e nada aparece.
11. Tocar num caminho de arquivo no terminal (registrar se funcionou no iPad).
12. Mesmo teste 1 com o `codex`.

---

## 6.8 Riscos e como mitigar

| Risco | Mitigação |
|-------|-----------|
| O agente não usa a tool por conta própria | Descrição da tool diz explicitamente quando usar. Se ainda assim não usar, adicionar uma linha ao `system_prompt` do agente no cadastro de agentes (Configuração) ou ao `CLAUDE.md` do projeto: "Sempre que criar ou alterar um arquivo que eu deva ver, abra-o com abrir_no_visualizador." |
| Sem autenticação, alguém na rede lista abas e lê arquivos | Superfície limitada a arquivos abertos + vizinhos do mesmo projeto, com denylist. A autenticação (4.1, fase F0) fecha isso de vez e deve vir logo em seguida |
| HTML malicioso gerado por engano | `iframe` sem `allow-same-origin` + CSP `sandbox` no cabeçalho |
| Bundle pesado (Shiki, marked) no iPad | Imports dinâmicos; medir com `npm run build` e registrar tamanhos no PR |
| Frame chega enquanto o WS está sendo substituído (evicção de leitor único) | A aba está no banco; `loadItems` na montagem recupera |
| Conversa aberta em dois aparelhos: só o conectado recebe o frame | O outro vê as abas ao abrir a conversa (GET). Assinatura múltipla fica para o chat da Parte 2 |

---

## 6.9 Definição de pronto

- [ ] Todos os testes (`pytest` e `npm test`) passando, incluindo os novos.
- [ ] Os 12 passos de aceite manual conferidos no iPad (itens que dependem do
      aparelho marcados como "verificar" no PR, se o agente não tiver iPad).
- [ ] `deploy.sh` e `deploy.ps1` funcionando sem mudança de uso.
- [ ] README do projeto com uma seção curta "Visualizador de arquivos".
- [ ] Este documento atualizado se a implementação divergir.

---

## 6.10 Como ficou implementado (V-1, backend)

A Fase V foi dividida em duas entregas: **V-1** (backend, passos 1 a 4 da
tabela 6.6) e **V-2** (frontend, passos 5 a 10). Esta seção registra a V-1 como
ela ficou no código. Onde o código diverge do que está acima, **vale o código**.

### 6.10.1 Arquivos

| Arquivo | O que faz |
|---------|-----------|
| `backend/app/file_access.py` | `resolve_safe_path`, `is_denied`, `detect_kind`, `language_for`, `is_within_directory` (extraída de `attachments.py`, que agora importa daqui) e `project_dir_from_id` |
| `backend/app/file_serving.py` | `read_content` / `build_file_response` (síncronas) e `content_payload` / `file_response` (assíncronas, com `asyncio.to_thread` e erro já em `HTTPException`). Recebem só `(project_root, rel_path, download)`: a Fase A chama as mesmas funções |
| `backend/app/viewer_store.py` | `ViewerStore` (tabela `viewer_items` exatamente como em 6.4.5) |
| `backend/app/viewer_api.py` | `ViewerService` (regra de "abrir numa aba", reaproveitável pela Fase A) e `create_viewer_router(service)` com as rotas de 6.4.3 |
| `backend/app/mcp_viewer_adapter.py` | Servidor MCP `escritorio-visualizador` com a tool `abrir_no_visualizador` (nome, descrição e schema idênticos a 6.4.6) |
| `backend/app/main.py` | `viewer_store` no `lifespan`, `notify_viewer_open`, `_find_project_path`, `include_router`, entrada `escritorio-visualizador` em `_escritorio_mcp_servers`, `terminate_session` apaga as abas |
| `backend/tests/test_file_access.py`, `test_file_serving.py`, `test_viewer_store.py`, `test_viewer_endpoints.py`, `test_mcp_viewer_adapter.py` | Novos |
| `backend/tests/test_websocket.py`, `test_hook_loopback_listener.py` | Frame `viewer_open` e o terceiro servidor MCP nos testes de contrato do spawn |

### 6.10.2 Divergências e decisões tomadas na implementação

| # | Ponto | Especificação | Como ficou | Por quê |
|---|-------|---------------|------------|---------|
| 1 | Campo `evicted` | Frame `{"type","item","reused"}` | Frame e respostas dos `POST` ganham `"evicted": [item_id…]` (quase sempre `[]`) | Quando a 16ª aba fecha a mais antiga, a tela tira a aba certa sem recarregar a lista nem duplicar a regra do limite |
| 2 | Resposta de `content` | `item_id, path, size, mtime, kind, language, is_text, text?, truncated` | Mais `name` (nome do arquivo) e `mime` (Content-Type que a rota `f/` usa) | O estado "Binário ou > 1 MB" mostra nome e tipo (6.2) |
| 3 | Arquivo de texto > 1 MB | "texto até 1 MB" | Vem o **primeiro 1 MB** em `text` com `truncated: true`; um caractere UTF-8 partido no limite é descartado | A tela escolhe entre mostrar o começo ou o cartão de download |
| 4 | CSP da rota `f/` | Só para html/svg/xhtml/xml | Em **toda** resposta, menos PDF; e com `allow-popups-to-escape-sandbox` | O sandbox efetivo é a interseção do atributo do iframe (6.5.4) com o cabeçalho: sem o `escape` aqui, um link `target=_blank` do relatório abriria o site externo sandboxed. PDF fica fora porque o leitor do Chrome não renderiza documento com `sandbox`. CSP em imagem/CSS/JS carregados por página é ignorado, então estender não quebra nada |
| 5 | `nosniff` | Para html/svg/xml | Em toda resposta | Impede o navegador de "adivinhar" HTML num `.txt` |
| 6 | Content-Type | (não especificado) | Tabela explícita para os tipos web; markdown e código saem como `text/plain`; binário desconhecido `application/octet-stream` | No Windows o `mimetypes` lê o registro e pode devolver `text/plain` para `.js` — com `nosniff`, o script do relatório não rodaria |
| 7 | `Content-Disposition` | Só com `download=1` | `attachment` com `download=1`, `inline` sem; os dois com `filename="<ascii>"` e `filename*=UTF-8''<nome>` | O "Salvar" do Safari usa o nome certo também no preview |
| 8 | Erros da rota do usuário | "mesmo formato" | Mesmo corpo `{"success":false,"error"}`, **com** status HTTP 400/403/404 | A tela trata como erro de fetch comum e ainda lê a mensagem |
| 9 | Corpo do hook | Modelo com campos | Lido à mão: corpo malformado, `caminho` ausente/não-texto ou `linha` inválida nunca viram 422 | Um 422 viraria "Não foi possível falar com o TaskNexus agora." no adaptador, escondendo o erro do agente. `linha` aceita `"42"`; `<= 0` vira "sem linha" |
| 10 | Título ao reaproveitar | "atualiza line, title e updated_at" | Atualiza `line`, `kind`, `language`, `updated_at`; o `title` só muda se veio um novo | Reabrir sem `titulo` não apaga o nome curto dado antes |
| 11 | Projeto ao **servir** arquivo | `_resolve_project_or_404` | Na abertura sim (`_find_project_path`, em thread); nas rotas `content`/`f/` usa `project_dir_from_id(PROJECTS_ROOT, project_id)` | `scan_projects` faz `os.walk` de toda a raiz a cada chamada, e um HTML pede um asset por requisição. O caminho é o mesmo por construção (`PROJECTS_ROOT/project_id`), com contenção e `isdir` |
| 12 | Link com `#` (rota do usuário) | — | `src/app.py#L10` vira `caminho=src/app.py`, `linha=10`; outro fragmento é descartado; `linha` explícita vence | Links de markdown trazem fragmento |
| 13 | Contenção de caminho absoluto | realpath + commonpath | Antes do `realpath`, contenção **léxica** (pela raiz como configurada ou pela raiz real) | No Windows, `realpath` de `\\host\share\x` abre conexão SMB e vaza o hash NTLM. Efeito colateral aceito: um caminho absoluto por um atalho qualquer que aponte para dentro do projeto é recusado |
| 14 | Mensagens | Exemplos | `Caminho fora do projeto`, `Arquivo protegido (segredos não são exibidos)`, `Arquivo não encontrado: <caminho>`, `É uma pasta, não um arquivo: <caminho>`, `Informe o caminho do arquivo.`, `Sessão do TaskNexus não encontrada`, `O hook do visualizador só aceita chamadas da própria máquina.` | — |
| 15 | `DELETE` de aba inexistente | `{"status":"closed"}` | `404 {"detail":"Aba não encontrada"}` (também para aba de outra sessão) | A tela deve tratar 404 como "já fechada" |
| 16 | Adaptador MCP | Copiar o de cards | Igual, mais: lê o corpo JSON de respostas 4xx (o 403 de não-loopback chega legível ao agente) e timeout de 5 s | — |
| 17 | `asyncio.Lock` do `ViewerStore` | — | Criado no `initialize()`, não no `__init__` | No Python 3.9 o Lock se prende ao loop do momento da criação, e o store nasce no import |

Ficaram **como especificado**: tabela `viewer_items` e índice; ids `vw_` +
`token_urlsafe(16)`; reaproveitar aba do mesmo caminho (`reused: true`); limite
de 15 por sessão (sai a de `updated_at` mais antigo); hooks
`/api/hooks/viewer/*` só de loopback, exceto com `HOOK_CALLBACK_BASE_URL`
definida (os hooks antigos não mudaram); denylist de 6.4.2 (comparação sem
distinção de maiúsculas); tool `abrir_no_visualizador` com os quatro textos de
resposta; registro em `_escritorio_mcp_servers` (vale para `claude` e `codex`);
abas apagadas no `terminate`; todo acesso a disco em `asyncio.to_thread`.

### 6.10.3 Contratos para a V-2 (frontend)

**Item** (igual em todas as respostas e no frame):

```json
{
  "item_id": "vw_kmeSBgUzBNpSMkq8P64XFA",
  "session_key": "demo::claude",
  "project_id": "demo",
  "path": "README.md",
  "title": "README.md",
  "line": null,
  "kind": "markdown",
  "language": "markdown",
  "opened_by": "user",
  "created_at": 1790820458.07,
  "updated_at": 1790820458.07
}
```

- `kind`: `markdown | html | code | image | pdf | video | binary`.
- `language`: id do Shiki (`python`, `javascript`, `jsx`, `typescript`, `tsx`,
  `json`, `css`, `html`, `bash`, `powershell`, `yaml`, `toml`, `sql`,
  `markdown`, `docker`, mais `scss`, `xml`, `go`, `rust`, `java`, `ruby`, `php`,
  `csharp`, `c`, `cpp`, `ini`, `diff`…), ou `text`.
- `opened_by`: `agent | user`.

**Frame no `/ws/pty/{session_key}`** (TEXTO; a saída do PTY é sempre binária):

```json
{"type": "viewer_open", "item": {…}, "reused": false, "evicted": []}
```

**Rotas**

| Rota | Sucesso | Erros |
|------|---------|-------|
| `POST /api/sessions/{session_key}/viewer` `{"caminho","linha"?,"relativo_a"?}` | `200 {"success":true,"item","reused","delivered","evicted"}` | `400/403/404 {"success":false,"error"}` |
| `GET /api/sessions/{session_key}/viewer` | `{"items":[…]}` em ordem de criação | — |
| `DELETE /api/sessions/{session_key}/viewer/{item_id}` | `{"status":"closed"}` | `404` |
| `DELETE /api/sessions/{session_key}/viewer` | `{"status":"closed","count":n}` | — |
| `GET /api/viewer/{item_id}/content` | `{"item_id","path","name","size","mtime","kind","language","mime","is_text","text"?,"truncated"}` | `404` aba ou arquivo inexistente (`detail`), `403` protegido/fora |
| `GET /api/viewer/{item_id}/f/{caminho}` | bytes, `Cache-Control: no-store`, `nosniff`, CSP `sandbox` (menos PDF), `Content-Disposition: inline` | `403`, `404`, `400` (pasta) |
| `GET /api/viewer/{item_id}/f/{caminho}?download=1` | idem com `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…` | idem |

`{caminho}` na rota `f/` é relativo à raiz do projeto (o HTML acha os vizinhos
por URL relativa). `relativo_a` é o `path` do item onde o link estava.

### 6.10.4 Teste ponta a ponta (V-1)

Feito com o backend real (`uvicorn`, `HOOK_LOOPBACK_PORT` ligado) e um projeto
de teste:

1. WebSocket em `/ws/pty/demo::claude` + `POST .../viewer {"caminho":"README.md"}`:
   resposta com `delivered: true` e o frame `viewer_open` chegou no socket.
2. `GET /api/viewer/{id}/content` devolveu o markdown; `f/README.md?download=1`
   veio com `attachment`, `no-store`, `nosniff` e CSP; `f/.env` deu 403; o
   `style.css` vizinho de um HTML veio como `text/css`.
3. `POST /api/hooks/viewer/open` pelo IP da rede → 403; pelo `127.0.0.1` → 200.
4. **`claude` real** (2.1.x, `claude -p` com o `--mcp-config` gerado pelo
   backend para a sessão registrada): o agente achou e chamou
   `abrir_no_visualizador`, o frame chegou no WebSocket com `opened_by: agent`,
   e o agente leu `Aberto no visualizador do usuário: README.md (aba já existia, foi atualizada).`
   Ao pedir o `.env`, leu `Arquivo protegido (segredos não são exibidos)` e explicou ao usuário.
   A TUI interativa não foi usada no teste porque o CLI deste ambiente parava no
   onboarding/login; o caminho (`--mcp-config` → adaptador → hook → WebSocket) é o mesmo.

### 6.10.5 Pendências deixadas para a V-2 e depois

- **Permissão da tool no `claude` interativo:** na primeira chamada, a TUI pode
  pedir aprovação de `mcp__escritorio-visualizador__abrir_no_visualizador`
  (igual às tools de card). Se incomodar no iPad, avaliar `--allowedTools` no
  spawn (mudança no contrato do spawn, fora desta fase).
- **Vídeo no Safari:** o Starlette 0.38 não responde `Range`, e o `<video>` do
  iOS exige. `kind: video` existe, mas o renderer deve tratar como `BinaryView`
  até haver suporte a `Range`.
- **CORS `*` sem autenticação** continua permitindo que uma página qualquer (e
  o HTML sandboxed) chame a API; resolve-se na F0 (4.1), como já previsto em 6.8.
- **README do projeto** (seção "Visualizador de arquivos"): fica para a V-2,
  junto com a tela.
- Teste de aceite com o `codex` real (item 12 de 6.7): o registro passa pelos
  testes de contrato do `-c mcp_servers.*`; falta rodar com o binário.

---

## 6.11 Como ficou implementado (V-2, frontend)

A V-2 entregou os passos 5 a 10 da tabela 6.6 (um commit por passo, mais dois
commits de ajustes achados na verificação visual). Como na 6.10, onde o código
diverge do texto acima, **vale o código**.

### 6.11.1 Arquivos

| Arquivo | O que faz |
|---------|-----------|
| `frontend/src/features/viewer/ViewerContext.jsx` | `ViewerProvider`, `useViewer()` (estado + ações, `null` sem Provider), `useViewerActions()` (só ações, identidade estável), `useViewerHost()` (o casco informa conversa ativa/visível/celular e carrega as abas), `surfaceForScope`, `openerLabel`, `MAX_TABS = 15` |
| `features/viewer/viewerApi.js` | Escopos (`sessionScope`, `sessionKeyFromScope`), `normalizeItem` (acrescenta `source` e `id`), URLs por origem (`contentUrl`, `fileUrl` com `download` e `version`) e as rotas da 6.10.3 |
| `features/viewer/viewerPaths.js` | Funções puras de caminho (resolver relativo, normalizar, codificar para URL, formatar tamanho/tempo) |
| `features/viewer/ViewerPanel.jsx` | Abas + barra + corpo, iguais nos três contêineres; estados vazio/carregando/erro/apagado/grande |
| `features/viewer/ViewerTabs.jsx`, `ViewerToolbar.jsx` | Abas (toque troca, × fecha, rolagem horizontal só da faixa) e barra (⤓ ⧉ ↗ ⋯) |
| `features/viewer/ViewerDock.jsx` | Painel encaixado (≥ 1100 px), `clamp(420px, 42vw, 780px)` |
| `features/viewer/ViewerDrawer.jsx` | Painel por cima (641–1099 px), portal, `min(560px, 92vw)` |
| `features/viewer/ViewerFullscreen.jsx` | Tela cheia em portal (contrato do `CenteredModal`) |
| `features/viewer/ViewerButton.jsx`, `ViewerMobileButton.jsx` | Botão da topbar (contador + selo de não vistos) e flutuante do celular |
| `features/viewer/ViewerToast.jsx` | Aviso "claude abriu X · Ver" e erros de abrir link |
| `features/viewer/useViewerContent.js` | `GET …/content` com cache por `source:id:updated_at` (30 entradas) |
| `features/viewer/highlight.js` | Shiki sob demanda (núcleo, motor JS, temas e cada linguagem por `import()`) |
| `features/viewer/terminalLinks.js` | Caminhos clicáveis no xterm (achar, mapear colunas, link provider) e o handler das URLs |
| `features/viewer/escape.js` | Regra única do Esc (nunca fecha nada se a tecla veio do terminal) |
| `features/viewer/renderers/` | `MarkdownView`, `HtmlView`, `CodeView`, `ImageView`, `PdfView`, `BinaryView` e `index.jsx` (escolha pelo `kind`) |
| `features/viewer/viewer.css` | Estilos do painel (só tokens `--v2-*`) |
| `frontend/src/utils/markdown.js` | `renderViewerMarkdown` (GFM, links, âncoras, ids de título, imagens relativas); `renderMarkdown` ganhou só `target=_blank` nos links externos |
| `frontend/src/components/TerminalPanel.jsx` | `viewer_open` em `CONTROL_FRAME_TYPES`, `@xterm/addon-web-links` e o link provider de caminhos |
| `frontend/src/layouts/v2/AppV2.jsx` | `ViewerProvider` envolvendo o casco, botão na topbar, Dock/Drawer/Fullscreen pela largura, botão do celular, aviso |
| `frontend/package.json` | `shiki` (4.x) e `@xterm/addon-web-links` (0.11, par do `@xterm/xterm` 5.5) |
| `README.md` | Seção "Visualizador de arquivos" |

### 6.11.2 Divergências e decisões tomadas na implementação

| # | Ponto | Especificação | Como ficou | Por quê |
|---|-------|---------------|------------|---------|
| 1 | `viewerOpen` no `AppV2` | `setViewerOpen` chamado ao abrir/fechar (8.7) | **Derivado**: `viewerOpen = painel do chat aberto && v2Screen === 'chat'`; o `useState` saiu | Sincronizar por efeito daria um quadro com o painel aberto e as colunas ainda largas. Derivado, ir ao Board devolve as colunas e voltar ao Chat recolhe de novo sem código extra. O refit (`escritorio:sidebar-toggled`) continua só no `useViewerDockCollapse` — o painel não dispara um segundo evento (há teste contando um) |
| 2 | Onde fica o Provider | "junto do TerminalProvider" (App.jsx) | Dentro do `AppV2` (`AppV2` = `ViewerProvider` + `AppV2Shell`) | Tudo que usa o visualizador mora abaixo do `AppV2` (TerminalPanel, topbar, painéis e a futura tela Artefatos); a rota `/tarefas` não paga nada; os testes que montam `<AppV2>` direto já ganham o Provider |
| 3 | Estado do contexto | `bySession`, `open`, `fullscreen`, `unseen` | `scopes` (por escopo), `surfaces` (`open`/`fullscreen` **por superfície**: `chat` hoje, `artefatos` na Fase A), `unseen` (por escopo), `toast` | Trocar de conversa troca o escopo, mas o painel continua aberto (6.5.3). E a Fase A ganha o próprio painel sem misturar com o do chat |
| 4 | Assinaturas | `openByPath(sessionKey, …)`, `closeItem(sessionKey, …)` | Recebem o **escopo** (`session:<sk>`) | Os componentes do painel só conhecem o escopo (a Fase A passa `artefatos`) |
| 5 | Dois contextos | um | `useViewerActions()` (estável) + `useViewer()` (estado) | Cada TerminalPanel montado assina só as ações: abrir uma aba não re-renderiza todos os terminais |
| 6 | Botões | ⤢ Tela cheia na barra | ⤢ e ✕ no **cabeçalho**, ao lado das abas (como no mockup 13); a barra fica com ⤓ ⧉ ↗ ⋯ | No painel de 420 px a barra não teria espaço para o caminho com mais um botão largo |
| 7 | ⧉ Copiar | — | Copia o **conteúdo** de texto (md, código, html); em imagem/PDF/binário copia o **caminho** | É o que dá para colar no Notas em cada caso |
| 8 | Esc | Fecha tela cheia; senão fecha o painel | Igual, mas **nunca** quando a tecla veio do xterm (`.xterm`); no painel encaixado só com o foco dentro dele (sem listener global) | O Esc é do agente (cancelar no `claude`, sair do modo inserção no vim), inclusive quando o painel abriu sozinho enquanto você digitava |
| 9 | Foco | — | Gaveta e tela cheia focam o painel ao abrir; o encaixado **nunca** rouba o foco do terminal | Os dois primeiros cobrem o terminal; o encaixado fica ao lado e você pode continuar digitando |
| 10 | Tela cheia no iPad | O painel à direita não renderiza | A **coluna** do encaixado continua reservada (vazia) | Entrar/sair da tela cheia não muda a largura do terminal: nada de refit nem redesenho do `claude` por baixo do modal |
| 11 | Botão do celular | "ao lado do ☰ Menu" | Canto **superior direito**, na mesma faixa do Menu ("📄 Arquivos" + contador) | A topbar do celular fica vazia; medir a largura do Menu para encostar seria frágil. Em cima pelo mesmo motivo do Menu (teclado do iOS) |
| 12 | Botão na topbar | Ao lado de Anexos | À **esquerda** de Anexos, desabilitado sem conversa ativa | É o controle que o agente aciona sozinho (selo de não vistos), fica na ponta mais visível |
| 13 | Arquivo > 1 MB | Cartão de download | Cartão + "Mostrar o começo" (primeiro 1 MB como texto puro, sem destaque, com faixa de aviso). HTML grande continua no iframe | 6.10.2, item 3: a tela escolhe. O iframe carrega o arquivo inteiro pela rota `f/` |
| 14 | Vídeo | — | `BinaryView` com "baixe para assistir" | 6.10.5: sem `Range` no backend o `<video>` do Safari não toca |
| 15 | Recarregar `<img>`/`<iframe>` | — | `?v=<updated_at>` nas URLs de exibição (não no Baixar) | Com o mesmo `item_id` reaproveitado, o Safari reutilizaria a imagem/iframe da versão anterior. A query não muda a resolução de `style.css` relativo |
| 16 | Links no markdown | Relativos → `openByPath` com `relativoA` | Igual; `/x.md` (com barra) = **raiz do projeto**, sem `relativoA` | É o que o GitHub faz num README; o backend trataria `/x.md` como caminho absoluto do disco |
| 17 | Âncoras | "rolar dentro do painel" | Títulos ganham `id="user-content-<slug>"` (slug do GitHub) e o clique rola o painel | O prefixo impede um título "location" de sombrear `window.location` |
| 18 | Erros de abrir link | — | Aviso (toast) com a mensagem do backend ("Arquivo não encontrado: …", "Arquivo protegido …") | O mesmo caminho serve para link no markdown e caminho tocado no terminal |
| 19 | DELETE com erro de rede | — | A aba some na hora; se o DELETE falhar (não 404), a lista é recarregada do backend | Mais honesto que fingir que fechou; 404 = "já fechada" (6.10.2, item 15) |
| 20 | Quem abriu | "claude abriu X" | Agente = 2º segmento da `session_key` (`projeto::agente[::instância]`); aberto pela tela (`opened_by: user`) → "Você abriu" | — |
| 21 | Destaque de sintaxe | Shiki sob demanda | Shiki 4 com **motor JavaScript** (`forgiving: true`), sem destaque acima de 200 mil caracteres; o `CodeView` desenha no máximo 20 mil linhas | O WASM do Oniguruma pesa ~600 KB e precisa ser compilado no iPad; o motor JS usa as RegExp do próprio Safari. Arquivos enormes travariam a thread principal |
| 22 | Linhas longas de código | — | Rolam **dentro do bloco** de código; o corpo do painel nunca rola na horizontal | A barra "N linhas · Quebrar linhas" fica parada; "Quebrar linhas" alterna `pre-wrap` |
| 23 | Ordem das abas | — | Ordem de criação; aba reaproveitada fica no mesmo lugar e vira ativa | Igual ao que o backend devolve no `GET` |
| 24 | Links no terminal | Caminhos + URLs | Nome solto só vira link com extensão **conhecida** (`README.md` sim, `github.com` não); URLs ficam com o addon e abrem sem `opener` | Evita sublinhar prosa ("e.g.", versões) e dar "Arquivo não encontrado" ao tocar |

### 6.11.3 Tamanho do bundle (`npm run build`)

| Arquivo | Antes da V-2 | Depois da V-2 |
|---------|--------------|---------------|
| `index-*.js` (carregado sempre) | 886,03 kB · gzip 250,69 kB | 930,07 kB · gzip 265,52 kB (+14,8 kB gzip: painel, renderers, contexto, addon de links) |
| `index-*.css` | 11,65 kB · gzip 3,71 kB | 22,33 kB · gzip 5,91 kB |
| Shiki, só no 1º destaque | — | núcleo 36,95 kB + motor JS 21,22 kB + tema 2,5 kB (gzip) |
| Cada linguagem, só quando aparece | — | ex.: python 9,1 kB, bash 6,1 kB, markdown 5,6 kB, html 11,7 kB, javascript 16,5 kB (gzip) |

Abrir o primeiro arquivo Python custa ~70 kB gzip a mais, uma vez. Achou-se
desnecessário cair para o `highlight.js`.

### 6.11.4 Testes

`npm test`: **90 arquivos, 1584 testes, todos passando** (eram 81/1498).
Novos: `ViewerContext.test.jsx`, `viewerApi.test.js`, `viewerPaths.test.js`,
`ViewerPanel.test.jsx`, `ViewerFullscreen.test.jsx`, `terminalLinks.test.js`,
`renderers/renderers.test.jsx`, `renderers/media.test.jsx`,
`components/TerminalPanel.viewer.test.jsx`; ampliados: `utils/markdown.test.js`
e `layouts/v2/AppV2.test.jsx` (encaixe com colunas recolhidas e um só refit,
Board/Chat, gaveta + Esc, tela cheia, celular). Cobrem os itens "Frontend" de
6.7: `isControlFrame` reconhece `viewer_open`; abrir com conversa visível ×
oculta; aba reaproveitada não duplica; fechar a última fecha o painel; link
externo com `rel="noopener noreferrer"`; link relativo com `relativoA`; imagem
relativa reescrita; iframe sem `allow-same-origin`; Esc da tela cheia e portal.
`fixedPositioningInvariant.test.js` continua passando.

### 6.11.5 Verificação visual

Backend real (`uvicorn`) com um projeto de teste (`README.md` com tabela,
checklist e blocos Python/Bash; `docs/relatorio.html` com `style.css` e imagem
relativa; `src/app.py` com 155 linhas; `docs/manual.pdf`; `.env`) e um agente
`claude` do tipo terminal (bash). O "agente" foi simulado com
`POST /api/sessions/demo::claude/viewer` com a conversa aberta (o frame
`viewer_open` chega pelo WebSocket do terminal). Playwright/Chromium em
1180×820, 820×1180 e 390×844, em `capturas/fase-v2/`:

| Tela | 1180×820 (encaixado) | 820×1180 (por cima) | 390×844 (tela cheia) |
|------|----------------------|---------------------|----------------------|
| Markdown abriu sozinho | [ver](capturas/fase-v2/ipad-paisagem-1180x820--1-markdown.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--1-markdown.png) | [ver](capturas/fase-v2/celular-390x844--1-markdown.png) |
| Markdown: blocos de código com destaque e Copiar | [ver](capturas/fase-v2/ipad-paisagem-1180x820--2-markdown-codigo.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--2-markdown-codigo.png) | [ver](capturas/fase-v2/celular-390x844--2-markdown-codigo.png) |
| HTML (link relativo do README abriu outra aba; CSS e imagem vizinhos) | [ver](capturas/fase-v2/ipad-paisagem-1180x820--3-html.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--3-html.png) | [ver](capturas/fase-v2/celular-390x844--3-html.png) |
| Código com a linha 42 destacada | [ver](capturas/fase-v2/ipad-paisagem-1180x820--4-codigo-linha-42.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--4-codigo-linha-42.png) | [ver](capturas/fase-v2/celular-390x844--4-codigo-linha-42.png) |
| Tela cheia | [ver](capturas/fase-v2/ipad-paisagem-1180x820--5-tela-cheia.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--5-tela-cheia.png) | [ver](capturas/fase-v2/celular-390x844--5-tela-cheia.png) |
| PDF (↗ e ⤓ sempre visíveis) | [ver](capturas/fase-v2/ipad-paisagem-1180x820--6-pdf.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--6-pdf.png) | [ver](capturas/fase-v2/celular-390x844--6-pdf.png) |
| Imagem | [ver](capturas/fase-v2/ipad-paisagem-1180x820--7-imagem.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--7-imagem.png) | [ver](capturas/fase-v2/celular-390x844--7-imagem.png) |
| Aviso com a conversa fora de vista (Board) | [ver](capturas/fase-v2/ipad-paisagem-1180x820--8-aviso-fora-de-vista.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--8-aviso-fora-de-vista.png) | — |
| "Ver" do aviso volta à conversa com a aba ativa | [ver](capturas/fase-v2/ipad-paisagem-1180x820--9-ver-do-aviso.png) | [ver](capturas/fase-v2/ipad-retrato-820x1180--9-ver-do-aviso.png) | — |
| Botão flutuante do celular | — | — | [ver](capturas/fase-v2/celular-390x844--8-botao-flutuante.png) |
| Caminho no terminal sob o mouse / clicado (abriu `app.py:42`) | [ver](capturas/fase-v2/ipad-paisagem-1180x820--10-terminal-link-hover.png) · [ver](capturas/fase-v2/ipad-paisagem-1180x820--11-terminal-link-abriu.png) | — | — |

O que foi conferido em cada largura (medido no script, não só olhado):

- **Nenhuma rolagem horizontal**: `scrollWidth − clientWidth = 0` na página e
  no corpo do painel em todas as capturas (as linhas longas de código rolam
  dentro do bloco delas).
- 1180×820: com o painel encaixado, sidebar e lista de chats viraram trilhos;
  ao fechar, voltaram expandidas; a preferência salva não mudou.
- O script do relatório **rodou** dentro do iframe e `document.cookie` lançou
  erro (origem opaca: o sandbox sem `allow-same-origin` está valendo).
- Esc fechou a tela cheia nas três larguras; `.env` foi recusado com
  "Arquivo protegido (segredos não são exibidos)".
- Terminal: o caminho `src/app.py:42` impresso pelo bash ganhou cursor de link e
  o clique abriu a aba `app.py:42`; a URL abriu uma aba nova do navegador.

Achados corrigidos durante a verificação (commits `fix(viewer)`): destaque dos
blocos do markdown não aparecia no modo de desenvolvimento (StrictMode); fonte
do v1 na gaveta/tela cheia (portais fora do casco); rolagem passando de uma aba
para outra; × da aba nova cortado atrás dos botões do cabeçalho.

### 6.11.6 Pontos de integração para a Fase A (frontend)

- **Escopo e origem:** use o escopo `'artefatos'` e itens com
  `source: 'artifact'` e `artifact_id`. `normalizeItem(raw, 'artifact')` monta
  `id`; `contentUrl(item)` → `/api/artifacts/{id}/content` e
  `fileUrl(item, path, { download, version })` → `/api/artifacts/{id}/f/…` já
  existem (7.4.3). Nenhum renderer muda.
- **Abrir um artefato:** `const viewer = useViewer();
  viewer.openItem('artefatos', artifact, { source: 'artifact' })` — insere ou
  foca a aba (limite de 15), e abre a superfície `artefatos`.
- **Painel:** `<ViewerDock scope="artefatos" />` (≥ 1100 px),
  `<ViewerDrawer scope="artefatos" open={…} />` (641–1099 px) e
  `<ViewerFullscreen scope="artefatos" open={…} closeEverything={isMobile} />`.
  Props comuns: `scope`, `surface` (padrão `surfaceForScope(scope)`, que dá
  `'artefatos'`), `emptyHint` (texto do estado vazio). O aberto/tela cheia sai
  de `viewer.getSurface('artefatos')`; ações `setOpen`/`setFullscreen(surface, bool)`,
  `closeItem/closeAll/setActive(scope, …)`.
- **Recolhimento no AppV2:** hoje `viewerOpen` olha só a superfície `chat`. A
  tela Artefatos deve somar a dela:
  `viewerOpen = (chat.open && v2Screen === 'chat') || (artefatos.open && v2Screen === 'artefatos')`.
- **Persistir as abas em `sessionStorage`** (7.5.4): ler na montagem e chamar
  `openItem` (ou acrescentar ao contexto um `restoreItems(scope, items)`);
  hoje o escopo local vive só na memória.
- **Links dentro de um artefato:** `openByPath` só funciona em escopo de
  sessão (devolve erro amigável fora dele). Para artefatos, decidir se o link
  relativo abre na conversa ativa ou vira outro artefato.
- **Lista desatualizada (7.5.5):** o frame `viewer_open` já passa por
  `receiveOpen`; para recarregar a galeria, observar `viewer.scopes` ou
  acrescentar um ouvinte no contexto.
- **"☆ Salvar em Artefatos" (7.5.1):** entra no `ViewerToolbar`, que recebe o
  `item` (com `source`).

### 6.11.7 Pendências (verificar no iPad)

- **Toque em link do terminal no iPad** (6.5.6): no Chromium o clique funciona
  com o mouse; no iPad precisa ser conferido. Com o `claude` real o modo de
  mouse da TUI fica ligado — o xterm ainda detecta o link, mas o toque pode ir
  para a TUI. O caminho garantido é a tool.
- **Baixar no Safari/PWA** (aceite 5) e **seleção de linhas com o dedo**
  (aceite 6): dependem do aparelho.
- **PDF no iframe do Safari** mostra só a 1ª página — por isso ↗ e ⤓ ficam
  sempre visíveis no `PdfView`.
- **Motor JS do Shiki** usa o flag `v` das RegExp quando o navegador tem
  (iPadOS 17+) e cai para regras ES2018 nos mais antigos (`target: 'auto'`);
  com `forgiving`, uma regra que não compile deixa só aquele trecho sem cor.
  Conferir o destaque no aparelho.
- Itens 1–3, 7–10 e 12 do aceite manual (6.7) com o `claude`/`codex` reais.
