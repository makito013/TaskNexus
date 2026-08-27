"""Testes de `app.command_runner.run_capture`.

Todos usam um script Python fake invocado via `[sys.executable, script_path]`,
NUNCA um `.cmd`/`.bat`/shim. Isso é deliberado: um shim `.cmd` no Windows não é
invocável por `subprocess` sem `shell=True`, e esse é um problema de resolução
de binário que atinge o spawn de PTY inteiro (qualquer agente não-`.exe`), não
este módulo — está registrado como spin-off separado. Acoplar os testes daqui a
ele faria este arquivo falhar por um motivo que não é sobre ele.
"""

from __future__ import annotations

import subprocess
import sys

import pytest

from app.command_runner import CommandResult, run_capture


def _script(tmp_path, body: str) -> list[str]:
    """Grava `body` como script Python em tmp_path e devolve o argv que o
    executa com o mesmo interpretador dos testes (sem depender de PATH)."""
    path = tmp_path / "fake_cli.py"
    path.write_text(body, encoding="utf-8")
    return [sys.executable, str(path)]


@pytest.mark.asyncio
async def test_run_capture_returns_stdout_and_zero_exit_code(tmp_path):
    argv = _script(tmp_path, "print('hello from fake cli')")

    result = await run_capture(argv, cwd=str(tmp_path), timeout=10.0)

    assert isinstance(result, CommandResult)
    assert result.exit_code == 0
    assert "hello from fake cli" in result.stdout
    assert result.stderr == ""


@pytest.mark.asyncio
async def test_run_capture_reports_nonzero_exit_with_stderr_separate_from_stdout(tmp_path):
    """exit != 0 NÃO levanta exceção (nada de `check=True`) — quem chama
    inspeciona `exit_code` e monta a mensagem com o `stderr`. E stderr precisa
    vir num campo próprio: se viesse intercalado no stdout, o parse do id de
    chat do caller quebraria."""
    argv = _script(
        tmp_path,
        "import sys\n"
        "sys.stdout.write('linha de stdout\\n')\n"
        "sys.stderr.write('not logged in\\n')\n"
        "sys.exit(3)\n",
    )

    result = await run_capture(argv, cwd=str(tmp_path), timeout=10.0)

    assert result.exit_code == 3
    assert "linha de stdout" in result.stdout
    assert "not logged in" in result.stderr
    assert "not logged in" not in result.stdout


@pytest.mark.asyncio
async def test_run_capture_raises_timeout_expired_and_kills_child(tmp_path):
    """O timeout é do próprio `subprocess.run`, então a exceção é
    `subprocess.TimeoutExpired` — que é `SubprocessError`, **não** `OSError`.
    Quem chama é responsável por converter (ver session_provisioner), senão a
    exceção escaparia do catch anti-reconnect-storm do pty_endpoint."""
    argv = _script(tmp_path, "import time; time.sleep(30)")

    with pytest.raises(subprocess.TimeoutExpired):
        await run_capture(argv, cwd=str(tmp_path), timeout=0.5)

    assert not issubclass(subprocess.TimeoutExpired, OSError)


@pytest.mark.asyncio
async def test_run_capture_preserves_every_stdout_line_around_a_uuid(tmp_path):
    """Caso real do `cursor-agent`: CLIs imprimem aviso de update/banner ANTES
    ou DEPOIS da linha útil. O runner não pode strippar, filtrar nem reordenar
    nada — devolve o stdout inteiro e deixa a seleção da linha para o parser do
    caller (que varre todas as linhas justamente por isso)."""
    argv = _script(
        tmp_path,
        "print('A new version of the CLI is available!')\n"
        "print('67e3fda4-d998-45f0-9626-2a6a37dab45d')\n"
        "print('Run `cli upgrade` to update.')\n",
    )

    result = await run_capture(argv, cwd=str(tmp_path), timeout=10.0)

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    assert lines == [
        "A new version of the CLI is available!",
        "67e3fda4-d998-45f0-9626-2a6a37dab45d",
        "Run `cli upgrade` to update.",
    ]


@pytest.mark.asyncio
async def test_run_capture_returns_empty_stdout_without_raising(tmp_path):
    """Comando que não imprime nada é sucesso do ponto de vista do runner
    (exit 0, stdout vazio). Decidir que "vazio" é falha é regra de negócio do
    caller, não deste módulo."""
    argv = _script(tmp_path, "pass")

    result = await run_capture(argv, cwd=str(tmp_path), timeout=10.0)

    assert result.exit_code == 0
    assert result.stdout.strip() == ""


@pytest.mark.asyncio
async def test_run_capture_raises_oserror_for_missing_binary(tmp_path):
    """Estado atual da máquina do Bruno: `cursor-agent` não está no PATH do
    backend. Precisa vir como `OSError` (FileNotFoundError) para o catch do
    pty_endpoint reconhecer."""
    with pytest.raises(OSError):
        await run_capture(
            ["definitely-not-a-real-binary-xyz"], cwd=str(tmp_path), timeout=5.0
        )


@pytest.mark.asyncio
async def test_run_capture_decodes_non_utf8_bytes_without_raising(tmp_path):
    """Lemos bytes e decodificamos com errors="replace": um byte inválido não
    pode virar UnicodeDecodeError no meio do provisioning (viraria falha
    inexplicável para o usuário). Escrevemos direto em sys.stdout.buffer para
    driblar o encoder de texto do próprio filho."""
    argv = _script(
        tmp_path,
        "import sys\n"
        "sys.stdout.buffer.write(b'antes \\xff\\xfe depois')\n"
        "sys.stdout.buffer.flush()\n",
    )

    result = await run_capture(argv, cwd=str(tmp_path), timeout=10.0)

    assert result.exit_code == 0
    assert "antes" in result.stdout
    assert "depois" in result.stdout
    assert "�" in result.stdout  # U+FFFD REPLACEMENT CHARACTER


@pytest.mark.asyncio
async def test_run_capture_runs_in_the_given_cwd(tmp_path):
    """`cwd` é o que faz o chat do Cursor nascer no workspace certo (o
    `--workspace` default é o cwd), então precisa chegar de verdade ao filho."""
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    argv = _script(tmp_path, "import os; print(os.getcwd())")

    result = await run_capture(argv, cwd=str(workdir), timeout=10.0)

    assert result.exit_code == 0
    # realpath nos dois lados: em macOS/Windows tmp_path pode vir por link
    # simbólico (/private/var vs /var), e o filho reporta o caminho resolvido.
    import os
    assert os.path.realpath(result.stdout.strip()) == os.path.realpath(str(workdir))


@pytest.mark.asyncio
async def test_run_capture_merges_and_expands_extra_env(tmp_path, monkeypatch):
    """`extra_env` é como a auth do agente (ex.: CURSOR_API_KEY) chega ao
    comando, e os valores passam por expandvars — mesma regra do
    pty_manager._resolved_extra_env, para um `%SECRETS%\\...` cadastrado na UI
    resolver igual nos dois caminhos."""
    monkeypatch.setenv("TARGET_FOR_EXPANSION", "resolvido-ok")
    placeholder = "%TARGET_FOR_EXPANSION%" if sys.platform == "win32" else "$TARGET_FOR_EXPANSION"

    argv = _script(
        tmp_path,
        "import os\n"
        "print(os.environ.get('AGENT_TOKEN', '<ausente>'))\n"
        "print(os.environ.get('TARGET_FOR_EXPANSION', '<ausente>'))\n",
    )

    result = await run_capture(
        argv, cwd=str(tmp_path), timeout=10.0, extra_env={"AGENT_TOKEN": placeholder}
    )

    lines = result.stdout.splitlines()
    assert lines[0].strip() == "resolvido-ok", "extra_env deve passar por expandvars"
    # os.environ do backend é herdado (copy + update), não substituído.
    assert lines[1].strip() == "resolvido-ok"


@pytest.mark.asyncio
async def test_run_capture_never_interprets_shell_metacharacters(tmp_path):
    """Sem `shell=True`: um argumento com metacaracteres chega literal ao
    filho, sem redirecionamento nem encadeamento."""
    argv = _script(tmp_path, "import sys; print(sys.argv[1])")
    payload = "a && echo INJETADO > out.txt"

    result = await run_capture(argv + [payload], cwd=str(tmp_path), timeout=10.0)

    assert result.stdout.strip() == payload
    assert not (tmp_path / "out.txt").exists()
