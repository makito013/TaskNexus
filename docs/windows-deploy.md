# Deploy no Windows — detalhes técnicos

Este documento detalha o que acontece por baixo do `.\deploy.ps1` no Windows:
por que a porta padrão é 443, de onde vem o certificado TLS, e o papel do
listener na porta 80. Para o passo a passo básico de "como rodar", veja o
[README](../README.md).

## Por que a 443 funciona sem privilégio de administrador

Portas abaixo de 1024 não exigem elevação no Windows — diferente do Unix, onde
"portas privilegiadas" (`< 1024`) exigem root. O uvicorn abre um socket cru
diretamente, então nenhuma permissão especial é necessária para escutar na
443 ou na 80.

A única ressalva são as reservas do `netsh http show urlacl`: elas valem
apenas para listeners registrados no `http.sys` (o stack HTTP nativo do
Windows, usado por IIS e outros serviços). Como o uvicorn não passa pelo
`http.sys`, essas reservas não afetam o `deploy.ps1` — mas vale rodar
`netsh http show urlacl` antes de tentar subir na 443 se outra aplicação
(IIS, outro serviço) já tiver reservado a porta, para descartar conflito.

No macOS/Linux, `deploy.sh` fica na porta 8000 justamente porque lá a 443
exigiria root de verdade.

## TLS via `tailscale cert`

O modo padrão do `deploy.ps1` usa a porta 443 com um certificado emitido pelo
`tailscale cert` — um certificado Let's Encrypt real para o hostname da sua
máquina na tailnet (formato `<host>.<tailnet>.ts.net`, ex.:
`meuhost.tailnet.ts.net`). Por ser um certificado real (não autoassinado), o
Safari do iPad (ou qualquer outro navegador) abre a página sem aviso de
segurança.

Pré-requisitos:

- Tailscale instalado e a máquina conectada à tailnet.
- **HTTPS Certificates** habilitado nas configurações de DNS da tailnet
  (https://login.tailscale.com/admin/dns). Sem isso, `tailscale cert` falha.

Se você não quiser (ou não puder) habilitar isso, use `-NoTls` para subir em
HTTP puro na porta 80, ou `-Port 8000` para uma porta única sem TLS.

## Redirect da porta 80

Quando o TLS está ativo, um listener mínimo sobe na porta 80
(`scripts/redirect_http_to_https.py`) só para devolver um `301` redirecionando
para `https://`. O objetivo é cobrir o caso comum de digitar o host no
navegador sem esquema (`meuhost.tailnet.ts.net` em vez de
`https://meuhost.tailnet.ts.net`) — sem esse listener, isso cairia em
"connection refused" já que nada mais escuta na 80.

## Canal de hooks (porta de loopback)

O `claude` CLI avisa o backend de que terminou uma resposta chamando
`POST /api/hooks/stop` — é isso que marca a sessão como "precisa de atenção".
Os adaptadores MCP (criar tarefa, criar/mover card) funcionam do mesmo jeito.
Todos rodam na mesma máquina que o backend e falam HTTP simples em
`127.0.0.1`, o que não combina com o modo padrão: em 443 o app só aceita TLS.

Por isso o backend sobe um segundo listener, **exclusivamente em loopback**
(nunca na tailnet), dedicado a essas chamadas. O `deploy.ps1` liga esse
listener na porta 8765 por padrão, via a variável de ambiente
`HOOK_LOOPBACK_PORT`; use `-HookPort <n>` para escolher outra porta ou
`-HookPort 0` para desligar o canal (as notificações param de funcionar).

Se a porta escolhida já estiver ocupada, o backend registra um aviso e sobe
mesmo assim, sem o canal — nenhuma falha desse listener derruba o app.

## Resumo dos modos

```powershell
.\deploy.ps1                # HTTPS na 443 + 80 redirecionando (padrão)
.\deploy.ps1 -NoTls          # HTTP puro na 80, sem certificado
.\deploy.ps1 -Port 8000       # Porta única explícita, sem TLS
.\deploy.ps1 -HookPort 9000   # Canal de hooks na 9000 (padrão: 8765)
.\deploy.ps1 -V3 -Port 8010 -HookPort 8766   # Layout V3 experimental (ver abaixo)
```

## Layout V3 experimental

`-V3` roda `npm run build:v3` (saída em `frontend\dist-v3`, **sem tocar** em
`frontend\dist`, que a produção serve ao vivo) e sobe o uvicorn com
`FRONTEND_DIST` apontando para esse dist; os logs vão para `logs\uvicorn-v3.log`.
Sem a flag, `FRONTEND_DIST` é zerado e tudo funciona como antes. A flag não
grava nada no banco (`layout_version` continua `v2`). Nesta versão o terminal, o
board e o chat não existem.

`-V3` protege a produção em dois pontos:

- **Banco:** exige `SESSIONS_DB` apontando para uma **cópia** do banco e aborta
  antes do build se a variável faltar ou resolver para o `backend\sessions.db`
  real. Dois backends no mesmo SQLite disputam escrita e rodam os mesmos jobs de
  fundo.
- **venv:** pula o `pip install`. O `backend\.venv` é o mesmo da produção, e a V3
  não traz dependência nova de backend.

Com a produção no ar, `-V3` sem `-Port` binda a mesma porta dela (443/80); o
script só **avisa**, não bloqueia. Suba a V3 numa instância paralela:

```powershell
New-Item -ItemType Directory -Force C:/tmp/tn-v3 | Out-Null
# cópia consistente mesmo com a produção gravando (API de backup do SQLite)
backend\.venv\Scripts\python.exe -c "import sqlite3; s=sqlite3.connect('backend/sessions.db'); d=sqlite3.connect('C:/tmp/tn-v3/sessions-v3.db'); s.backup(d)"
$env:SESSIONS_DB = "C:/tmp/tn-v3/sessions-v3.db"
.\deploy.ps1 -V3 -Port 8010 -HookPort 8766
```

`$env:SESSIONS_DB` persiste na sessão do terminal: feche-o (ou rode
`$env:SESSIONS_DB = $null`) antes de voltar a subir a produção nele.
`./deploy.sh --v3` é o equivalente no macOS/Linux, com as mesmas proteções.

Para desenvolver a V3 com hot reload: `npm run dev:v3` no `frontend` e, se o
backend não estiver na 8000, `$env:API_PORT = "8010"` antes (variável do shell,
não do `.env`).
