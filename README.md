# TaskNexus

_(antes "Escritório de Agentes")_

Abra o `claude` no seu computador de casa, deixe ele trabalhando, e continue a
conversa do iPad no sofá — ou de qualquer navegador na sua rede/Tailscale. O
TaskNexus sobe um terminal de verdade na web: o agente de IA roda no seu PC
(com toda a CPU, disco e ferramentas que ele já tem instaladas), e você
conversa com ele de qualquer aparelho, sem precisar manter uma sessão SSH
aberta ou instalar nada no dispositivo cliente.

<!-- Screenshot pendente — ver docs/images/README.md
![Terminal do TaskNexus aberto num iPad](docs/images/hero-terminal.png)
-->


## O que é

Um "escritório" web para gerenciar e conversar com agentes de IA (Claude e
codex, com suporte parcial a Gemini/Antigravity) rodando localmente na sua
máquina.
Três telas:

- **Escritório** (`/`) — terminal PTY real por projeto/agente. Você escolhe
  um projeto e um agente na barra lateral e conversa com ele num terminal de
  verdade (via [xterm.js](https://xtermjs.org/)), sem parsing frágil de
  eventos — é o mesmo terminal que você teria rodando `claude` localmente.
  Projetos são qualquer pasta com `.claude/`, `.gemini/` ou `.codex/` dentro
  da raiz configurada (`PROJECTS_ROOT`, padrão `~/projetos`, ajustável na tela
  de Configurações); os agentes disponíveis vêm de um cadastro global, também
  editável na UI.
- **Board** (`/board`) — kanban por projeto, com cards, subcards e imagens,
  para acompanhar o que está em andamento.
- **Tarefas** (`/tarefas`) — visão global de itens de acompanhamento: os
  próprios agentes de IA os registram automaticamente enquanto trabalham
  (via uma ferramenta MCP exposta a eles), então você não precisa anotar
  manualmente "lembrar de revisar X" — o agente já deixou isso registrado.

<!-- Screenshots pendentes — ver docs/images/README.md
| Board | Tarefas |
|---|---|
| ![Tela do Board](docs/images/board.png) | ![Tela de Tarefas](docs/images/tarefas.png) |
-->

## Pré-requisitos

- `claude` CLI instalado e no `PATH` — é invocado como subprocesso dentro de
  um PTY, então precisa estar disponível no ambiente onde o backend roda.
- Opcionalmente, `agy` (Gemini/Antigravity) no `PATH`, para projetos com
  `.gemini/` — suporte ainda parcial, em evolução.
- Opcionalmente, `codex` (OpenAI CLI) no `PATH`, para projetos com `.codex/`.
- Node.js (frontend) e Python 3 (backend).

## Como rodar localmente

**Modo dev** (hot reload, duas portas):

```bash
cd backend && uvicorn app.main:app --reload   # porta 8000
cd frontend && npm run dev                     # porta 5173, com proxy /api e /ws pro backend
```

**Modo produção local** (uma porta só, sem hot reload):

```bash
./deploy.sh                 # macOS/Linux — porta 8000
```

```powershell
.\deploy.ps1                # Windows — HTTPS na 443 + 80 redirecionando
.\deploy.ps1 -NoTls         # Windows — HTTP puro na 80, sem certificado
.\deploy.ps1 -Port 8000     # Windows — porta única explícita, sem TLS
.\deploy.ps1 -HookPort 0    # Windows — desliga o canal de hooks
```

Builda o frontend e sobe o backend servindo tudo. `Ctrl+C` pra parar — não há
supervisão de processo (auto-restart).

No Windows, o `deploy.ps1` espera encontrar o backend já num venv
(`backend/.venv`) — rode `scripts\install-service.ps1` (como Administrador)
uma vez antes, pra criar esse venv, e depois use o `deploy.ps1` normalmente
para subir o app. No Windows, o modo padrão usa TLS real via Tailscale
(`tailscale cert`) e inclui um redirect da porta 80. O `deploy.ps1` também
sobe, por padrão, um canal de hooks em loopback na porta 8765 (`-HookPort <n>`
troca a porta, `-HookPort 0` desliga). Detalhes técnicos completos — por que
portas `< 1024` não exigem elevação no Windows, o papel do
`netsh http show urlacl`, como o certificado é emitido, e como o canal de
hooks funciona — estão em [`docs/windows-deploy.md`](docs/windows-deploy.md).

## Como rodar os testes

**Frontend:**

```bash
cd frontend
npm install
npm test          # vitest run
```

**Backend:**

```bash
cd backend
python3 -m venv .venv                            # macOS/Linux
# python -m venv .venv                            # Windows

.venv/bin/pip install -r requirements.txt        # macOS/Linux
# .venv\Scripts\pip install -r requirements.txt   # Windows

.venv/bin/pytest                                  # macOS/Linux
# .venv\Scripts\pytest                             # Windows
```

## Stack técnica

Backend: Python 3 + FastAPI + Uvicorn + aiosqlite + PyYAML.
Frontend: React 18 + Vite 5 + [`@xterm/xterm`](https://xtermjs.org/) (terminal
real) + marked/dompurify. Sem TypeScript, sem framework de CSS/UI.

## Notificações de fim de chat (som, aba e push)

Quando um chat termina de responder, o TaskNexus avisa por três caminhos
independentes:

1. **Badge e título da aba** — sempre, sem exigir nenhuma permissão. É o que
   sobra quando todo o resto está bloqueado.
2. **Som + notificação do navegador na aba aberta** — depende da permissão de
   notificação do navegador, pedida no primeiro toque/clique na página.
3. **Web Push (navegador fechado)** — precisa ser ativado **por dispositivo**,
   no botão "Ativar push neste dispositivo" em Configuração → Notificações.

A janela de silêncio (Configuração → Notificações) vale para os três canais de
entrega, e usa o **relógio do servidor** — abrir o app de outro fuso horário
não desloca o horário configurado.

### ⚠️ Push exige contexto seguro (HTTPS ou `localhost`)

Service Worker e Web Push só existem em **contexto seguro**. Na prática:

| Como você acessa | Push funciona? |
| --- | --- |
| `https://<host>.ts.net` (Tailscale) | ✅ sim |
| `http://localhost:5173` / `http://localhost:8000` | ✅ sim |
| `https://<ip-da-lan>` com o cert do `deploy.ps1` | ✅ sim |
| `http://192.168.x.x` (IP de LAN, ou `deploy.ps1 -NoTls`) | ❌ não |

Por IP de rede local sem TLS o navegador **nem registra o service worker**, e
a falha é silenciosa: nenhum erro aparece na tela, o botão de ativar push só
fica indisponível. Se o push parece não funcionar, esse é o primeiro item a
conferir.

**No iPhone/iPad há um requisito a mais:** o Safari só expõe a API de push
para um app **instalado na Tela de Início**. Abra o TaskNexus no Safari, use
o menu de compartilhar → "Adicionar à Tela de Início", e ative o push a partir
do app instalado — no Safari comum a opção aparece como indisponível.

### Como funciona por baixo

O par de chaves VAPID é **gerado no primeiro boot do backend** e guardado no
`sessions.db` (tabela `vapid_keys`) — não há nada para configurar em `.env`.
A chave privada fica em claro no arquivo, como as demais informações do banco
(ver a nota sobre variáveis de ambiente mais abaixo).

Cada dispositivo que ativa o push vira uma linha em `push_subscriptions`.
Endpoints que o serviço de push reporta como mortos (404/410) são removidos
sozinhos no envio seguinte. Desativar o push num aparelho não afeta os outros.

Uma sessão gera **uma** notificação por pausa (`tag = session_key`), e o
aparelho que recebeu o push não toca o som da aba por cima — mas um navegador
sem push ativado continua tocando o som normalmente, então ativar push no
celular não silencia o desktop.

⚠️ **Dependências:** o push exige `pywebpush`/`py-vapid` (já em
`backend/requirements.txt`). Numa instalação que não reinstalou os requisitos,
o backend sobe normalmente e apenas reporta o push como indisponível — nenhum
outro recurso é afetado.

## ⚠️ Segurança e escopo de deployment

O backend sobe sem nenhuma autenticação, escutando em `0.0.0.0` (porta 8000 no
`deploy.sh`; 443, ou 80 com `-NoTls`, no `deploy.ps1`). Cada sessão de terminal
spawna um PTY real — ou seja, execução de shell de verdade, com os mesmos
poderes do usuário que rodou o processo. Não há nenhuma camada de login, token
ou sandboxing entre um cliente que alcança essa porta e um shell interativo na
máquina.

Uso pretendido: **rede local ou Tailscale, nunca exposição direta à
internet pública**. Se for expor além disso, coloque uma camada de
autenticação (proxy reverso com auth, VPN, etc.) na frente — o app em si
não protege essa porta.

⚠️ **Atenção redobrada ao usar 80/443:** são as duas portas que roteador
doméstico mais encaminha por padrão, e o TLS da 443 protege o tráfego em
trânsito mas **não autentica ninguém** — um cert válido só faz a porta parecer
mais legítima. Se este host pegar IP público ou o roteador abrir essas portas,
o resultado é um shell remoto sem senha exposto à internet. Para eliminar essa
classe de risco, troque `--host 0.0.0.0` pelo IP do Tailscale
(`tailscale ip -4`) no script de deploy: aí só a tailnet alcança.

**Variáveis de ambiente dos agentes:** o campo "Variáveis de ambiente" do
cadastro de agente (tela de Configuração) é gravado **em texto puro** no
`sessions.db`, sem criptografia. Se você colocar uma chave de API real ali
(ex.: `CURSOR_API_KEY`), ela fica legível para qualquer processo ou pessoa com
acesso ao arquivo. O `sessions.db` está no `.gitignore`, então não vai para o
repositório — mas continua em claro no disco, e entra em qualquer backup da
máquina. Preferir apontar para uma variável já existente no ambiente
(`CURSOR_API_KEY=%CURSOR_API_KEY%` no Windows, `$CURSOR_API_KEY` no
macOS/Linux) em vez de colar o segredo no formulário.

## Licença

[MIT](LICENSE)
