"""Testes de `app.session_provisioner.provision_session_id`.

A maioria mocka `run_capture` — não é preciso subprocess real para exercitar
dispatch, parsing e conversão de erro, e mockar mantém o arquivo rápido. Há UM
teste ponta a ponta com script fake (`.py` via `sys.executable`) que valida a
passagem real de argv/cwd/env ao processo filho, para o mock não virar uma
ficção auto-consistente.

Nunca depende do `cursor-agent` real estar instalado.
"""

import subprocess
import sys
from unittest.mock import AsyncMock, patch

import pytest

from app.command_runner import CommandResult
from app.models import Agent
from app.session_provisioner import (
    SessionProvisioningError,
    provision_session_id,
)

VALID_UUID = "67e3fda4-d998-45f0-9626-2a6a37dab45d"


def _cursor_agent(cmd=None, env=None) -> Agent:
    return Agent(
        id="cursor", nome="Cursor", papel="Assistente", ia="cursor",
        cmd=["cursor-agent"] if cmd is None else cmd,
        env=env or {},
    )


def _ok(stdout: str) -> CommandResult:
    return CommandResult(exit_code=0, stdout=stdout, stderr="")


# --------------------------------------------------------------------------
# Caminho de zero I/O — a asserção mais importante do arquivo
# --------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("ia", ["cursor", "claude", "gemini", "terminal", "algo-novo"])
async def test_existing_id_is_returned_verbatim_without_any_subprocess(ia):
    """Com um id já existente NENHUM subprocess pode rodar, para nenhum tipo de
    agente. É esta asserção que garante que reconexão, reload, POST /continue,
    POST /paste e a expiração do grace period não criem um chat órfão por
    passagem. Cada `create-chat` extra é um chat abandonado em ~/.cursor/chats/
    que o CLI não oferece como apagar."""
    agent = Agent(id="a", nome="A", papel="P", ia=ia, cmd=["some-cli"])

    with patch("app.session_provisioner.run_capture", new_callable=AsyncMock) as runner:
        result = await provision_session_id(agent, cwd=".", existing_id="pre-existente-123")

    assert result == "pre-existente-123"
    runner.assert_not_called()


@pytest.mark.asyncio
async def test_empty_string_existing_id_is_treated_as_absent():
    """`reset_claude_session_id` grava o sentinel '' no store (não NULL). Ele é
    falsy de propósito: depois de um POST /reset a sessão tem MESMO que nascer
    de novo, então '' precisa cair no caminho de provisionamento."""
    agent = _cursor_agent()

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=_ok(VALID_UUID),
    ) as runner:
        result = await provision_session_id(agent, cwd=".", existing_id="")

    assert result == VALID_UUID
    assert runner.await_count == 1


# --------------------------------------------------------------------------
# Agentes não-Cursor: uuid4 local, comportamento pré-existente preservado
# --------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("ia", ["claude", "gemini", "terminal", "ia-desconhecida"])
async def test_non_cursor_agent_gets_local_uuid4_without_subprocess(ia):
    import uuid as uuid_mod

    agent = Agent(id="a", nome="A", papel="P", ia=ia, cmd=["some-cli"])

    with patch("app.session_provisioner.run_capture", new_callable=AsyncMock) as runner:
        result = await provision_session_id(agent, cwd=".", existing_id=None)

    runner.assert_not_called()
    # Precisa ser um UUID de verdade: é ele que vai no --session-id do claude.
    assert uuid_mod.UUID(result)


@pytest.mark.asyncio
async def test_agent_none_gets_local_uuid4_without_subprocess():
    """`_ensure_pty` pode chegar aqui com agent=None (projeto sem agente
    resolvido, que cai no `claude` puro em `_build_agent_cmd`) — não pode
    explodir com AttributeError ao ler `.ia`."""
    import uuid as uuid_mod

    with patch("app.session_provisioner.run_capture", new_callable=AsyncMock) as runner:
        result = await provision_session_id(None, cwd=".", existing_id=None)

    runner.assert_not_called()
    assert uuid_mod.UUID(result)


# --------------------------------------------------------------------------
# Cursor: caminho de sucesso e parsing
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cursor_without_id_runs_create_chat_exactly_once():
    agent = _cursor_agent()

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=_ok(VALID_UUID + "\n"),
    ) as runner:
        result = await provision_session_id(agent, cwd="/proj", existing_id=None)

    assert result == VALID_UUID
    assert runner.await_count == 1


@pytest.mark.asyncio
async def test_cursor_create_chat_argv_drops_registered_flags_and_uses_project_cwd():
    """argv = [cmd[0], "create-chat"] — os flags do cadastro são de sessão
    interativa e o subcomando provavelmente os rejeita; um exit != 0 por causa
    deles viraria um spawn_failed inexplicável. O cwd tem que ser o do projeto:
    o --workspace default do Cursor é o cwd, e é o que faz o chat nascer no
    lugar certo."""
    agent = _cursor_agent(cmd=["C:/tools/cursor-agent.exe", "--model", "sonnet", "--force"])

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=_ok(VALID_UUID),
    ) as runner:
        await provision_session_id(agent, cwd="/proj/meu-app", existing_id=None)

    argv = runner.await_args.args[0] if runner.await_args.args else runner.await_args.kwargs["argv"]
    assert argv == ["C:/tools/cursor-agent.exe", "create-chat"]
    assert runner.await_args.kwargs["cwd"] == "/proj/meu-app"


@pytest.mark.asyncio
async def test_cursor_create_chat_forwards_agent_env_for_auth():
    """A auth do Cursor chega por env (CURSOR_API_KEY), não por flag — e é o
    único pedaço do cadastro que o create-chat realmente precisa receber."""
    agent = _cursor_agent(env={"CURSOR_API_KEY": "abc123"})

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=_ok(VALID_UUID),
    ) as runner:
        await provision_session_id(agent, cwd="/proj", existing_id=None)

    assert runner.await_args.kwargs["extra_env"] == {"CURSOR_API_KEY": "abc123"}


@pytest.mark.asyncio
@pytest.mark.parametrize("stdout", [
    f"A new version is available!\n{VALID_UUID}\n",
    f"{VALID_UUID}\nRun `cursor-agent upgrade` to update.\n",
    f"banner\n\n  {VALID_UUID}  \n\nrodapé\n",
])
async def test_cursor_chat_id_is_found_regardless_of_banner_position(stdout):
    """CLIs imprimem aviso de update ANTES ou DEPOIS da linha útil (e às vezes
    nos dois). Varrer todas as linhas cobre as duas posições; um
    `stdout.strip()` seco falharia em pelo menos uma delas."""
    agent = _cursor_agent()

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=_ok(stdout),
    ):
        result = await provision_session_id(agent, cwd="/proj", existing_id=None)

    assert result == VALID_UUID


# --------------------------------------------------------------------------
# Cursor: todos os modos de falha viram SessionProvisioningError (que é OSError)
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_session_provisioning_error_is_an_oserror():
    """Invariante estrutural: o catch do pty_endpoint captura OSError. Se esta
    herança mudar, uma falha de provisioning volta a escapar do handler e o
    reconnect-storm reabre."""
    assert issubclass(SessionProvisioningError, OSError)


@pytest.mark.asyncio
async def test_cursor_timeout_becomes_session_provisioning_error():
    """`subprocess.TimeoutExpired` é SubprocessError, **não** OSError — sem esta
    conversão escaparia do catch do pty_endpoint."""
    agent = _cursor_agent()

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        side_effect=subprocess.TimeoutExpired(cmd=["cursor-agent"], timeout=10.0),
    ):
        with pytest.raises(SessionProvisioningError) as exc_info:
            await provision_session_id(agent, cwd="/proj", existing_id=None)

    assert "tempo esgotado" in str(exc_info.value)
    assert "cursor-agent" in str(exc_info.value)


@pytest.mark.asyncio
async def test_cursor_nonzero_exit_becomes_error_with_stderr_in_detail():
    """O `detail` é renderizado no terminal do usuário — precisa levar a saída
    real do CLI ("not logged in", key inválida…), senão a falha é indepurável."""
    agent = _cursor_agent()

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=CommandResult(exit_code=1, stdout="", stderr="Error: not logged in"),
    ):
        with pytest.raises(SessionProvisioningError) as exc_info:
            await provision_session_id(agent, cwd="/proj", existing_id=None)

    assert "not logged in" in str(exc_info.value)


@pytest.mark.asyncio
async def test_cursor_long_stderr_is_truncated_in_detail():
    """Um stack trace de Node inteiro no overlay do iPad é ilegível."""
    agent = _cursor_agent()

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=CommandResult(exit_code=1, stdout="", stderr="X" * 5000),
    ):
        with pytest.raises(SessionProvisioningError) as exc_info:
            await provision_session_id(agent, cwd="/proj", existing_id=None)

    assert len(str(exc_info.value)) < 1000


@pytest.mark.asyncio
@pytest.mark.parametrize("stdout", [
    "",
    "\n\n",
    "Chat criado com sucesso!\n",
    "not-a-uuid-at-all\n",
    "67e3fda4d99845f096262a6a37dab45d\n",  # hex de 32 chars, sem hífens
    "67e3fda4-d998-45f0-9626\n",           # UUID truncado
    f"id: {VALID_UUID}\n",                 # UUID embutido em prosa, não linha inteira
])
async def test_cursor_unparseable_stdout_becomes_error_never_a_bare_resume(stdout):
    """Sem id VALIDADO é obrigatório falhar, nunca devolver algo aproximado: o
    parâmetro de `--resume` é opcional no Cursor, então um valor lixo (ou a flag
    nua) abriria o SELETOR INTERATIVO e travaria o PTY numa TUI da qual a UI não
    tem saída. Um UUID embutido em prosa também é recusado — casamos a linha
    inteira, senão qualquer texto contendo um UUID passaria por id."""
    agent = _cursor_agent()

    with patch(
        "app.session_provisioner.run_capture", new_callable=AsyncMock,
        return_value=_ok(stdout),
    ):
        with pytest.raises(SessionProvisioningError):
            await provision_session_id(agent, cwd="/proj", existing_id=None)


@pytest.mark.asyncio
async def test_empty_agent_cmd_raises_session_provisioning_error_not_index_error():
    """R1 do TL: `models.Agent.cmd` não valida lista não-vazia. `agent.cmd[0]`
    num cadastro com cmd=[] levantaria IndexError — que NÃO é OSError, escaparia
    do catch do pty_endpoint e reabriria o reconnect-storm por um caminho que
    nenhum ADR cobre. Precisa virar SessionProvisioningError aqui, na única
    fronteira que indexa a lista.

    O default de `Agent.cmd` é ["claude"], então cmd=[] só existe se alguém
    cadastrar explicitamente uma lista vazia — o que a UI permite."""
    agent = _cursor_agent(cmd=[])

    with patch("app.session_provisioner.run_capture", new_callable=AsyncMock) as runner:
        with pytest.raises(SessionProvisioningError) as exc_info:
            await provision_session_id(agent, cwd="/proj", existing_id=None)

    # Nem chegou a tentar rodar nada.
    runner.assert_not_called()
    assert not isinstance(exc_info.value, IndexError)
    assert "sem comando" in str(exc_info.value)


@pytest.mark.asyncio
async def test_missing_binary_propagates_as_oserror():
    """FileNotFoundError já é OSError e a mensagem nativa do SO é mais
    informativa que qualquer paráfrase — propaga sem embrulhar. Estado atual da
    máquina: `cursor-agent` não está no PATH do backend."""
    agent = _cursor_agent(cmd=["definitely-not-a-real-binary-xyz"])

    with pytest.raises(OSError):
        await provision_session_id(agent, cwd=".", existing_id=None)


# --------------------------------------------------------------------------
# Ponta a ponta com processo real (sem mock do runner)
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_end_to_end_with_fake_cli_passes_argv_cwd_and_env_for_real(tmp_path):
    """Único teste SEM mock de `run_capture`: exercita argv + cwd + env de ponta
    a ponta, para os mocks acima não virarem uma ficção auto-consistente.

    O truque que torna isso possível sem `.cmd`/shim (cuja resolução no Windows
    é um problema separado, que atinge o spawn de PTY inteiro e não este módulo):
    o fake é gravado DENTRO do cwd com o nome literal `create-chat`, e
    `agent.cmd[0]` é o próprio `sys.executable`. O argv que o provisioner monta,
    `[python, "create-chat"]`, então só funciona se as três coisas estiverem
    certas ao mesmo tempo — o Python executa qualquer arquivo como script,
    independente de extensão, mas o caminho relativo só resolve se o `cwd` do
    projeto tiver sido repassado de verdade.

    A env var é verificada pelo próprio fake: sem `CURSOR_API_KEY` ele imprime
    uma mensagem de erro em vez do UUID, o que faria o parse falhar. Sucesso
    aqui prova que `agent.env` chegou ao filho — o caminho pelo qual a auth do
    Cursor viaja.
    """
    workdir = tmp_path / "projeto"
    workdir.mkdir()
    (workdir / "create-chat").write_text(
        "import os\n"
        "print('A new version of cursor-agent is available!')\n"
        "if os.environ.get('CURSOR_API_KEY') == 'chave-de-teste':\n"
        f"    print('{VALID_UUID}')\n"
        "else:\n"
        "    print('Error: not logged in')\n",
        encoding="utf-8",
    )

    agent = _cursor_agent(
        # Os dois últimos itens são flags de sessão interativa e precisam ser
        # descartados: se chegassem ao filho, o Python tentaria abri-los como
        # script e o exit code não seria 0.
        cmd=[sys.executable, "--model", "sonnet"],
        env={"CURSOR_API_KEY": "chave-de-teste"},
    )

    result = await provision_session_id(agent, cwd=str(workdir), existing_id=None)

    assert result == VALID_UUID
