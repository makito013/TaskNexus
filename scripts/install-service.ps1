# install-service.ps1 — registra o backend como serviço Windows (via NSSM).
#
# Rode UMA VEZ, em um PowerShell aberto como Administrador:
#   .\scripts\install-service.ps1
#
# Depois disso, use .\deploy.ps1 (sem precisar de admin) para buildar o
# frontend e reiniciar o serviço a cada deploy.
#
# O que este script faz:
#   1. Instala o NSSM (via winget) se ainda não estiver instalado.
#   2. Cria uma venv em backend\.venv e instala backend\requirements.txt.
#   3. Registra/atualiza o serviço Windows "TaskNexus" apontando pro
#      uvicorn da venv, com auto-start no boot e auto-restart se cair.
#   4. Inicia o serviço.

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
    throw "Rode este script em um PowerShell aberto como Administrador (clique direito > Executar como administrador)."
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$VenvDir = Join-Path $BackendDir ".venv"
$LogDir = Join-Path $RepoRoot "logs"
$ServiceName = "TaskNexus"

# 1. NSSM
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "==> NSSM não encontrado. Instalando via winget..."
    winget install --id NSSM.NSSM -e --accept-package-agreements --accept-source-agreements
    # winget instala mas pode não atualizar o PATH da sessão atual
    $wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    if (Test-Path $wingetLinks) { $env:PATH = "$wingetLinks;$env:PATH" }
    if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
        throw "NSSM instalado mas não encontrado no PATH desta sessão. Feche e reabra o PowerShell (como Admin) e rode este script de novo."
    }
}

# 2. venv + dependências
# Evita o Python da Microsoft Store: seu python.exe é um "App Execution Alias"
# vinculado ao usuário interativo e não funciona rodando como LocalSystem (serviço).
function Get-RealPythonExe {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd -and ($cmd.Source -notmatch 'WindowsApps')) {
        return $cmd.Source
    }
    $candidates = @(
        (Join-Path $env:ProgramFiles "Python312\python.exe"),
        (Join-Path $env:ProgramFiles "Python313\python.exe"),
        (Join-Path $env:ProgramFiles "Python311\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    throw "Não foi encontrado um Python 'de verdade' (fora da Microsoft Store). Instale com: winget install --id Python.Python.3.12 -e"
}

$SystemPython = Get-RealPythonExe
Write-Host "==> Usando Python em $SystemPython"

if (-not (Test-Path $VenvDir)) {
    Write-Host "==> Criando venv em $VenvDir..."
    & $SystemPython -m venv $VenvDir
}
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvUvicorn = Join-Path $VenvDir "Scripts\uvicorn.exe"

Write-Host "==> Instalando dependências (backend\requirements.txt)..."
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r (Join-Path $BackendDir "requirements.txt")

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 3. Registrar serviço (remove e recria se já existir, pra garantir config atualizada)
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "==> Serviço '$ServiceName' já existe, removendo antes de recriar..."
    nssm stop $ServiceName confirm 2>$null | Out-Null
    nssm remove $ServiceName confirm | Out-Null
}

Write-Host "==> Registrando serviço '$ServiceName'..."
nssm install $ServiceName $VenvUvicorn "app.main:app --host 0.0.0.0 --port 8000 --log-level warning --timeout-graceful-shutdown 5"
nssm set $ServiceName AppDirectory $BackendDir
nssm set $ServiceName DisplayName "TaskNexus (backend)"
nssm set $ServiceName Description "uvicorn servindo backend + frontend do TaskNexus"
nssm set $ServiceName AppStdout (Join-Path $LogDir "uvicorn.log")
nssm set $ServiceName AppStderr (Join-Path $LogDir "uvicorn.log")
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateOnline 1
nssm set $ServiceName AppRotateBytes 10485760
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppExit Default Restart
nssm set $ServiceName AppRestartDelay 3000

Write-Host "==> Iniciando serviço..."
nssm start $ServiceName

Write-Host ""
Write-Host "==> OK. Backend em http://localhost:8000 — logs em $LogDir\uvicorn.log"
Write-Host "    Gerenciar: Get-Service $ServiceName | Restart-Service / Stop-Service / Start-Service"
Write-Host "    Deploys seguintes: .\deploy.ps1 (não precisa admin)"
