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

## Resumo dos modos

```powershell
.\deploy.ps1                # HTTPS na 443 + 80 redirecionando (padrão)
.\deploy.ps1 -NoTls          # HTTP puro na 80, sem certificado
.\deploy.ps1 -Port 8000       # Porta única explícita, sem TLS
```
