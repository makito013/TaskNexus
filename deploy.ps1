# deploy.ps1 — build do frontend + sobe o backend em primeiro plano.
#
# Uso: .\deploy.ps1              # HTTPS na 443 (cert do Tailscale) + 80 redirecionando
#      .\deploy.ps1 -NoTls       # HTTP puro na 80, sem certificado
#      .\deploy.ps1 -Port 8000   # porta única explícita, sem TLS (o modo antigo)
#
# Equivalente ao deploy.sh (macOS/Linux): builda o frontend e sobe o uvicorn
# em primeiro plano, num terminal que você deixa aberto. Sem supervisão de
# processo (auto-restart) — mesma limitação aceita no Mac. Ctrl+C encerra
# graciosamente (--timeout-graceful-shutdown).
#
# Não precisa de admin: no Windows, portas < 1024 não são privilegiadas como no
# Unix, e as reservas de `netsh http show urlacl` valem só para listeners do
# http.sys (IIS e afins) — o uvicorn usa socket cru, então não colide com elas.
# `tailscale cert`, porém, fala com o tailscaled local e PODE exigir elevação
# dependendo da instalação; se falhar, o script diz exatamente o que fazer.
#
# Pré-requisito: backend\.venv já criado com dependências instaladas (rode
# scripts\install-service.ps1 uma vez antes, ele monta o venv com o Python
# certo — mesmo sem usar o resto daquele script).
#
# Exige PowerShell 7+ (pwsh): no Windows PowerShell 5.1,
# $ErrorActionPreference = "Stop" combinado com o pipeline "2>&1 |" abaixo
# transforma qualquer stderr nativo (inclusive logs normais do uvicorn) num
# erro TERMINANTE, matando o processo no primeiro log — sem isso, o script
# simplesmente para de funcionar no meio, com um erro confuso.
#Requires -Version 7

[CmdletBinding()]
param(
    # Desliga TLS: serve HTTP puro, sem certificado e sem listener de redirect.
    [switch]$NoTls,

    # Porta única explícita. Implica -NoTls (uma porta só, sem par 80/443).
    # Existe para reproduzir o comportamento antigo (--port 8000) sem editar o
    # script, e para rodar duas instâncias em paralelo durante um teste.
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$FrontendDir = Join-Path $ScriptDir "frontend"
$BackendDir = Join-Path $ScriptDir "backend"
$LogDir = Join-Path $ScriptDir "logs"
$CertDir = Join-Path $ScriptDir "certs"
$RedirectScript = Join-Path $ScriptDir "scripts\redirect_http_to_https.py"

# -Port explícito ganha de tudo e implica HTTP puro: 443 sem cert não é HTTPS,
# e o par 80/443 só faz sentido junto.
if ($Port -gt 0) { $NoTls = $true }

Write-Host "==> Buildando frontend (npm run build)..."
Push-Location $FrontendDir
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$VenvUvicorn = Join-Path $BackendDir ".venv\Scripts\uvicorn.exe"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvUvicorn)) {
    throw "Não achei $VenvUvicorn — rode scripts\install-service.ps1 (como Administrador) uma vez antes, pra criar o venv."
}

# ---------------------------------------------------------------------------
# Certificado (só no modo TLS)
# ---------------------------------------------------------------------------
# O cert vem do Tailscale, não é auto-assinado: é um Let's Encrypt de verdade
# para <host>.<tailnet>.ts.net, então o Safari do iPad aceita sem aviso de
# segurança — que é o ponto de usar 443 em vez de 8000.
#
# O hostname é lido do próprio tailscaled em vez de hardcoded, para não quebrar
# se a máquina for renomeada no admin console.
#
# --min-validity 720h (30 dias) é o que torna isto idempotente: com um cert
# ainda válido por mais de 30 dias o comando é no-op e não fala com a CA; perto
# do vencimento ele renova sozinho. Sem essa flag, cada deploy bateria na CA.
$UvicornTlsArgs = @()
$CertPath = $null
$KeyPath = $null

if (-not $NoTls) {
    $tsExe = (Get-Command tailscale -ErrorAction SilentlyContinue)?.Source
    if (-not $tsExe) { $tsExe = "C:\Program Files\Tailscale\tailscale.exe" }
    if (-not (Test-Path $tsExe)) {
        throw "TLS pedido mas não achei o tailscale.exe. Rode com -NoTls para servir HTTP na porta 80, ou instale o Tailscale."
    }

    $tsHost = $null
    try {
        $tsJson = & $tsExe status --json 2>$null | ConvertFrom-Json
        # DNSName vem com ponto final (FQDN absoluto); o cert é emitido para o
        # nome sem esse ponto.
        $tsHost = $tsJson.Self.DNSName.TrimEnd('.')
    } catch {
        throw "Não consegui ler o hostname do Tailscale (tailscale status --json). O tailscaled está rodando? Use -NoTls para servir HTTP na 80."
    }
    if (-not $tsHost) {
        throw "tailscale status não trouxe Self.DNSName. Use -NoTls para servir HTTP na 80."
    }

    New-Item -ItemType Directory -Force -Path $CertDir | Out-Null
    $CertPath = Join-Path $CertDir "$tsHost.crt"
    $KeyPath = Join-Path $CertDir "$tsHost.key"

    Write-Host "==> Garantindo certificado para $tsHost (tailscale cert)..."
    # Captura a saída em vez de deixar vazar direto: a mensagem do tailscale é
    # mais precisa que qualquer paráfrase nossa (ex.: "your Tailscale account
    # does not support getting TLS certs" quando a tailnet está com HTTPS
    # Certificates desligado), então ela é reproduzida literalmente no erro.
    $certOut = & $tsExe cert --min-validity 720h --cert-file $CertPath --key-file $KeyPath $tsHost 2>&1
    $certExit = $LASTEXITCODE
    if ($certExit -ne 0 -or -not (Test-Path $CertPath) -or -not (Test-Path $KeyPath)) {
        throw @"
Falhou ao emitir o certificado para $tsHost (exit $certExit).

Saída do tailscale:
    $($certOut -join "`n    ")

Causa mais comum: HTTPS Certificates desligado na tailnet. Habilite em
https://login.tailscale.com/admin/dns (seção "HTTPS Certificates") e rode de
novo. Se já estiver habilitado, tente num terminal como Administrador — no
Windows o `tailscale cert` pode precisar de elevação para gravar no store
local.

Para subir agora sem TLS, na porta 80:
    .\deploy.ps1 -NoTls
"@
    }

    $UvicornTlsArgs = @("--ssl-certfile", $CertPath, "--ssl-keyfile", $KeyPath)
}

# ---------------------------------------------------------------------------
# Portas
# ---------------------------------------------------------------------------
if ($Port -gt 0) {
    $AppPort = $Port
} elseif ($NoTls) {
    $AppPort = 80
} else {
    $AppPort = 443
}
$Scheme = if ($NoTls) { "http" } else { "https" }

# ---------------------------------------------------------------------------
# Listener de redirect na 80 (só quando o app está em 443)
# ---------------------------------------------------------------------------
# Sobe em background porque o uvicorn fica em primeiro plano. Falha aqui NÃO é
# fatal: o app em 443 funciona sem isso — só perde a conveniência de digitar o
# host sem esquema no browser. Por isso é -ErrorAction e aviso, não throw.
$RedirectProc = $null
if (-not $NoTls -and $AppPort -eq 443 -and (Test-Path $RedirectScript)) {
    try {
        $RedirectProc = Start-Process -FilePath $VenvPython `
            -ArgumentList @($RedirectScript, "80", "0.0.0.0") `
            -PassThru -NoNewWindow -ErrorAction Stop
        Start-Sleep -Milliseconds 300
        if ($RedirectProc.HasExited) {
            Write-Warning "Listener de redirect da porta 80 saiu na largada (algo já ocupa a 80?). Segue sem ele — acesse com https:// explícito."
            $RedirectProc = $null
        } else {
            Write-Host "==> Porta 80 redirecionando para https (PID $($RedirectProc.Id))"
        }
    } catch {
        Write-Warning "Não subi o listener de redirect da porta 80: $($_.Exception.Message). Segue sem ele."
        $RedirectProc = $null
    }
}

# ---------------------------------------------------------------------------
# Backend
# ---------------------------------------------------------------------------
Write-Host "==> Subindo backend em ${Scheme}://0.0.0.0:${AppPort} (Ctrl+C para parar) — logs em $LogDir\uvicorn.log"
if (-not $NoTls) {
    Write-Host "    Acesse por https://$tsHost (cert válido, sem aviso no iPad)"
}
Push-Location $BackendDir
try {
    & $VenvUvicorn app.main:app --host 0.0.0.0 --port $AppPort @UvicornTlsArgs `
        --log-level warning --timeout-graceful-shutdown 5 2>&1 |
        Tee-Object -FilePath (Join-Path $LogDir "uvicorn.log") -Append
} finally {
    Pop-Location
    # O redirect é filho deste script: sem isto ele sobrevive ao Ctrl+C e a
    # porta 80 fica presa até o próximo reboot ou um Stop-Process manual — e o
    # deploy seguinte reclamaria de porta ocupada sem motivo aparente.
    if ($RedirectProc -and -not $RedirectProc.HasExited) {
        Write-Host "==> Encerrando listener de redirect da porta 80 (PID $($RedirectProc.Id))"
        Stop-Process -Id $RedirectProc.Id -Force -ErrorAction SilentlyContinue
    }
}
