# Parte 4 — Melhorias adicionais (o que a equipe encontrou)

> Cada item traz: **o que é**, **por que importa**, **como fazer** (com
> arquivos e passos), **esforço** (P = até meio dia, M = 1–2 dias, G = 3+ dias
> para um agente com revisão) e **prioridade**.

## Resumo e prioridade

| Id | Melhoria | Esforço | Prioridade | Depende de |
|----|----------|---------|------------|------------|
| 4.1 | Autenticação por token + cookie | M | **Obrigatória** (antes da Parte 1) | — |
| 4.2 | Quick wins no terminal: links clicáveis (**entra na Fase V**), modo "selecionar texto", fonte na rotação | P | Alta (alívio imediato) | — |
| 4.3 | Quebrar o `main.py` em routers | M | Alta (antes de crescer mais) | — |
| 4.4 | Revisão das mudanças do agente (git: diff, commit, descartar) | M | Alta | Parte 1 |
| 4.5 | Notificações ricas (prévia, aprovação pendente, link direto) | P | Alta | Parte 2 |
| 4.6 | Mandar coisas do iPad para o TaskNexus (Atalhos do iOS) | P | Média | 4.1 |
| 4.7 | Busca global (conversas, arquivos, cards, tarefas) | M | Média | Partes 1 e 2 |
| 4.8 | Chat ↔ Board: cards citados viram cartões clicáveis, "criar card desta mensagem" | P | Média | Parte 2 |
| 4.9 | Custo e uso por conversa e por projeto | P | Média | Parte 2 |
| 4.10 | Prompts salvos (snippets) e modelos de conversa | P | Média | Parte 2 |
| 4.11 | Exportar conversa em Markdown/HTML | P | Média | Parte 2 |
| 4.12 | Página de saúde do sistema | P | Baixa | — |
| 4.13 | Testes ponta a ponta em viewport de iPad + CI | M | Alta (protege tudo acima) | — |
| 4.14 | Fila de mensagens offline | P | Baixa | Parte 2 |

---

## 4.1 Autenticação por token de acesso (obrigatória)

**O que é:** uma tela de entrada que pede um token longo, gerado pelo próprio
TaskNexus, e depois mantém você logado por cookie.

**Por que importa:** hoje nenhuma rota exige login (o próprio código diz
"personal tailnet install"). Isso já permite que qualquer aparelho na sua rede
escreva no terminal dos agentes (`/api/sessions/.../paste`). Com a API de
arquivos, passaria a permitir **baixar arquivos do seu PC**. A Tailscale reduz
o risco, mas uma rede de hotel com o `deploy.ps1 -NoTls`, um aparelho
comprometido na LAN ou um HTML malicioso aberto no preview bastariam.

**Como fazer:**

1. **Segredo:** no primeiro boot, gerar `secrets.token_urlsafe(32)` e salvar
   em `backend/.tasknexus_secret` (permissão 600; já coberto por `.gitignore`?
   adicionar). É a mesma ideia do `vapid_keys.py`, que gera e guarda as chaves de push.
2. **Token de acesso:** mostrar no console do `deploy.sh`/`deploy.ps1`
   ("Token de acesso: …") e na tela de Configuração (quando já logado). Opção
   de gerar **QR code** na Configuração para abrir no iPad já autenticado
   (`https://<host>.ts.net/login#token=…`, o fragmento não vai para logs).
3. **Login:** `POST /api/auth/login {token}` → compara com
   `hmac.compare_digest` → cria cookie `tn_session` assinado
   (HMAC com o segredo, com `device_id` e expiração de 90 dias), `HttpOnly`,
   `Secure` quando HTTPS, `SameSite=Lax`, `Path=/`.
4. **Middleware:** exige cookie válido em `/api/*` e `/ws/*`, **exceto**:
   `/api/auth/*`, `/api/status`, rotas de hooks chamadas por loopback
   (`/api/hooks/*` só aceitam `request.client.host` em `127.0.0.1`/`::1`),
   arquivos estáticos do frontend, `manifest.webmanifest`, `sw.js` e a rota de
   preview assinada da Parte 1 (`/api/fs/pv/…`).
5. **WebSocket:** o navegador envia o cookie no handshake; validar em
   `pty_endpoint` e no `/ws/chat` antes do `accept()` (fechar com 4401).
6. **CORS:** trocar `allow_origins=["*"]` pela(s) origem(ns) do próprio app.
7. **Frontend:** `api.js` trata 401 redirecionando para `/login`; tela de
   login simples com campo de token, botão Entrar e "cole o token ou escaneie o QR".
8. **Dispositivos:** lista na Configuração ("iPad · último acesso ontem") com
   botão **Revogar** (guarda `device_id` revogados numa tabela).
9. **Opcional:** variável `TASKNEXUS_AUTH=off` para quem roda só em
   `localhost`, com aviso vermelho na Configuração.

**Testes:** rota protegida sem cookie → 401; com cookie adulterado → 401;
hook vindo de IP não-loopback → 403; WebSocket sem cookie → fecha com 4401;
login com token errado → 401 e atraso fixo (sem vazar tempo).

---

## 4.2 Quick wins no terminal (antes do chat ficar pronto)

**O que é:** três melhorias pequenas no `TerminalPanel.jsx` que aliviam o
uso no tablet já na primeira semana, e continuam úteis no modo Terminal depois.

**Como fazer:**

1. **Links clicáveis:** instalar `@xterm/addon-web-links` e carregar no mount:
   ```js
   import { WebLinksAddon } from '@xterm/addon-web-links';
   term.loadAddon(new WebLinksAddon((event, uri) => window.open(uri, '_blank', 'noopener')));
   ```
   E registrar um **link provider** para caminhos de arquivo
   (`term.registerLinkProvider`) usando a mesma regex de `fileLinks.js` (Parte 1),
   que abre o visualizador. **Este item foi puxado para a Fase V**
   ([Parte 6](06-planejamento-fase-v.md), seção 6.5.6): o caminho clicado vira
   uma aba nova do visualizador via `POST /api/sessions/{sk}/viewer`.
2. **Modo "Selecionar texto":** botão no cabeçalho (e no FAB de atalhos) que
   abre uma folha com o **conteúdo do buffer do terminal como texto real**:
   ```js
   const buf = term.buffer.active;
   const lines = [];
   for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
   ```
   Renderizar num `<pre>` com `user-select: text`, rolado até o fim, com botões
   **Copiar tudo** e **Copiar últimas 50 linhas**. Resolve "não consigo copiar"
   no terminal sem brigar com o xterm.
3. **Fonte na rotação:** hoje o tamanho da fonte é decidido uma vez no mount
   (documentado no próprio `TerminalPanel`). Ouvir
   `matchMedia('(orientation: portrait)')` e ajustar `term.options.fontSize` +
   `fit()` ao girar.

**Esforço:** P · **Arquivos:** `TerminalPanel.jsx`, `TerminalShortcutsPanel.jsx`, `package.json`.

---

## 4.3 Quebrar o `main.py` em routers

**Por que:** o arquivo tem ~2.950 linhas misturando boot, PTY, board,
tarefas, push, anexos e hooks. Adicionar arquivos, chat e auth nele aumenta o
risco de conflito e regressão.

**Como:** mover por domínio, sem mudar comportamento, um commit por domínio,
rodando a suíte a cada passo:

```
backend/app/routers/
  settings.py   push.py   projects.py   agents.py   sessions.py
  tasks.py      cards.py  board.py      hooks.py    pty_ws.py    static.py
backend/app/state.py      # stores e caches compartilhados (hoje globais do main.py)
```

`main.py` fica com o `lifespan`, middlewares e `include_router`. Os testes
existentes (que importam `app.main`) devem continuar passando sem alteração;
se algum teste faz monkeypatch em um global do `main`, manter um re-export.

---

## 4.4 Revisão das mudanças do agente

**O que é:** uma aba "Alterações" por conversa/projeto mostrando o `git
status` + diff de cada arquivo, com ações **Descartar arquivo** e
**Commitar selecionados** (mensagem sugerida pelo agente).

**Por que:** no tablet, revisar o que o agente fez é a tarefa mais comum
depois de conversar. Hoje exige abrir um terminal.

**Como:** reaproveita `git_info.py` e o `DiffRenderer` da Parte 1. Ações de
escrita (`git restore`, `git add` + `git commit`) em rotas `POST` separadas,
com confirmação em duas etapas na interface (mesmo padrão de "2 toques" do
`AttachmentsMenu`). Nunca `push` pela interface nesta fase. Botão "Pedir ao
agente para commitar" manda a mensagem pronta no chat, como alternativa.

---

## 4.5 Notificações ricas

**O que é:** o push de fim de turno passa a trazer o começo da resposta
("claude · tasknexus: Rodei a suíte: 58 passaram, 2 falharam…") e um push
novo para **aprovação pendente**. Tocar abre a URL exata da conversa (3.4).

**Como:** `push_payload.py` já monta o payload; incluir `body` com
`last_preview` (cortado em 120 caracteres) e `url: /chats/<sk>`. Disparar
também em `permission_request` quando nenhum cliente estiver conectado
àquela sessão, respeitando o horário de silêncio. **Limitação do iPadOS:**
botões de ação dentro da notificação ("Permitir") não são suportados em PWA
no iOS/iPadOS; a aprovação é feita tocando na notificação.

---

## 4.6 Mandar coisas do iPad para o TaskNexus

**Por que:** "compartilhar para o TaskNexus" (um print, um PDF, um link) é
natural no tablet. Porém o **Web Share Target não é suportado pelo Safari no
iPadOS**, então um PWA não aparece na folha de compartilhamento.

**Como (funciona hoje):** um **Atalho** do app Atalhos da Apple:

1. Criar rota `POST /api/inbox` (autenticada por um **token de API** separado,
   revogável, gerado na Configuração) que aceita arquivo ou texto e um
   `project_id` opcional; salva como anexo do projeto e cria uma notificação
   "Recebido do iPad".
2. Documentar na Configuração um passo a passo para o Atalho: "Receber
   entrada da folha de compartilhamento → Obter conteúdo de URL (POST, cabeçalho
   `Authorization: Bearer <token>`, corpo multipart)".
3. No chat, anexos recentes da inbox aparecem no menu ＋ como "Recebidos".

---

## 4.7 Busca global

Uma rota `GET /api/search?q=` que junta: conversas (nome e mensagens em
`chat_events`), arquivos (Parte 1), cards e tarefas (LIKE nos stores
existentes). Resultado agrupado por tipo na paleta ⌘K (3.7). Começar com
`LIKE`; migrar para SQLite FTS5 só se ficar lento.

---

## 4.8 Chat ↔ Board

- Referências `#184` no texto do agente viram link para o card (abre no
  painel de contexto com título, coluna, prazo).
- Quando o agente usa a ferramenta MCP de criar/mover card, o cartão de
  ferramenta mostra o card real ("Criou #184 · A fazer") e é clicável.
- Ação "Criar card desta mensagem" no menu da mensagem (2.2.6), com título
  sugerido (primeira linha) e descrição = mensagem em markdown.

---

## 4.9 Custo e uso

O evento `result` do claude traz `total_cost_usd`, duração e tokens. Guardar
no `turn_end` e mostrar: rodapé da resposta, total da conversa no cabeçalho
(toque para detalhes) e um quadro simples na Configuração com os últimos 30
dias por projeto (barras horizontais, sem biblioteca de gráfico).

---

## 4.10 Prompts salvos e modelos de conversa

- **Snippets:** textos reutilizáveis ("Revise o diff e rode os testes",
  "Escreva o changelog") acessíveis no menu **/** do composer, com
  variáveis simples (`{arquivo}`, `{card}`). Guardados no SQLite, editáveis na Configuração.
- **Modelos de conversa:** "Nova conversa de revisão" já abre com agente,
  projeto, modo de aprovação e primeira mensagem definidos.

---

## 4.11 Exportar conversa

Botão "Exportar" no menu da conversa: gera `.md` (mensagens, blocos de código,
resumo das ferramentas) ou `.html` autocontido com o mesmo visual do chat, e
entrega pelo mesmo mecanismo de download/compartilhar da Parte 1. Útil para
mandar a um cliente ou guardar no repositório.

---

## 4.12 Página de saúde

Em Configuração › Sistema: versões de `claude`, `codex`, `agy` no PATH do
backend; processos de agente vivos (PTY e chat) com botão encerrar; tamanho do
`sessions.db` e dos anexos; últimas 50 linhas de log; status do push (chaves
VAPID, dispositivos inscritos); aviso se o acesso é sem HTTPS. Ajuda a
diagnosticar do tablet sem abrir o PC.

---

## 4.13 Testes ponta a ponta e CI

- **Playwright** com projetos de viewport: iPad Pro 11 deitado (1194×834),
  iPad em pé (834×1194) e iPhone 13 (390×844), com `hasTouch: true`.
  Rodar em Chromium e, na máquina de desenvolvimento, também em **WebKit**
  (mais próximo do Safari).
- Cenários: enviar mensagem com adapter fake, aprovar, abrir arquivo por link,
  baixar, trocar Chat/Terminal, rotação (mudar viewport), sem rolagem horizontal
  (`document.documentElement.scrollWidth <= innerWidth`), alvos ≥ 44 px.
- Backend com `TASKNEXUS_FAKE_AGENT=1` usando o adapter fake da Parte 2, para
  os testes não dependerem do CLI real.
- **GitHub Actions:** `pytest` + `vitest` + Playwright (Chromium) em todo PR.

---

## 4.14 Fila de mensagens offline

Se a conexão cair (iPad saiu da rede), mensagens enviadas ficam com ⏱ numa
fila local (`localStorage`, com `client_id`) e são enviadas no `hello` da
reconexão. O backend ignora `client_id` repetido (idempotência), então nada é
enviado duas vezes.
